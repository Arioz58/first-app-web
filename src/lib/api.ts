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
 * chacune leur propre refresh. Le serveur invalidant l'ancien jeton de rafraîchissement à
 * chaque usage, la première réussirait et les suivantes déconnecteraient l'utilisateur.
 * On partage donc la promesse en vol.
 */
let refreshing: Promise<string | null> | null = null;

const refreshAccessToken = async (): Promise<string | null> => {
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
