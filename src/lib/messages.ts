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
  /** Groupe : description éditable par un admin (renvoyée par `GET /conversations/:id`). */
  description?: string | null;
  whoCanSend?: 'all' | 'admins';
  myRole?: 'admin' | 'moderator' | 'member';
  /** Premier message non lu et leur nombre — calculés par le SERVEUR (voir mobile). */
  firstUnreadId?: string | null;
  unreadCount?: number;
};

/** Page d'historique : du plus RÉCENT au plus ancien (contrat commun à tous les endpoints). */
/**
 * Page d'historique.
 *
 * ⚠️ `cursor` remonte vers le PASSÉ, `newerCursor` redescend vers le PRÉSENT. Le second sert
 * quand le fil a été ouvert au MILIEU de l'historique — sur un message épinglé, un résultat
 * de recherche — et doit pouvoir rejoindre le bas.
 */
export const fetchMessages = (
  conversationId: string,
  opts: { cursor?: string; newerCursor?: string } = {},
) =>
  apiRequest<Message[]>(
    `/conversations/${conversationId}/messages${
      opts.newerCursor
        ? `?newerCursor=${opts.newerCursor}`
        : opts.cursor
          ? `?cursor=${opts.cursor}`
          : ''
    }`,
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

// --- Détails d'une conversation ---

export type UserProfile = {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  phone: string | null;
  location: { city: string; country: string | null } | null;
  online: boolean;
  lastSeenAt: string | null;
  isFriend: boolean;
  mutualFriendsCount: number;
  relationStatus: 'self' | 'friends' | 'request_sent' | 'request_received' | 'none';
  /**
   * ⚠️ Ces cinq champs étaient renvoyés par le serveur mais ABSENTS du type : ce sont eux qui
   * décident des boutons. Sans eux, l'interface devait deviner ce qui est permis — et le
   * serveur refuse ce qu'il n'autorise pas, donc un bouton deviné échoue au clic.
   */
  requestId: string | null;
  isSelf: boolean;
  canMessage: boolean;
  canCall: boolean;
  canFriendRequest: boolean;
};

/**
 * Profil d'un autre utilisateur.
 *
 * ⚠️ GATED côté serveur : chaque champ n'est renvoyé que si la matrice de confidentialité de
 * la personne l'autorise (photo, bio, téléphone, dernière connexion, ville). Un champ absent
 * n'est pas une erreur — c'est un refus, et il ne faut donc rien afficher à sa place.
 */
export const fetchUserProfile = (userId: string) =>
  apiRequest<UserProfile>(`/users/${userId}/profile`);

export type MediaCounts = {
  images: number;
  videos: number;
  documents: number;
  audio: number;
  gifs: number;
  links: number;
};

export const fetchMediaCounts = (conversationId: string) =>
  apiRequest<MediaCounts>(`/conversations/${conversationId}/media-counts`);

/** Pièces jointes d'une catégorie, paginées (30 par page). */
/**
 * Pièces jointes d'une conversation, par catégorie.
 *
 * ⚠️ PAGINÉ : 30 par page, du plus récent au plus ancien, curseur sur l'identifiant du
 * dernier reçu. Sans `cursor`, on n'obtient que les 30 derniers — c'est ce qui oblige la
 * visionneuse à remonter page par page jusqu'au média sur lequel on a cliqué.
 */
export const fetchMedia = (conversationId: string, category: string, cursor?: string) =>
  apiRequest<Message[]>(
    `/conversations/${conversationId}/media?category=${category}${cursor ? `&cursor=${cursor}` : ''}`,
  );

// --- Modération ---

/**
 * Bloquer quelqu'un.
 *
 * ⚠️ Effets côté serveur : l'amitié est supprimée et les demandes en attente annulées. Ce
 * n'est pas un simple masquage — d'où la confirmation avant d'appeler.
 */
export const blockUser = (userId: string) =>
  apiRequest('/blocks', { method: 'POST', body: { userId } });

export const unblockUser = (userId: string) =>
  apiRequest(`/blocks/${userId}`, { method: 'DELETE' });

/**
 * ⚠️ `photoUrl` est bien renvoyé par le serveur (`getBlockedUsers`) : l'omettre du type
 * privait l'interface de l'avatar, et une liste de noms nus se reconnaît mal.
 */
export const fetchBlocked = () =>
  apiRequest<{ id: string; name: string; photoUrl: string | null }[]>('/blocks');

export type ReportCategory = 'spam' | 'impersonation' | 'inappropriate' | 'other';

export const REPORT_CATEGORIES: { key: ReportCategory; label: string }[] = [
  { key: 'spam', label: 'Spam' },
  { key: 'impersonation', label: 'Usurpation d’identité' },
  { key: 'inappropriate', label: 'Contenu inapproprié' },
  { key: 'other', label: 'Autre' },
];

export const reportUser = (userId: string, category: ReportCategory) =>
  apiRequest('/reports', { method: 'POST', body: { userId, category } });

/**
 * Messages épinglés de la conversation (niveau conversation : visibles par tous).
 *
 * ⚠️ Le serveur renvoie les MESSAGES eux-mêmes, pas des objets `{ message }` : il déballe la
 * table de jointure avant d'émettre (`stars.map(s => s.message)`). Vérifié dans le code du
 * service et contre l'API — je l'avais d'abord supposé de travers, d'où un plantage.
 */
export const fetchPins = (conversationId: string) =>
  apiRequest<Message[]>(`/conversations/${conversationId}/pins`);

/** Mes messages favoris dans cette conversation (PERSONNEL, contrairement aux épinglés). */
export const fetchStarred = (conversationId: string) =>
  apiRequest<Message[]>(`/conversations/${conversationId}/starred`);

/** Durée des messages éphémères, en secondes. `null` désactive. */
export const setEphemeral = (conversationId: string, duration: number | null) =>
  apiRequest(`/conversations/${conversationId}/ephemeral`, {
    method: 'PATCH',
    body: { duration },
  });

const DAY = 24 * 3600;
export const EPHEMERAL_OPTIONS: { label: string; value: number | null }[] = [
  { label: '24 heures', value: DAY },
  { label: '7 jours', value: 7 * DAY },
  { label: '30 jours', value: 30 * DAY },
  { label: 'Désactivé', value: null },
];

/**
 * Mon propre profil.
 *
 * ⚠️ À ne pas confondre avec `fetchUserProfile(id)`, qui renvoie une vue GATED de quelqu'un
 * d'autre (champs filtrés selon sa matrice de confidentialité). Ici rien n'est filtré : c'est
 * mon compte. La réponse porte aussi `fcmToken` et les réglages de confidentialité, dont
 * l'app web n'a pas l'usage — on ne type que ce qu'on affiche.
 */
export type Me = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  language: string;
  profile?: { bio: string | null } | null;
};

