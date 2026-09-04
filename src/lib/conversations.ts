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

/**
 * Aperçu du dernier message, typé comme sur mobile (une pièce jointe n'a pas de texte).
 *
 * ⚠️ Renvoie un COUPLE `{ kind, text }` et non une chaîne : l'icône est un composant SVG que
 * seul le rendu peut poser. Coller « 📷 » devant le texte, comme avant, laissait le dessin au
 * système d'exploitation — donc différent sur macOS, Windows et Android, et sans rapport avec
 * les icônes du reste de l'écran.
 */
export type PreviewKind = 'photo' | 'video' | 'audio' | 'document' | 'gif' | 'location' | null;

export const messagePreview = (
  msg: LastMessage | undefined,
): { kind: PreviewKind; text: string } => {
  const none = { kind: null, text: '' } as const;
  if (!msg) return none;
  /**
   * ⚠️ Un bandeau système porte une CLÉ i18n en JSON (`{"k":"ephemeral_off","by":…}`), pas
   * du texte lisible : l'afficher tel quel montrerait `{"k":"ephemeral_off"…}` en aperçu.
   * Tant que la traduction des messages système n'est pas portée sur le web, on n'affiche
   * rien plutôt qu'un objet brut.
   */
  if (msg.type === 'system') return none;
  if (msg.mediaType) {
    switch (msg.mediaType) {
      case 'image':
        return { kind: 'photo', text: 'Photo' };
      case 'video':
        return { kind: 'video', text: 'Vidéo' };
      case 'audio':
        return { kind: 'audio', text: 'Message vocal' };
      case 'document':
        return { kind: 'document', text: 'Document' };
      case 'gif':
        return { kind: 'gif', text: 'GIF' };
      default:
        break;
    }
  }
  if (msg.type === 'location') return { kind: 'location', text: 'Position' };
  return { kind: null, text: msg.content ?? '' };
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

// --- Amis et création de conversations ---

export type Friend = { id: string; name: string; photoUrl: string | null };

/** Mes amis, avec recherche optionnelle par nom. */
export const fetchFriends = (q?: string) =>
  apiRequest<Friend[]>(`/friends${q ? `?q=${encodeURIComponent(q)}` : ''}`);

/**
 * Ouvre (ou retrouve) la conversation directe avec quelqu'un.
 *
 * ⚠️ Idempotent côté serveur : rappeler avec la même personne renvoie la conversation
 * EXISTANTE au lieu d'en créer une seconde. On peut donc appeler sans vérifier au préalable.
 */
export const startDirectConversation = (targetUserId: string) =>
  apiRequest<{ id: string }>('/conversations/direct', {
    method: 'POST',
    body: { targetUserId },
  });

export const createGroup = (name: string, memberIds: string[]) =>
  apiRequest<{ id: string }>('/conversations/group', {
    method: 'POST',
    body: { name, memberIds },
  });

// --- Actions sur une conversation (toutes PAR MEMBRE : elles ne regardent que soi) ---

/**
 * ⚠️ Épingler, archiver, mettre en sourdine ou en favori sont des réglages PERSONNELS :
 * épingler une conversation ne l'épingle pas chez l'autre. C'est `ConversationMember` qui
 * les porte côté serveur, pas `Conversation`.
 */
export const pinConversation = (id: string, pinned: boolean) =>
  apiRequest(`/conversations/${id}/pin`, { method: 'PATCH', body: { pinned } });

export const favoriteConversation = (id: string, favorite: boolean) =>
  apiRequest(`/conversations/${id}/favorite`, { method: 'PATCH', body: { favorite } });

/** ⚠️ Archiver retire l'épinglage : une conversation rangée n'a rien à faire en tête de liste. */
export const archiveConversation = (id: string, archived: boolean) =>
  apiRequest(`/conversations/${id}/archive`, { method: 'PATCH', body: { archived } });

/**
 * Sourdine. `mutedUntil` est une date ISO, ou `null` pour réactiver.
 *
 * ⚠️ « Toujours » est une date lointaine (an 2999) et non une valeur spéciale : le serveur
 * compare simplement à maintenant, et un sentinelle évite un troisième état à gérer partout.
 */
export const muteConversation = (id: string, mutedUntil: string | null) =>
  apiRequest(`/conversations/${id}/mute`, { method: 'PATCH', body: { mutedUntil } });

/** Remise en non lu à la main. Toute lecture la lève. */
export const markUnread = (id: string) =>
  apiRequest(`/conversations/${id}/unread`, { method: 'POST' });

/** Sentinelle « toujours » — même valeur que le mobile (`MUTE_FOREVER`). */
export const MUTE_FOREVER = new Date('2999-12-31T00:00:00Z').toISOString();

/** Durées proposées, alignées sur le mobile. */
export const MUTE_OPTIONS: { label: string; value: string }[] = [
  { label: '8 heures', value: new Date(Date.now() + 8 * 3600 * 1000).toISOString() },
  { label: '1 semaine', value: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() },
  { label: 'Toujours', value: MUTE_FOREVER },
];

/** La conversation est-elle en sourdine à cet instant ? */
export const isMuted = (conv: Conversation): boolean =>
  !!conv.mutedUntil && new Date(conv.mutedUntil) > new Date();

// --- Demandes de messages ---

/**
 * Conversations en attente d'acceptation — pendant web d'`app/requests.tsx`.
 *
 * ⚠️ Un non-ami qui écrit pour la première fois n'apparaît PAS dans `/conversations` : la
 * liste ne montre que les membres `accepted`. Sans cet écran, son message est invisible sur
 * le web — il attend qu'on ouvre le téléphone.
 *
 * ⚠️ Ces conversations ne déclenchent AUCUNE notification push (choix serveur) : seul un
 * badge les signale. Raison de plus pour que l'écran soit visible dans la liste.
 */
export const fetchMessageRequests = () => apiRequest<Conversation[]>('/conversations/requests');

export const acceptMessageRequest = (id: string) =>
  apiRequest(`/conversations/${id}/accept-request`, { method: 'POST' });

/**
 * Refuser une demande.
 *
 * ⚠️ Supprime la conversation POUR MOI. L'expéditeur n'est pas averti — ne rien laisser
 * entendre d'autre dans l'interface.
 */
export const declineMessageRequest = (id: string) =>
  apiRequest(`/conversations/${id}/request`, { method: 'DELETE' });
