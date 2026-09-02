import { io } from 'socket.io-client';
import { apiRequest } from './api';
import { BASE_URL } from './config';
import { saveSession } from './storage';
import type { AuthUser } from './auth';

/**
 * Connexion par QR — côté navigateur.
 *
 * ⚠️ Le navigateur ne prouve rien : il demande un jeton, l'affiche, et attend qu'un mobile
 * déjà connecté l'approuve. Les jetons arrivent PAR SOCKET, sur une room nommée d'après le
 * jeton du QR — que seuls le serveur et ce navigateur connaissent.
 */

export type PendingSession = { token: string; expiresAt: string };

/** Demande une session en attente. Sans authentification : on n'en a pas encore. */
export const createWebSession = () =>
  apiRequest<PendingSession>('/web-sessions', { method: 'POST', auth: false });

/**
 * Ouvre un socket NON AUTHENTIFIÉ le temps d'attendre l'approbation.
 *
 * ⚠️ Une connexion à part, jamais celle de `lib/socket.ts` : cette dernière porte le JWT
 * dans son handshake et sert toute l'app une fois connectée. Les mélanger laisserait une
 * instance sans identité mémorisée comme socket principal.
 *
 * Renvoie la fonction d'arrêt — l'appelant DOIT la garder : un QR rafraîchi ouvre une
 * nouvelle attente, et l'ancienne écouterait dans le vide.
 */
export const waitForApproval = (
  token: string,
  onApproved: (user: AuthUser) => void,
): (() => void) => {
  const socket = io(BASE_URL, {
    auth: { webSessionToken: token },
    transports: ['websocket'],
    reconnection: true,
  });

  socket.on(
    'web_session_approved',
    (payload: { accessToken: string; refreshToken: string; user: AuthUser }) => {
      saveSession({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        userId: payload.user.id,
      });
      // ⚠️ On ferme AVANT de rendre la main : cette connexion n'a pas d'identité, et la
      // laisser ouverte occuperait une place pour rien. L'app rouvrira la sienne, avec JWT.
      socket.disconnect();
      onApproved(payload.user);
    },
  );

  return () => socket.disconnect();
};