export const fetchMe = () => apiRequest<Me>('/users/me');

/**
 * Identifiant de la LIGNE qui affiche un message donné.
 *
 * ⚠️ Un album est plusieurs messages mais UNE ligne, ancrée sur le premier du lot. Chercher
 * un message par son identifiant dans le DOM échoue donc silencieusement dès qu'il s'agit du
 * 2ᵉ, 3ᵉ… média d'un envoi groupé : rien n'est trouvé, rien ne bouge, et le saut paraît
 * capricieux — il marche sur un message texte et pas sur celui d'à côté.
 *
 * Renvoie `null` si le message n'est affiché nulle part (bandeau système, message écarté).
 */
export const rowAnchorId = (messages: Message[], messageId: string): string | null => {
  for (const row of buildRows(messages)) {
    if (row.messages.some((m) => m.id === messageId)) return row.messages[0].id;
  }
  return null;
};

/**
 * Texte d'un bandeau système.
 *
 * ⚠️ Le `content` d'un message système n'est PAS du texte lisible mais une CLÉ i18n en JSON
 * (`{"k":"member_added","by":"UserA","who":"UserF"}`). L'afficher tel quel montrerait l'objet
 * brut — c'est pour cela que le web les écartait purement et simplement, et que ces
 * événements ne laissaient aucune trace : ajouter quelqu'un à un groupe, le renommer ou
 * activer les éphémères se produisait en silence.
 *
 * ⚠️ Traduit dans la langue du LECTEUR, pas de celui qui a agi : le serveur ne stocke que la
 * clé et ses paramètres, précisément pour que chaque membre lise l'événement chez lui.
 *
 * ⚠️ `dur` et `role` sont eux-mêmes des clés à traduire avant d'être injectés — sinon le
 * bandeau afficherait « a activé les messages éphémères (24h) » avec le code brut, et
 * « a nommé UserC admin » sans traduire le rôle.
 */
export const systemText = (
  raw: string | null | undefined,
  t: (key: string, params?: Record<string, string>) => string,
): string => {
  if (!raw) return '';
  try {
    const { k, dur, ...params } = JSON.parse(raw) as Record<string, string>;
    if (!k) return '';
    if (dur) params.duration = t(`ephemeral.${dur}`);
    if (params.role) params.role = t(`roles.${params.role}`);
    return t(`system.${k}`, params);
  } catch {
    // Contenu illisible (format d'une version antérieure) : rien plutôt qu'un objet brut.
    return '';
  }
};

/** Amis en commun avec quelqu'un (404 si l'un des deux a bloqué l'autre). */
export const fetchMutualFriends = (userId: string) =>
  apiRequest<{ id: string; name: string; photoUrl: string | null }[]>(
    `/users/${userId}/mutual-friends`,
  );
