import { apiRequest } from './api';

/**
 * Liste des conversations — types et tri portés depuis le mobile (`app/(tabs)/index.tsx`).
 *
 * ⚠️ Le tri est rejoué CÔTÉ CLIENT et doit rester identique à celui du serveur : épinglées
 * d'abord (la plus récemment épinglée en tête), puis par date du dernier message. Le serveur
 * trie déjà ainsi, mais un message reçu par socket doit remonter la conversation sans
 * recharger — et deux règles divergentes donneraient un ordre différent selon qu'on vient de
 * charger ou de recevoir.
 */

export type Member = {
  userId: string;
  user: { id: string; name: string; photoUrl: string | null };
};

export type LastMessage = {
  id: string;
  senderId: string;
  content: string | null;
  type: string;
  mediaType: string | null;
  createdAt: string;
  /** Médias d'un même envoi : plusieurs messages, une seule bulle — donc un seul non-lu. */
  batchId?: string | null;
};

export type Conversation = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  photoUrl: string | null;
  members: Member[];
  messages: LastMessage[];
  unreadCount: number;
  /** Remise en non lu à la main : pastille sans nombre. */
  manualUnread: boolean;
  pinnedAt: string | null;
  favoritedAt: string | null;
  archivedAt: string | null;
  mutedUntil: string | null;
  lastMessageAt: string;
};

export const sortConversations = (list: Conversation[]) =>
  [...list].sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) return +new Date(b.pinnedAt) - +new Date(a.pinnedAt);
    if (a.pinnedAt) return -1;
    if (b.pinnedAt) return 1;
    return +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt);
  });

export const fetchConversations = () => apiRequest<Conversation[]>('/conversations');

/**
 * Nom affiché : celui du groupe, ou celui de l'AUTRE participant.
 *
 * ⚠️ `members` contient tous les participants, moi compris, sans garantie de rang — prendre
 * `members[0]` afficherait parfois son propre nom. Le mobile a connu ce bug le 2 sept. dans
 * la feuille de transfert ; la règle est `find(m => m.userId !== me)`.
 */
export const otherMember = (conv: Conversation, meId: string | null): Member['user'] | null =>
  conv.members.find((m) => m.userId !== meId)?.user ?? null;

export const conversationName = (conv: Conversation, meId: string | null): string =>
  conv.type === 'group' ? conv.name ?? '' : otherMember(conv, meId)?.name ?? '';

export const conversationPhoto = (conv: Conversation, meId: string | null): string | null =>
  conv.type === 'group' ? conv.photoUrl : otherMember(conv, meId)?.photoUrl ?? null;

/** Aperçu du dernier message, typé comme sur mobile (une pièce jointe n'a pas de texte). */
export const messagePreview = (msg: LastMessage | undefined): string => {
  if (!msg) return '';
  /**
   * ⚠️ Un bandeau système porte une CLÉ i18n en JSON (`{"k":"ephemeral_off","by":…}`), pas
   * du texte lisible : l'afficher tel quel montrerait `{"k":"ephemeral_off"…}` en aperçu.
   * Tant que la traduction des messages système n'est pas portée sur le web, on n'affiche
   * rien plutôt qu'un objet brut.
   */
  if (msg.type === 'system') return '';
  if (msg.mediaType) {
    switch (msg.mediaType) {
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎥 Vidéo';
      case 'audio':
        return '🎤 Message vocal';
      case 'document':
        return '📄 Document';
      case 'gif':
        return 'GIF';
      default:
        break;
    }
  }
  if (msg.type === 'location') return '📍 Position';
  return msg.content ?? '';
};

/**
 * Horodatage de la liste : l'heure aujourd'hui, « Hier », le jour en deçà d'une semaine,
 * la date au-delà.
 *
 * ⚠️ Comparaison sur la date LOCALE et non sur un écart en heures — deux messages séparés
 * de dix minutes peuvent tomber de part et d'autre de minuit (même règle que les
 * séparateurs de date du fil mobile).
 */
export const formatListDate = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  if (today.getTime() - d.getTime() < 6 * 24 * 3600 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
};
