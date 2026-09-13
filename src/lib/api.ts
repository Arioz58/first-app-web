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

/**
 * Le serveur n'a pas pu être joint pour renouveler la session. ⚠️ À traiter comme une panne
 * réseau ordinaire — surtout PAS comme une déconnexion : la session est peut-être intacte.
 */
export const NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE';

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
let refreshing: Promise<RefreshResult> | null = null;

/**
 * ⚠️ EXPORTÉ pour le socket, qui porte son jeton dans son handshake et doit pouvoir le
 * renouveler lui-même. Il passe par cette fonction-ci, et non par la sienne, précisément pour
 * partager la promesse en vol : le serveur invalide l'ancien jeton de rafraîchissement à
 * chaque usage, donc deux renouvellements simultanés en déconnecteraient un.
 */
/**
 * Pourquoi un renouvellement a échoué — la distinction qui évite de déconnecter à tort.
 *
 * ⚠️ `refused` et `unreachable` n'appellent PAS la même réaction. Jusqu'au 13/09 les deux
 * renvoyaient `null` et l'appelant effaçait la session : une requête de renouvellement qui
 * n'aboutissait pas — réseau coupé, serveur en cours de déploiement — renvoyait à l'écran de
 * connexion quelqu'un dont la session était parfaitement valide. Le commentaire du `catch`
 * annonçait pourtant l'inverse ; il décrivait une intention que le code ne réalisait pas.
 */
type RefreshResult =
  | { status: 'ok'; token: string }
  | { status: 'refused' }
  | { status: 'unreachable' };

const refreshSession = async (): Promise<RefreshResult> => {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = getRefreshToken();
    // Pas de jeton du tout : il n'y a rien à renouveler, et rien à attendre d'un réessai.
    if (!refreshToken) return { status: 'refused' as const };
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        /**
         * ⚠️ Un 5xx n'est PAS un refus du jeton : c'est le serveur qui est en peine
         * (redémarrage, déploiement, passerelle). Le traiter comme une session morte
         * déconnecterait tout le monde à chaque mise en production.
         */
        return { status: res.status >= 500 ? 'unreachable' : 'refused' } as const;
      }
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
      return { status: 'ok' as const, token: data.accessToken as string };
    } catch {
      // La requête n'a pas abouti : on ne sait RIEN de la validité de la session.
      return { status: 'unreachable' as const };
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
};

/**
 * Façade pour le socket, qui n'a besoin que du jeton.
 *
 * ⚠️ Il n'a pas à distinguer les deux échecs : en cas d'échec il ne touche à rien et laisse
 * sa propre mécanique de reconnexion réessayer plus tard.
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  const result = await refreshSession();
  return result.status === 'ok' ? result.token : null;
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
    const refreshed = await refreshSession();
    if (refreshed.status === 'ok') {
      res = await send(refreshed.token);
    } else if (refreshed.status === 'unreachable') {
      /**
       * ⚠️ RENOUVELLEMENT NON ABOUTI : on n'efface RIEN.
       *
       * On ne sait pas si la session est morte — la requête n'est simplement jamais arrivée.
       * Effacer la session ici renvoyait à l'écran de connexion quelqu'un de parfaitement
       * valide : il suffisait que le serveur redémarre pendant le renouvellement. L'appel
       * échoue comme n'importe quelle panne réseau, la session reste intacte.
       */
      throw new Error(NETWORK_UNAVAILABLE);
    } else {
      // Refus explicite du serveur : la session est bel et bien morte.
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
