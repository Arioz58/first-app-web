import { BASE_URL } from './config';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveSession,
  getUserId,
  setAccessToken,
} from './storage';

/**
 * Client HTTP du backend Nexa — portage de `lib/api.ts` du mobile.
 *
 * Même contrat : jeton en en-tête `Authorization`, rafraîchissement automatique sur 401,
 * code HTTP attaché à l'erreur (certains appelants distinguent un refus métier d'une panne).
 */

let sessionExpiredHandler: (() => void) | null = null;

/** Appelé quand les deux jetons sont hors d'usage : l'app doit renvoyer à la connexion. */
export const setSessionExpiredHandler = (handler: () => void) => {
  sessionExpiredHandler = handler;
};

type RequestOptions = {
  method?: string;
  body?: object;
  auth?: boolean;
};

export type ApiError = Error & { status?: number };

/**
 * ⚠️ UNE SEULE requête de rafraîchissement à la fois.
 *
 * L'écran web charge plusieurs ressources en parallèle (conversations, profil, drapeaux) :
 * si le jeton vient d'expirer, elles reçoivent toutes un 401 en même temps et déclencheraient
 * chacune leur propre refresh — autant d'allers-retours inutiles, au moment précis où l'écran
 * attend déjà. On partage donc la promesse en vol.
 *
 * ⚠️ CORRECTION D'UN COMMENTAIRE FAUX (11/09) : il était écrit ici que le serveur invalide
 * l'ancien jeton de rafraîchissement, et que les renouvellements concurrents déconnectaient
 * donc l'utilisateur. C'est inexact — `POST /auth/refresh` vérifie la signature et renvoie un
 * nouvel accès, sans faire tourner le jeton ni invalider l'ancien (voir `auth.service.ts`).
 * Deux renouvellements simultanés réussissent tous les deux. Ne pas bâtir de raisonnement de
 * sécurité sur une rotation qui n'existe pas.
 */
let refreshing: Promise<string | null> | null = null;

/**
 * ⚠️ EXPORTÉ pour le socket, qui porte son jeton dans son handshake et doit pouvoir le
 * renouveler lui-même. Il passe par cette fonction-ci, et non par la sienne, précisément pour
 * partager la promesse en vol : le serveur invalide l'ancien jeton de rafraîchissement à
 * chaque usage, donc deux renouvellements simultanés en déconnecteraient un.
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.refreshToken) {
        saveSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          userId: getUserId() ?? '',
        });
      } else {
        setAccessToken(data.accessToken);
      }
      return data.accessToken as string;
    } catch {
      // Réseau coupé : ce n'est PAS une session expirée. On renvoie null, l'appelant
      // remontera l'erreur d'origine plutôt que de déconnecter à tort.
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
};

export const apiRequest = async <T>(
  path: string,
  { method = 'GET', body, auth = true }: RequestOptions = {},
): Promise<T> => {
  const send = (token?: string | null) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await send(auth ? getAccessToken() : null);

  if (res.status === 401 && auth) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await send(fresh);
    } else {
      clearSession();
      sessionExpiredHandler?.();
      throw new Error('SESSION_EXPIRED');
    }
  }

  // 204 et corps vide : `res.json()` lèverait sur une réponse sans contenu.
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const error = new Error(data?.message || 'Erreur serveur') as ApiError;
    error.status = res.status;
    throw error;
  }
  return data as T;
};
