import { apiRequest } from './api';
import { BASE_URL } from './config';
import { clearSession, getAccessToken, getRefreshToken, isTokenExpired, saveSession } from './storage';
import { clearToasts } from './toasts';

export type AuthUser = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
};

/**
 * Demande d'un code OTP.
 *
 * `mode` reprend le contrat du mobile : `login` refuse si le compte n'existe pas, `signup`
 * refuse s'il existe déjà. Sans `mode`, le serveur accepte les deux.
 */
export const sendCode = (phone: string, mode?: 'login' | 'signup') =>
  apiRequest<{ message: string }>('/auth/send-code', {
    method: 'POST',
    body: { phone, ...(mode ? { mode } : {}) },
    auth: false,
  });

/** Vérifie le code et ouvre la session. `name` n'est utilisé qu'à la création du compte. */
export const verifyCode = async (phone: string, code: string, name?: string) => {
  const data = await apiRequest<{
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
  }>('/auth/verify-code', {
    method: 'POST',
    body: { phone, code, ...(name ? { name } : {}) },
    auth: false,
  });

  saveSession({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    userId: data.user.id,
  });
  return data.user;
};

export const logout = () => {
  /**
   * ⚠️ Ferme la session CÔTÉ SERVEUR (23/10) : effacer le `localStorage` ne suffisait pas, une
   * copie du jeton restait utilisable 7 jours. Sans attendre la réponse — la déconnexion ne doit
   * pas dépendre du réseau ; hors ligne, la session expirera seule. `keepalive` : la requête
   * survit au changement de page qui suit.
   */
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      keepalive: true,
    }).catch(() => {});
  }
  // Les bandeaux du compte quitté mèneraient à des conversations devenues inaccessibles.
  clearToasts();
  clearSession();
};

/**
 * Une session exploitable existe-t-elle ?
 *
 * ⚠️ Vrai si le jeton d'accès est valide **ou** si celui de rafraîchissement l'est encore :
 * l'accès expire au bout de 15 minutes, et exiger qu'il soit frais déconnecterait à chaque
 * retour sur l'onglet. `apiRequest` se charge du renouvellement au premier appel.
 */
export const hasSession = (): boolean => {
  const access = getAccessToken();
  const refresh = getRefreshToken();
  if (access && !isTokenExpired(access)) return true;
  return !!refresh && !isTokenExpired(refresh);
};
