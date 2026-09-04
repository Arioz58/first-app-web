import { apiRequest } from './api';
import type { Friend } from './conversations';

/**
 * Amis et demandes d'ami — pendant web de `components/FriendsPanel.tsx`.
 *
 * ⚠️ Formes VÉRIFIÉES dans `friends.service.ts` : une demande est
 * `{ requestId, createdAt, user }`, où `user` est l'EXPÉDITEUR pour une demande reçue et le
 * DESTINATAIRE pour une demande envoyée. Le serveur fait ce déballage, l'app n'a pas à
 * connaître `fromUser`/`toUser`.
 */

export type FriendRequest = {
  /** ⚠️ L'identifiant de la DEMANDE, pas de la personne : c'est lui qu'attendent les routes. */
  requestId: string;
  createdAt: string;
  user: Friend;
};

export const fetchFriendRequests = () =>
  Promise.all([
    apiRequest<FriendRequest[]>('/friends/requests/received'),
    apiRequest<FriendRequest[]>('/friends/requests/sent'),
  ]);

export const acceptFriendRequest = (requestId: string) =>
  apiRequest(`/friends/requests/${requestId}/accept`, { method: 'POST' });

/**
 * ⚠️ Refuser n'avertit PAS l'expéditeur (côté serveur : statut `refused` + date). Il pose
 * seulement un délai de 7 jours avant qu'il puisse redemander. Ne rien laisser entendre
 * d'autre dans l'interface.
 */
export const refuseFriendRequest = (requestId: string) =>
  apiRequest(`/friends/requests/${requestId}/refuse`, { method: 'POST' });

/** Annuler MA demande. Prend l'identifiant de la demande, pas celui de la personne. */
export const cancelFriendRequest = (requestId: string) =>
  apiRequest(`/friends/requests/${requestId}`, { method: 'DELETE' });

/** Retirer un ami. Prend l'identifiant de la PERSONNE — l'exception dans ce module. */
export const removeFriend = (userId: string) =>
  apiRequest(`/friends/${userId}`, { method: 'DELETE' });
