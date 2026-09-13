import { apiRequest } from './api';

/**
 * Positions partagées EN DIRECT dans une conversation — en LECTURE seule côté web.
 *
 * ⚠️ Le web ne partage PAS sa propre position, volontairement. Un ordinateur ne se déplace
 * pas, et surtout le navigateur ne peut suivre une position que tant que l'onglet est ouvert :
 * le fermer ou mettre la machine en veille interromprait le partage en silence. « Je partage
 * ma position pendant une heure » est une promesse — la tenir à moitié est pire que ne pas
 * la proposer. Voir quelqu'un qui partage depuis son téléphone, en revanche, est utile et
 * sans piège.
 */
export type LiveLocation = {
  userId: string;
  latitude: number;
  longitude: number;
  startedAt: string;
  expiresAt: string;
  /** Date du relevé : c'est elle qui dit si la position est encore fraîche. */
  updatedAt: string;
  user: { id: string; name: string; photoUrl: string | null };
};

export const fetchLiveLocations = (conversationId: string) =>
  apiRequest<LiveLocation[]>(`/conversations/${conversationId}/live-locations`);

/**
 * Au-delà, la position est considérée comme FIGÉE et affichée estompée.
 *
 * ⚠️ Même valeur que sur mobile. Elle reste utile même quand le suivi fonctionne bien :
 * réseau coupé, batterie vide ou application fermée donnent le même symptôme — une position
 * qui ne bouge plus — et l'utilisateur doit pouvoir s'en apercevoir.
 */
export const STALE_MS = 2 * 60 * 1000;

export const isStale = (l: LiveLocation) =>
  Date.now() - new Date(l.updatedAt).getTime() > STALE_MS;
