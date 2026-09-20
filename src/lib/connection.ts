/**
 * État de la connexion temps réel, tel que `lib/socket.ts` le constate.
 *
 * Portage du module du mobile, et pour la même raison : la réponse à « sommes-nous coupés ? »
 * ne peut venir que du socket. La liste des conversations la déduisait jusqu'ici elle-même, à
 * partir des événements bruts (`disconnect`, `connect_error`) — et le mobile, qui porte le même
 * bandeau, refaisait le même raisonnement de son côté, avec la même erreur.
 *
 * ⚠️ POURQUOI UN SEUL ENDROIT DÉCIDE : un `connect_error` n'est PAS toujours une coupure. Le
 * jeton d'accès ne vit que quinze minutes, et un onglet laissé ouvert, une veille de la machine
 * ou un simple redémarrage du serveur suffisent à le périmer : le serveur refuse alors le
 * handshake, et le socket renouvelle puis se reconnecte de lui-même. C'est un passage obligé,
 * pas un incident — mais vu depuis un écran, il est indiscernable d'une vraie panne. Seul
 * `socket.ts` sait s'il a tenté un renouvellement et si celui-ci a abouti.
 *
 * ⚠️ Symptôme qui l'a révélé (client, 15/09) : un bandeau rouge « Mise à jour impossible » à
 * l'ouverture de l'application, web ET mobile, qui disparaissait seul au bout d'une dizaine de
 * secondes — exactement la durée du renouvellement.
 */
let offline = false;
const listeners = new Set<(offline: boolean) => void>();

/**
 * Réservé à `lib/socket.ts` : lui seul dispose des éléments pour trancher.
 *
 * ⚠️ Ne pas l'appeler depuis un composant sur un événement socket brut — ce serait refaire
 * précisément le raisonnement que ce module existe pour tenir en un seul endroit. Un échec de
 * requête HTTP, lui, reste l'affaire de l'écran qui l'a lancée : il sait ce qu'il demandait.
 */
export const setConnectionOffline = (next: boolean) => {
  if (next === offline) return;
  offline = next;
  listeners.forEach((l) => l(offline));
};

export const isConnectionOffline = () => offline;

/**
 * S'abonner au verdict. Rend la fonction de désabonnement, pour la rendre telle quelle depuis
 * un `useEffect`.
 *
 * ⚠️ UN ABONNEMENT ET NON UN HOOK, à la différence du mobile : ici l'abonné pose un état, et
 * `react-hooks/set-state-in-effect` — une ERREUR dans cette configuration, pas un
 * avertissement — refuse un `setState` posé dans le corps d'un effet. En passant par l'écouteur
 * on retrouve exactement la forme déjà en place pour `socket.on('disconnect', …)` : un état posé
 * depuis un événement, ce que React attend.
 *
 * ⚠️ L'écouteur n'est PAS appelé à l'abonnement, seulement aux changements : l'appeler
 * reviendrait au `setState` synchrone qu'on cherche à éviter. Une coupure déjà en cours au
 * montage se voit de toute façon — le chargement de la liste échoue, et son `catch` affiche le
 * bandeau.
 */
export const subscribeConnection = (listener: (offline: boolean) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
