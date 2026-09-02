/**
 * Stockage de la session côté navigateur.
 *
 * ⚠️ ÉCART ASSUMÉ AVEC LE MOBILE, à connaître : l'app native range ses jetons dans
 * `expo-secure-store` (trousseau chiffré du système). Le navigateur n'a pas d'équivalent —
 * `localStorage` est lisible par tout script de la page.
 *
 * Le choix retenu est celui de WhatsApp Web et de la plupart des messageries : jetons en
 * `localStorage`, en acceptant qu'une faille XSS les expose. L'alternative — cookies
 * `httpOnly` — demanderait au backend de poser et rafraîchir des cookies, donc une seconde
 * mécanique d'authentification à maintenir en parallèle de celle du mobile, avec sa
 * protection CSRF. À rouvrir au Mois 5 (hardening) si le client le demande ; la vraie
 * protection contre le vol de jeton reste de ne pas avoir de XSS.
 *
 * ⚠️ CE QUI PROTÈGE VRAIMENT, c'est l'absence de XSS — pas le lieu de stockage. Trois
 * mesures sont prévues au Mois 5 et comptent davantage que ce choix (voir le `todo` du repo
 * mobile) : CSP stricte sur le site, CORS restreint côté backend (`cors()` est aujourd'hui
 * grand ouvert), et révocation du refresh token à la déconnexion — il dure 7 jours et rien
 * ne l'invalide, donc un jeton volé reste valide jusqu'à son expiration, déconnexion
 * comprise.
 *
 * ⚠️ Chaque lecture est gardée : ce code peut s'exécuter côté SERVEUR (rendu Next.js), où
 * `localStorage` n'existe pas — un accès direct y lèverait une erreur au build.
 */

const ACCESS = 'nexa.accessToken';
const REFRESH = 'nexa.refreshToken';
const USER_ID = 'nexa.userId';

const canUseStorage = () => typeof window !== 'undefined';

const read = (key: string): string | null => {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Navigation privée stricte, stockage désactivé : on se comporte comme non connecté.
    return null;
  }
};

const write = (key: string, value: string | null) => {
  if (!canUseStorage()) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Quota atteint ou stockage refusé : la session ne survivra pas au rechargement, mais
    // l'app reste utilisable dans l'onglet courant.
  }
};

export const getAccessToken = () => read(ACCESS);
export const getRefreshToken = () => read(REFRESH);
export const getUserId = () => read(USER_ID);

export const saveSession = (tokens: {
  accessToken: string;
  refreshToken: string;
  userId: string;
}) => {
  write(ACCESS, tokens.accessToken);
  write(REFRESH, tokens.refreshToken);
  write(USER_ID, tokens.userId);
};

export const setAccessToken = (token: string) => write(ACCESS, token);

export const clearSession = () => {
  write(ACCESS, null);
  write(REFRESH, null);
  write(USER_ID, null);
};

/**
 * Le jeton est-il expiré ?
 *
 * ⚠️ Décodage LOCAL sans vérification de signature : c'est une optimisation d'affichage
 * (éviter un aller-retour voué à échouer), jamais une décision de sécurité. Le serveur
 * reste seul juge de la validité — un jeton falsifié passerait ce test et serait refusé
 * par lui.
 */
export const isTokenExpired = (token: string): boolean => {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};
