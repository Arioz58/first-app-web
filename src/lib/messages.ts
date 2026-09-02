import { apiRequest } from './api';
import type { Member } from './conversations';

/**
 * Fil de discussion — types et règles portés depuis `app/chat/[id].tsx` du mobile.
 *
 * ⚠️ Le contrat serveur est partagé : tout ce qui est décrit ici décrit aussi le mobile.
 * Une divergence entre les deux clients se verrait comme un bug de synchronisation.
 */

export type Sender = { id: string; name: string; photoUrl?: string | null };

/** Extrait d'un message cité. Volontairement PLAT — le serveur ne rouvre pas la citation. */
export type Quote = {
  id: string;
  senderId: string;
  sender?: { id: string; name: string } | null;
  type?: string | null;
  content?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
  /** Le message cité était éphémère et a expiré : le serveur a vidé ce qu'il portait. */
  expired?: boolean;
};

export type Reaction = { userId: string; emoji: string };

export type LinkPreview = {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
};

export type Message = {
  id: string;
  content: string | null;
  createdAt: string;
  sender: Sender;
  conversationId?: string;
  type?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  mimeType?: string | null;
  /** Médias d'un même envoi : plusieurs messages, UNE bulle. */
  batchId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  replyTo?: Quote | null;
  /**
   * ⚠️ ABSENT du payload `new_message` : un message neuf n'a aucune réaction, et le serveur
   * ne renvoie pas un tableau vide. Toujours lire avec `?.` — c'est l'événement
   * `message_reaction` qui l'alimentera ensuite.
   */
  reactions?: Reaction[];
  forwarded?: boolean;
  expiresAt?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  linkPreview?: LinkPreview | null;
  storyMediaUrl?: string | null;
  /** Bulle posée localement le temps de l'envoi — voir `pushDraft` dans l'écran. */
  pendingLocal?: boolean;
};

export type ConvMember = Member & {
  role: string;
  lastDeliveredAt?: string | null;
  lastReadAt?: string | null;
};

export type ConvMeta = {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  photoUrl?: string | null;
  members: ConvMember[];
  ephemeralDuration: number | null;
  myMutedUntil: string | null;
  whoCanSend?: 'all' | 'admins';
  myRole?: 'admin' | 'moderator' | 'member';
  /** Premier message non lu et leur nombre — calculés par le SERVEUR (voir mobile). */
  firstUnreadId?: string | null;
  unreadCount?: number;
};

/** Page d'historique : du plus RÉCENT au plus ancien (contrat commun à tous les endpoints). */
export const fetchMessages = (conversationId: string, cursor?: string) =>
  apiRequest<Message[]>(
    `/conversations/${conversationId}/messages${cursor ? `?cursor=${cursor}` : ''}`,
  );

export const fetchConversationMeta = (conversationId: string) =>
  apiRequest<ConvMeta>(`/conversations/${conversationId}`);

export const markConversationRead = (conversationId: string) =>
  apiRequest(`/conversations/${conversationId}/read`, { method: 'POST' });

/**
 * Ajoute des messages en écartant ceux déjà présents.
 *
 * ⚠️ Filet volontaire, comme sur mobile : le fil est alimenté par plusieurs chemins
 * (historique, pagination, socket, rattrapage à la reconnexion) qui peuvent se recouvrir.
 * Un doublon ne dégrade pas l'affichage, il le CASSE — clés dupliquées, cellules omises. Le
 * dédoublonnage porte AUSSI sur l'arrivage lui-même, qui peut contenir deux fois le même
 * message.
 */
export const mergeMessages = (
  prev: Message[],
  incoming: Message[],
  position: 'start' | 'end',
): Message[] => {
  const known = new Set(prev.map((m) => m.id));
  const fresh: Message[] = [];
  for (const m of incoming) {
    if (known.has(m.id)) continue;
    known.add(m.id);
    fresh.push(m);
  }
  if (!fresh.length) return prev;
  return position === 'start' ? [...fresh, ...prev] : [...prev, ...fresh];
};

/** Fenêtre de regroupement des séries — 2 minutes, comme le mobile depuis le 31 août. */
const GROUP_WINDOW_MS = 2 * 60 * 1000;

/** `a` précède `b` : même auteur, dans une fenêtre courte, hors bandeaux système. */
export const sameGroup = (a?: Message, b?: Message): boolean =>
  !!a &&
  !!b &&
  a.type !== 'system' &&
  b.type !== 'system' &&
  !!a.sender?.id &&
  a.sender.id === b.sender?.id &&
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() < GROUP_WINDOW_MS;

