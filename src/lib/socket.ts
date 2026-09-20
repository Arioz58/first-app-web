import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken } from './api';
import { BASE_URL } from './config';
import { setConnectionOffline } from './connection';
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

  socket.on('connect', () => setConnectionOffline(false));

  /**
   * ⚠️ `io client disconnect` est NOTRE propre `disconnectSocket()` (changement de compte) :
   * une coupure volontaire n'est pas un incident. Les autres raisons (`transport close`,
   * `ping timeout`, `transport error`) sont subies, donc réelles.
   */
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') setConnectionOffline(true);
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
    /**
     * ⚠️ Le jeton AVEC LEQUEL la tentative est partie, et non seulement celui en mémoire.
     *
     * Une requête HTTP a pu renouveler le jeton PENDANT que le handshake était en cours : à
     * l'ouverture de la page, `connectSocket` et le premier chargement de la liste partent
     * ensemble, et c'est presque toujours ce qui arrive quand le jeton stocké est déjà
     * expiré. On se retrouvait alors avec un refus (tentative partie avec l'ancien) et un
     * jeton en mémoire parfaitement frais — que le test ci-dessous prenait pour « valide et
     * pourtant refusé », donc pour une panne. Le socket restait mort et le bandeau
     * s'affichait, alors qu'il suffisait de retenter avec le jeton neuf.
     */
    const used = (socket?.auth as { token?: string } | undefined)?.token;
    const current = getAccessToken();
    if (current && !isTokenExpired(current)) {
      if (socket && current !== used) {
        // Renouvelé par quelqu'un d'autre pendant la tentative : ce n'est pas une panne.
        console.log('[Socket] Jeton renouvelé entre-temps, nouvelle tentative');
        socket.auth = { token: current, platform: 'web' };
        socket.connect();
        return;
      }
      console.warn('[Socket] Connexion refusée :', err.message);
      /**
       * Même jeton, valide, et pourtant refusé : il n'y a rien à renouveler, le serveur est
       * hors d'atteinte. C'est une vraie coupure, et elle doit se voir.
       *
       * ⚠️ Pas de boucle possible : la tentative ci-dessus repart avec `current`, donc au
       * passage suivant `used === current` et l'on tombe forcément ici.
       */
      setConnectionOffline(true);
      return;
    }
    const fresh = await refreshAccessToken();
    if (!fresh || !socket) {
      /**
       * ⚠️ C'est ICI que la coupure devient réelle, et nulle part avant : le refus du
       * handshake sur jeton expiré est attendu, seul l'échec du renouvellement prouve qu'on ne
       * peut plus joindre le serveur. Déclarer la coupure dès le refus donnait le faux positif
       * du 15/09 ; ne jamais la déclarer donnerait pire — un réseau coupé pendant une veille
       * resterait silencieux, puisque le jeton serait expiré à chaque nouvelle tentative et
       * qu'aucune ne parlerait jamais.
       */
      setConnectionOffline(true);
      return;
    }
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
