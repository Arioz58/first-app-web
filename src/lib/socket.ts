import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken } from './api';
import { BASE_URL } from './config';
import { getAccessToken, isTokenExpired } from './storage';

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
    /**
     * ⚠️ `platform: 'web'` est ce qui garde le TÉLÉPHONE notifié.
     *
     * Le serveur n'envoyait pas de notification à qui avait déjà la conversation ouverte
     * quelque part — et un onglet laissé ouvert comptait. Ouvrir Nexa Web rendait donc son
     * propre téléphone muet. Déclaré comme web, ce socket ne compte plus dans ce calcul :
     * le navigateur affiche sa propre notification (`webNotifications.ts`), le téléphone
     * garde les siennes.
     */
    auth: { token, platform: 'web' },
    transports: ['websocket'],
    reconnection: true,
  });

  /**
   * Jeton relu AVANT CHAQUE TENTATIVE de reconnexion.
   *
   * ⚠️ `auth` est figé à la création du socket. Le jeton d'accès ne vit que 15 minutes, et une
   * requête API a pu le renouveler entre-temps : sans cette relecture, toutes les tentatives
   * repartiraient avec celui d'il y a une heure.
   */
  socket.io.on('reconnect_attempt', () => {
    if (socket) socket.auth = { token: getAccessToken(), platform: 'web' };
  });

  /**
   * Handshake refusé : on renouvelle le jeton et on RELANCE la connexion.
   *
   * ⚠️ MESURÉ le 11/09, et c'est le cœur du problème : socket.io ne retente PAS après un refus
   * du middleware d'authentification. Une seule tentative, puis plus rien — le temps réel
   * mourait donc en silence dès que le jeton expirait (onglet laissé ouvert, veille, ou
   * simple redémarrage du serveur qui force une reconnexion). Symptôme côté client : plus
   * aucun message n'arrive tout seul, et il faut RECHARGER LA PAGE — ce qui renouvelle le
   * jeton au premier appel d'API et crée un socket neuf.
   *
   * ⚠️ On ne renouvelle QUE si le jeton est effectivement expiré : une erreur de connexion
   * alors qu'il est valide veut dire que le serveur est injoignable, et il n'y a rien à
   * renouveler. C'est aussi ce qui empêche la boucle — au second passage le jeton est frais,
   * donc on s'arrête.
   */
  socket.on('connect_error', async (err) => {
    const current = getAccessToken();
    if (current && !isTokenExpired(current)) {
      console.warn('[Socket] Connexion refusée :', err.message);
      return;
    }
    const fresh = await refreshAccessToken();
    if (!fresh || !socket) return;
    socket.auth = { token: fresh, platform: 'web' };
    socket.connect();
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