/** Une ligne du fil : un message seul, ou les médias d'un même envoi (album). */
export type Row = { key: string; messages: Message[] };

const isImageLike = (mt?: string | null) => mt === 'image' || mt === 'video' || mt === 'gif';

/** Regroupe les médias d'un même `batchId` en une seule ligne. */
export const buildRows = (messages: Message[]): Row[] => {
  const out: Row[] = [];
  for (const m of messages) {
    const groupable = !!m.batchId && isImageLike(m.mediaType) && m.type !== 'system';
    const last = out[out.length - 1];
    const lastGroupable =
      last && !!last.messages[0].batchId && isImageLike(last.messages[0].mediaType);
    if (groupable && lastGroupable && last.messages[0].batchId === m.batchId) {
      last.messages.push(m);
    } else {
      out.push({ key: m.id, messages: [m] });
    }
  }
  return out;
};

/**
 * Libellé d'un séparateur de date.
 *
 * ⚠️ Comparaison sur la date LOCALE et non sur un écart en heures : deux messages séparés
 * de dix minutes peuvent tomber de part et d'autre de minuit.
 */
export const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  if (today.getTime() - d.getTime() < 6 * 24 * 3600 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Compte les pictogrammes d'un message qui n'en contient QUE.
 *
 * ⚠️ Les ZWJ et sélecteurs de variante sont retirés AVANT le comptage : une famille 👨‍👩‍👧 ou
 * un ❤️ s'écrivent sur plusieurs points de code, et les compter tels quels ferait passer un
 * seul emoji pour trois.
 */
export const emojiCount = (raw?: string | null): number => {
  const t = (raw ?? '').trim();
  if (!t) return 0;
  const stripped = t.replace(/[\s‍️]/gu, '');
  if (!stripped || !/^\p{Extended_Pictographic}+$/u.test(stripped)) return 0;
  return [...stripped].length;
};

// --- Actions sur les messages ---

/** Réaction : poser, remplacer, ou retirer (le même emoji reposé la retire). */
export const reactToMessage = (conversationId: string, messageId: string, emoji: string | null) =>
  apiRequest<{ reactions: Reaction[] }>(
    `/conversations/${conversationId}/messages/${messageId}/reaction`,
    { method: 'POST', body: { emoji } },
  );

/**
 * Suppression. `scope: 'me'` ne regarde que soi ; `'all'` vide réellement le message côté
 * serveur (délai de 2 jours pour l'auteur, illimité pour un admin de groupe).
 */
export const deleteMessage = (
  conversationId: string,
  messageId: string,
  scope: 'me' | 'all',
) =>
  apiRequest(`/conversations/${conversationId}/messages/${messageId}?scope=${scope}`, {
    method: 'DELETE',
  });

/** Modification d'un de SES messages texte, dans les 15 minutes. */
export const editMessage = (conversationId: string, messageId: string, content: string) =>
  apiRequest<Message>(`/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: { content },
  });

export const pinMessage = (conversationId: string, messageId: string, pinned: boolean) =>
  apiRequest(`/conversations/${conversationId}/messages/${messageId}/pin`, {
    method: pinned ? 'DELETE' : 'POST',
  });

export const starMessage = (conversationId: string, messageId: string, starred: boolean) =>
  apiRequest(`/conversations/${conversationId}/messages/${messageId}/star`, {
    method: starred ? 'DELETE' : 'POST',
  });

export type Flags = { pinned: string[]; starred: string[] };

export const fetchFlags = (conversationId: string) =>
  apiRequest<Flags>(`/conversations/${conversationId}/flags`);

/** Recherche dans la conversation courante (≥ 2 caractères côté serveur). */
export const searchInConversation = (conversationId: string, q: string) =>
  apiRequest<{ id: string; content: string | null; createdAt: string; senderId: string }[]>(
    `/conversations/${conversationId}/search?q=${encodeURIComponent(q)}`,
  );

/**
 * Fenêtre d'historique CENTRÉE sur un message.
 *
 * ⚠️ Seule façon d'atteindre une cible arbitrairement ancienne — un épinglé d'il y a un mois,
 * un résultat de recherche. On ne peut pas défiler vers un message absent de la liste, et
 * remonter page par page serait interminable.
 */
export const fetchAround = (conversationId: string, messageId: string) =>
  apiRequest<{ messages: Message[]; hasOlder: boolean; hasNewer: boolean }>(
    `/conversations/${conversationId}/messages/around/${messageId}?before=30&after=10`,
  );

/** Les 6 réactions rapides, dans le même ordre que le mobile — le geste doit être identique. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
