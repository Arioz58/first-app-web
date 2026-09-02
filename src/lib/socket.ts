import { io, type Socket } from 'socket.io-client';
import { BASE_URL } from './config';
import { getAccessToken } from './storage';

/**
 * Client Socket.io — portage de `lib/socket.ts` du mobile, simplifié.
 *
 * ⚠️ Pas de `pauseSocket` / `resumeSocket` ici : ils existent sur mobile parce que le serveur
 * ne pousse de notification qu'aux utilisateurs qu'il croit hors ligne, et qu'une app en
 * arrière-plan devait donc se déclarer absente. Un onglet web n'a pas de notifications push,
 * et le fermer coupe le socket de lui-même — il n'y a rien à simuler.
 *
 * ⚠️ Instance unique et réutilisée : en créer une seconde laisserait la première vivante
 * avec tous ses écouteurs, donc des messages traités deux fois.
 */

let socket: Socket | null = null;

export const connectSocket = (): Socket => {
  if (socket) return socket;

  const token = getAccessToken();
  socket = io(BASE_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  });
  return socket;
};

export const getSocket = (): Socket | null => socket;

/**
 * Ferme et OUBLIE l'instance.
 *
 * ⚠️ Réservé au changement de compte (déconnexion) : le socket porte le jeton dans son
 * handshake, donc une session qui change exige une connexion neuve. Pour une simple
 * navigation entre pages, garder l'instance — la reconnecter à chaque écran multiplierait
 * les handshakes.
 */
export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
