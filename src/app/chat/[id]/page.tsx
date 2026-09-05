'use client';

import { MediaViewer } from '@/components/MediaViewer';
import { UserProfileDialog } from '@/components/UserProfileDialog';
import { useTranslation } from 'react-i18next';
import { canManageMembers, type Role } from '@/lib/groups';
import {
  IconAttach,
  IconBack,
  IconCheck,
  IconClose,
  IconDown,
  IconMic,
  IconPin,
  IconSearch,
  IconSend,
  IconSpinner,
  IconUp,
} from '@/components/icons';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { MessageBubble } from '@/components/MessageBubble';
import { setSessionExpiredHandler } from '@/lib/api';
import { hasSession } from '@/lib/auth';
import {
  buildRows,
  rowAnchorId,
  dayLabel,
  deleteMessage,
  editMessage,
  fetchAround,
  fetchConversationMeta,
  fetchFlags,
  fetchMessages,
  markConversationRead,
  mergeMessages,
  pinMessage,
  reactToMessage,
  sameGroup,
  searchInConversation,
  starMessage,
  type ConvMeta,
  type Flags,
  type Message,
  type Quote,
} from '@/lib/messages';
import { mediaKindOf, uploadFile } from '@/lib/upload';
import type { BubbleActions } from '@/components/MessageBubble';
import { ForwardDialog } from '@/components/ForwardDialog';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { DetailsPanel } from '@/components/DetailsPanel';
import { fetchConversations, type Conversation } from '@/lib/conversations';
import { connectSocket } from '@/lib/socket';
import { getUserId } from '@/lib/storage';

/** Distance au bas en deçà de laquelle on considère l'utilisateur « en bas ». */
/**
 * Durée maximale de calage d'un saut.
 *
 * ⚠️ Un plafond, pas une durée d'animation : on s'arrête normalement dès que la hauteur
 * cesse de bouger. Il n'existe que pour le cas où une image ne charge jamais — sans lui, on
 * re-viserait indéfiniment et le fil serait impossible à faire défiler à la main.
 */
const JUMP_SETTLE_MS = 1200;

const AT_BOTTOM_PX = 120;
/** Déclenchement du chargement d'historique, en pixels depuis le haut. */
const LOAD_OLDER_PX = 300;

export default function ThreadPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [meId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getUserId(),
  );

  const [meta, setMeta] = useState<ConvMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  /** Présence de l'interlocuteur — conversation directe seulement. */
  const [presence, setPresence] = useState<{ online: boolean; lastSeenAt: string | null }>({
    online: false,
    lastSeenAt: null,
  });
  /**
   * Accusés par membre, dont on déduit l'état d'acheminement de MES messages.
   *
   * ⚠️ Le détail PAR MEMBRE est indispensable : en groupe, un message n'est « lu » que
   * lorsque TOUS les autres l'ont dépassé. Se contenter du dernier événement afficherait la
   * double coche dès le premier destinataire servi.
   */
  const [receipts, setReceipts] = useState<
    Record<string, { delivered?: string; read?: string }>
  >({});
  const [atBottom, setAtBottom] = useState(true);
  const [hasOlder, setHasOlder] = useState(true);
  /**
   * Reste-t-il des messages PLUS RÉCENTS que ceux affichés ?
   *
   * ⚠️ Faux tant qu'on n'a pas sauté ailleurs : le fil s'ouvre sur les derniers messages,
   * il n'y a rien de plus récent. Il ne passe à vrai qu'après un saut vers une fenêtre
   * centrée sur un message ancien.
   */
  const [hasNewer, setHasNewer] = useState(false);
  /**
   * Repère « N nouveaux messages » : identifiant du premier non lu et leur nombre.
   *
   * ⚠️ CALCULÉ PAR LE SERVEUR (`GET /conversations/:id`). Le déduire des messages chargés ne
   * marcherait que si le premier non lu se trouve dans la dernière page — avec cent messages
   * en attente, il est hors de portée.
   *
   * ⚠️ RETENU pour toute la visite, alors que `POST /read` l'efface côté serveur dès
   * l'ouverture. Sans cela le repère disparaîtrait avant d'avoir été vu, ce qui revient à ne
   * pas l'avoir.
   */
  const [unreadMark, setUnreadMark] = useState<{ id: string; count: number } | null>(null);
  /** Message auquel la prochaine saisie répondra. */
  const [replyTo, setReplyTo] = useState<Quote | null>(null);
  /** Message en cours de modification — le composeur bascule alors en édition. */
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  const [flags, setFlags] = useState<Flags>({ pinned: [], starred: [] });
  /** Message rejoint (citation, épinglé, recherche) : surligné brièvement. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Index de l'épinglé affiché : chaque clic passe au suivant, en cyclant. */
  const [pinIndex, setPinIndex] = useState(0);
  const [pinBarHidden, setPinBarHidden] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /**
   * Réglages personnels de CETTE conversation (sourdine, favori…).
   *
   * ⚠️ Ils vivent sur `ConversationMember` et arrivent par `GET /conversations`, pas par les
   * métadonnées du fil — d'où cette lecture séparée.
   */
  const [convSettings, setConvSettings] = useState<Conversation | null>(null);
  /** Média ouvert en plein écran. La visionneuse parcourt ensuite toute la conversation. */
  const [viewer, setViewer] = useState<Message | null>(null);
  /**
   * Profil ouvert depuis la liste des membres d'un groupe.
   *
   * ⚠️ Instance PROPRE à cet écran, distincte de celle de `ConversationList`. Les deux vivent
   * dans des sous-arbres disjoints — la liste est montée par le layout, ce fil par la page —
   * et aucun parent commun ne porte d'état côté client. Elles ne peuvent pas être ouvertes en
   * même temps : chacune ne s'ouvre que depuis sa propre colonne.
   */
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [search, setSearch] = useState<{ term: string; results: string[]; index: number } | null>(
    null,
  );
  /** Messages à transférer — un album en compte plusieurs pour une seule bulle. */
  const [forwarding, setForwarding] = useState<Message[] | null>(null);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  /**
   * Le fil doit-il RESTER collé au bas quand son contenu grandit ?
   *
   * ⚠️ Une intention, pas une mesure. Se contenter de `atBottom` ne suffirait pas : cet état
   * est déduit d'un événement de défilement, or c'est justement quand le contenu grandit
   * SANS défilement que le fil décroche.
   */
  const stickRef = useRef(true);
  /**
   * Position à RETENIR pendant que le contenu grandit, quand ce n'est pas le bas.
   *
   * ⚠️ L'observateur de taille ne savait que recoller au BAS. À l'ouverture sur un repère de
   * reprise, la mise en page grandit ensuite (images, cartes d'aperçu) et le repère
   * s'éloignait de sa place — mesuré à 581 px de dérive, exactement le défaut corrigé pour
   * l'ouverture en bas. Cette fonction dit à l'observateur quoi retenir d'autre.
   */
  const holdRef = useRef<(() => void) | null>(null);
  /**
   * Le fil est en cours de POSITIONNEMENT par le code (ouverture, saut, retour au présent).
   *
   * ⚠️ Tant qu'il est levé, `onScroll` ne déduit rien : les mouvements observés sont ceux
   * qu'on provoque soi-même. En tirer une intention est exactement la faute que le fil
   * mobile avait dû corriger (`lib/threadScroll.ts` : « pendant `opening` et `jumping`,
   * `onScroll` ne déduit rien »).
   */
  const positioningRef = useRef(false);
  /**
   * ⚠️ Miroir de `hasNewer` pour l'écouteur socket : celui-ci est posé UNE fois et ne verrait
   * jamais la valeur d'état changer. Même motif que `otherUserIdRef` sur mobile.
   */
  const hasNewerRef = useRef(false);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentRef = useRef(false);
  /** Vrai tant que l'ouverture n'a pas calé le fil : le premier scroll ne doit pas s'animer. */
  const openingRef = useRef(true);

  const rows = useMemo(() => buildRows(messages), [messages]);

  /**
   * Défilement vers le bas.
   *
   * ⚠️ Bien plus simple que sur mobile : le DOM MESURE réellement ses éléments, là où
   * `FlatList` estimait les hauteurs — toute la machinerie de calage du mobile (machine à
   * états, reprises, fenêtres asymétriques) existait pour compenser cette estimation.
   */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  /**
   * Applique une position et la TIENT pendant que la mise en page se stabilise.
   *
   * ⚠️ Une seule tentative ne suffit jamais : les images et les cartes d'aperçu n'ont pas
   * leur hauteur au premier rendu, et la position calculée dérive dès que l'une d'elles se
   * charge. On ré-applique donc à chaque image, et on s'arrête dès que la hauteur totale
   * cesse de bouger — pas au bout d'un délai fixe, qu'on aurait choisi au hasard.
   *
   * ⚠️ `onScroll` est neutralisé pendant toute l'opération (`positioningRef`).
   */
  const settle = useCallback((apply: () => void) => {
    positioningRef.current = true;
    const startedAt = Date.now();
    let lastHeight = -1;
    let stable = 0;
    const step = () => {
      const el = scrollRef.current;
      if (!el) {
        // ⚠️ Le drapeau DOIT retomber ici aussi : l'oublier figerait le fil pour de bon.
        positioningRef.current = false;
        return;
      }
      apply();
      stable = el.scrollHeight === lastHeight ? stable + 1 : 0;
      lastHeight = el.scrollHeight;
      // Deux images de suite sans changement de hauteur : la mise en page a fini.
      if (stable < 2 && Date.now() - startedAt < JUMP_SETTLE_MS) requestAnimationFrame(step);
      else positioningRef.current = false;
    };
    requestAnimationFrame(step);
  }, []);

  /**
   * Retour au PRÉSENT depuis le bouton flottant.
   *
   * ⚠️ Défiler ne suffit pas quand on a sauté dans le passé : le bas de la fenêtre chargée
   * n'est pas le bas de la conversation. On RECHARGE donc la dernière page, plutôt que de
   * remonter le fil page par page — ce qui prendrait autant d'allers-retours qu'il y a de
   * messages entre les deux.
   */
  const goToPresent = useCallback(() => {
    if (!hasNewer) {
      scrollToBottom(true);
      return;
    }
    void (async () => {
      try {
        const page = await fetchMessages(id);
        setMessages(page.slice().reverse());
        setHasNewer(false);
        // La page fraîche ne contient que les derniers messages : tout le reste est de
        // nouveau « plus ancien », y compris ce qu'on avait déjà chargé.
        setHasOlder(true);
        setAtBottom(true);
        stickRef.current = true;
        /**
         * ⚠️ DEUX images successives. La première laisse React poser le DOM, la seconde
         * mesure une fois les hauteurs stabilisées — images et cartes d'aperçu grandissent
         * après leur premier rendu. Avec une seule, le fil s'arrêtait à ~120 px du bas et le
         * bouton de retour restait affiché alors qu'on venait de l'utiliser.
         */
        settle(() => scrollToBottom(false));
      } catch {
        // Réseau : on laisse le fil tel quel, le bouton reste disponible.
      }
    })();
  }, [hasNewer, id, scrollToBottom, settle]);

  // ⚠️ Synchronisé dans un EFFET et non pendant le rendu : React 19 interdit d'écrire une
  // ref au rendu (la valeur pourrait être celle d'un rendu abandonné).
  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);

  // --- Chargement initial ---
  useEffect(() => {
    setSessionExpiredHandler(() => router.replace('/login'));
    if (!hasSession()) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [m, page, f] = await Promise.all([
          fetchConversationMeta(id),
          fetchMessages(id),
          fetchFlags(id).catch(() => ({ pinned: [], starred: [] }) as Flags),
        ]);
        if (cancelled) return;
        setMeta(m);
        setFlags(f);
        // État initial des accusés : Prisma renvoie déjà les deux dates par membre.
        setReceipts(
          Object.fromEntries(
            m.members
              .filter((x) => x.userId !== meId)
              .map((x) => [
                x.userId,
                { delivered: x.lastDeliveredAt ?? undefined, read: x.lastReadAt ?? undefined },
              ]),
          ),
        );
        // L'API renvoie du plus récent au plus ancien : le fil s'affiche dans l'autre sens.
        const mark = m.firstUnreadId && (m.unreadCount ?? 0) > 0
          ? { id: m.firstUnreadId, count: m.unreadCount ?? 0 }
          : null;
        setUnreadMark(mark);

        /**
         * ⚠️ Le premier non lu peut être HORS de la dernière page. On charge alors une
         * fenêtre centrée sur lui, comme le fait un saut vers un épinglé : on ne peut pas
         * défiler vers une ligne absente du fil, et remonter page par page serait
         * interminable.
         */
        if (mark && !page.some((x) => x.id === mark.id)) {
          const win = await fetchAround(id, mark.id).catch(() => null);
          if (win && !cancelled) {
            setMessages(win.messages.slice().reverse());
            setHasOlder(win.hasOlder);
            setHasNewer(win.hasNewer);
            // On n'est plus au présent : le bouton de retour doit être proposé.
            if (win.hasNewer) {
              setAtBottom(false);
              stickRef.current = false;
            }
          } else {
            setMessages(page.slice().reverse());
            setHasOlder(page.length >= 30);
          }
        } else {
          setMessages(page.slice().reverse());
          setHasOlder(page.length >= 30);
        }
        void markConversationRead(id);
      } catch {
        // Session expirée : le handler a déjà redirigé.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // ⚠️ `meId` volontairement hors dépendances : il vient d'un initialiseur paresseux et ne
    // change jamais pendant la vie de l'écran. L'ajouter n'apporterait rien, et relancerait
    // le chargement si sa référence bougeait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  /**
   * Maintien au bas pendant que le contenu grandit.
   *
   * ⚠️ Indispensable, et pas seulement pour le retour au présent : les images et les cartes
   * d'aperçu n'ont pas de hauteur tant qu'elles ne sont pas chargées. Le fil se calait donc
   * sur une hauteur provisoire, puis le contenu grandissait sous lui — à l'ouverture, le
   * dernier message se retrouvait près d'un écran plus bas que la zone visible, mesuré à
   * 565 px sur une conversation avec huit images.
   *
   * ⚠️ Un `ResizeObserver` sur le CONTENU et non un minuteur : on ne peut pas deviner quand
   * la dernière image aura fini de charger, et re-caler en boucle « au cas où » arracherait
   * le fil à qui est en train de lire.
   */
  useEffect(() => {
    const el = scrollRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      // Une position retenue l'emporte sur le suivi du bas : elle a été demandée.
      if (holdRef.current) holdRef.current();
      else if (stickRef.current) el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [loading]);

  /**
   * Calage à l'ouverture : sur le repère de reprise s'il y en a un, en bas sinon.
   *
   * ⚠️ Le repère est amené EN HAUT de l'écran et non centré : ce qu'on veut lire, ce sont
   * les messages qui le SUIVENT. Centré, la moitié de la place serait donnée à ce qu'on a
   * déjà lu.
   */
  useEffect(() => {
    if (loading || !openingRef.current || !messages.length) return;
    openingRef.current = false;
    const anchor = unreadMark
      ? document.getElementById(`unread-${unreadMark.id}`)
      : null;
    if (anchor) {
      const toMark = () =>
        document
          .getElementById(`unread-${unreadMark!.id}`)
          ?.scrollIntoView({ behavior: 'auto', block: 'start' });
      settle(toMark);
      /**
       * ⚠️ Retenu AU-DELÀ du calage : les images se chargent sur plusieurs secondes, bien
       * après que la hauteur se soit stabilisée deux images de suite. Sans cela le repère
       * dérivait à mesure qu'elles arrivaient.
       */
      holdRef.current = toMark;
      // ⚠️ Pas collé au bas : on vient d'y placer volontairement autre chose.
      stickRef.current = false;
      // ⚠️ Différé : posé directement dans l'effet, ce `setState` serait synchrone au montage
      // — rendu en cascade, que React 19 signale comme une erreur. Même motif que
      // `NewChatDialog`. La ref, elle, n'est pas un état et peut être écrite ici.
      queueMicrotask(() => setAtBottom(false));
    } else {
      settle(() => scrollToBottom(false));
    }
  }, [loading, messages.length, scrollToBottom, settle, unreadMark]);

  // --- Temps réel ---
  useEffect(() => {
    if (!hasSession()) return;
    const socket = connectSocket();
    socket.emit('join_conversation', id);

    const onNew = (msg: Message) => {
      if (msg.conversationId && msg.conversationId !== id) return;
      setMessages((prev) => {
        /**
         * ⚠️ L'écho de MON propre envoi remplace le brouillon EN PLACE, il ne s'ajoute pas :
         * sinon le message apparaîtrait en double. L'appariement se fait sur le contenu et
         * l'expéditeur — un message texte n'a ni URL ni identifiant commun sur lequel
         * s'accrocher. Deux messages identiques d'affilée peuvent s'apparier dans le
         * désordre, sans conséquence : les bulles sont identiques.
         */
        if (msg.sender?.id === meId) {
          const i = prev.findIndex(
            (m) => m.pendingLocal && m.content === msg.content && m.sender?.id === meId,
          );
          if (i !== -1) {
            const next = [...prev];
            next[i] = msg;
            return next;
          }
        }
        /**
         * ⚠️ Le fil est ouvert au MILIEU de l'historique : ce message n'y appartient pas à la
         * suite. L'ajouter le collerait derrière un message d'il y a un mois, en sautant tout
         * ce qui les sépare. Il sera récupéré au retour vers le présent.
         */
        if (hasNewerRef.current) return prev;
        return mergeMessages(prev, [msg], 'end');
      });
      // Lu à l'instant : la conversation est ouverte sous les yeux.
      void markConversationRead(id);
      // ⚠️ On ne suit le bas que si l'on y ÉTAIT : sinon on couperait la lecture de
      // quelqu'un en train de remonter l'historique.
      const el = scrollRef.current;
      const wasAtBottom =
        !el || el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
      if (wasAtBottom || msg.sender?.id === meId) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
    };

    const onTyping = (d: { conversationId: string; userId: string; typing: boolean }) => {
      if (d.conversationId !== id || d.userId === meId) return;
      setPeerTyping(d.typing);
    };

    const onDeleted = ({ messageId }: { conversationId: string; messageId: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deletedAt: new Date().toISOString(), content: '', mediaUrl: null, reactions: [] }
            : m,
        ),
      );
    };

    const onReaction = (d: { conversationId: string; messageId: string; reactions: Message['reactions'] }) => {
      if (d.conversationId !== id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === d.messageId ? { ...m, reactions: d.reactions } : m)),
      );
    };

    const otherId = () => meta?.members.find((x) => x.userId !== meId)?.userId;

    const onPresence = (d: { userId: string; online: boolean; lastSeenAt: string | null }) => {
      if (d.userId !== otherId()) return;
      setPresence({ online: d.online, lastSeenAt: d.lastSeenAt });
    };

    const onDelivered = (d: { conversationId: string; userId: string; at: string }) => {
      if (d.conversationId !== id) return;
      setReceipts((prev) => ({ ...prev, [d.userId]: { ...prev[d.userId], delivered: d.at } }));
    };

    const onRead = (d: { conversationId: string; userId: string; at: string }) => {
      if (d.conversationId !== id) return;
      // Lire implique avoir reçu : sans cela l'accusé de lecture sauterait par-dessus celui
      // de réception, et la bulle passerait d'une coche à deux coches bleues.
      setReceipts((prev) => ({
        ...prev,
        [d.userId]: { delivered: prev[d.userId]?.delivered ?? d.at, read: d.at },
      }));
    };

    /** Aperçu de lien : résolu par le serveur APRÈS l'envoi, il arrive séparément. */
    const onPreview = (d: {
      conversationId: string;
      messageId: string;
      linkPreview: Message['linkPreview'];
    }) => {
      if (d.conversationId !== id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === d.messageId ? { ...m, linkPreview: d.linkPreview } : m)),
      );
    };

    const onEdited = (d: {
      conversationId: string;
      messageId: string;
      content: string;
      editedAt: string;
    }) => {
      if (d.conversationId !== id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === d.messageId ? { ...m, content: d.content, editedAt: d.editedAt } : m,
        ),
      );
    };

    /**
     * Composition du groupe modifiée par quelqu'un d'autre (ajout, expulsion, départ,
     * renommage, changement de rôle).
     *
     * ⚠️ On RECHARGE les métadonnées au lieu d'appliquer un delta : les événements ne portent
     * que des identifiants, pas les noms ni les rôles, et un rôle changé ailleurs n'émet même
     * pas d'événement dédié. Relire est une requête, contre un état qui divergerait autrement.
     */
    const onGroupChanged = (d: { conversationId: string }) => {
      if (d.conversationId !== id) return;
      void fetchConversationMeta(id).then(setMeta).catch(() => {});
    };
    /**
     * On m'a retiré du groupe : la conversation ne m'est plus accessible.
     *
     * ⚠️ Rediriger AVANT que quoi que ce soit ne la rappelle — le serveur répondrait 403 sur
     * chaque requête suivante, et l'écran se remplirait d'erreurs au lieu de se fermer.
     */
    const onRemovedFromGroup = (d: { conversationId: string }) => {
      if (d.conversationId !== id) return;
      router.replace('/chat');
    };

    socket.on('presence_update', onPresence);
    socket.on('members_added', onGroupChanged);
    socket.on('member_removed', onGroupChanged);
    socket.on('member_left', onGroupChanged);
    socket.on('group_updated', onGroupChanged);
    socket.on('removed_from_group', onRemovedFromGroup);
    socket.on('conversation_delivered', onDelivered);
    socket.on('conversation_read', onRead);
    socket.on('message_preview', onPreview);
    socket.on('message_edited', onEdited);
    socket.on('new_message', onNew);
    socket.on('peer_typing', onTyping);
    socket.on('message_deleted', onDeleted);
    socket.on('message_reaction', onReaction);

    return () => {
      socket.emit('leave_conversation', id);
      socket.off('presence_update', onPresence);
      socket.off('members_added', onGroupChanged);
      socket.off('member_removed', onGroupChanged);
      socket.off('member_left', onGroupChanged);
      socket.off('group_updated', onGroupChanged);
      socket.off('removed_from_group', onRemovedFromGroup);
      socket.off('conversation_delivered', onDelivered);
      socket.off('conversation_read', onRead);
      socket.off('message_preview', onPreview);
      socket.off('message_edited', onEdited);
      socket.off('new_message', onNew);
      socket.off('peer_typing', onTyping);
      socket.off('message_deleted', onDeleted);
      socket.off('message_reaction', onReaction);
    };
  }, [id, meId, scrollToBottom, meta, router]);

  // Masquage automatique de l'indicateur de frappe, comme sur mobile (5 s).
  useEffect(() => {
    if (!peerTyping) return;
    const t = setTimeout(() => setPeerTyping(false), 5000);
    return () => clearTimeout(t);
  }, [peerTyping]);

  // --- Pagination vers le haut ---
  const loadOlder = useCallback(() => {
    if (loadingOlderRef.current || !hasOlder || !messages.length) return;
    loadingOlderRef.current = true;
    const el = scrollRef.current;
    // ⚠️ On mémorise la hauteur AVANT insertion : ajouter en tête pousse le contenu vers le
    // bas, et sans compensation le fil sauterait d'une page entière sous les yeux.
    const before = el?.scrollHeight ?? 0;

    void (async () => {
      try {
        const page = await fetchMessages(id, { cursor: messages[0].id });
        if (page.length < 30) setHasOlder(false);
        if (page.length) {
          setMessages((prev) => mergeMessages(prev, page.slice().reverse(), 'start'));
          requestAnimationFrame(() => {
            const after = scrollRef.current?.scrollHeight ?? 0;
            if (scrollRef.current) scrollRef.current.scrollTop += after - before;
          });
        }
      } catch {
        // Réseau : on laisse `hasOlder` à vrai, le prochain passage réessaiera.
      } finally {
        loadingOlderRef.current = false;
      }
    })();
  }, [hasOlder, id, messages]);

  /**
   * Pagination vers le BAS — le retour vers le présent.
   *
   * ⚠️ Indispensable dès qu'on ouvre le fil au MILIEU de l'historique (un épinglé, un
   * résultat de recherche) : la fenêtre chargée s'arrête à ce message, et sans ce chemin le
   * bas du fil était une impasse — les messages récents avaient disparu de la liste et rien
   * n'allait les rechercher.
   *
   * ⚠️ Aucune compensation de défilement ici, contrairement à `loadOlder` : ajouter à la FIN
   * ne déplace pas ce qui est déjà à l'écran. C'est l'insertion en tête qui pousse le
   * contenu.
   */
  const loadNewer = useCallback(() => {
    if (loadingNewerRef.current || !hasNewer || !messages.length) return;
    loadingNewerRef.current = true;

    void (async () => {
      try {
        const page = await fetchMessages(id, { newerCursor: messages[messages.length - 1].id });
        if (page.length < 30) setHasNewer(false);
        if (page.length) setMessages((prev) => mergeMessages(prev, page.slice().reverse(), 'end'));
      } catch {
        // Réseau : `hasNewer` reste vrai, le prochain passage réessaiera.
      } finally {
        loadingNewerRef.current = false;
      }
    })();
  }, [hasNewer, id, messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    /**
     * ⚠️ « En bas » ne suffit plus à dire « à jour » : après un saut, on peut toucher le bas
     * d'une fenêtre qui s'arrête un mois en arrière. Tant qu'il reste des messages plus
     * récents à charger, le bouton de retour au présent doit rester visible.
     */
    /**
     * ⚠️ Pendant un saut, `onScroll` ne déduit RIEN et ne charge RIEN : les mouvements qu'il
     * observe sont ceux qu'on provoque soi-même. En tirer une intention est exactement la
     * faute que le fil mobile avait dû corriger (`lib/threadScroll.ts`).
     */
    /**
     * ⚠️ Le premier défilement VOLONTAIRE libère la position retenue : à partir de là, c'est
     * l'utilisateur qui décide où se trouve le fil. `positioningRef` garantit qu'on ne prend
     * pas nos propres mouvements pour les siens.
     */
    if (positioningRef.current) return;
    holdRef.current = null;
    const nearBottom = distanceToBottom < AT_BOTTOM_PX;
    setAtBottom(nearBottom && !hasNewer);
    // Remonter dans l'historique, c'est renoncer au suivi ; redescendre, le reprendre.
    stickRef.current = nearBottom && !hasNewer;
    if (el.scrollTop < LOAD_OLDER_PX) loadOlder();
    if (distanceToBottom < LOAD_OLDER_PX) loadNewer();
  };

  // --- Envoi ---
  // ⚠️ Déclaré AVANT `send`, qui l'appelle : un `const` n'est pas remonté.
  const stopTyping = () => {
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (typingSentRef.current) {
      connectSocket().emit('typing', { conversationId: id, typing: false });
      typingSentRef.current = false;
    }
  };

  /**
   * ⚠️ `useCallback` et non une fonction nue : `send` appelle `Date.now()`, et une fonction
   * déclarée dans le corps du composant est vue par la règle « pas d'appel impur pendant le
   * rendu » comme si elle s'y exécutait. Enveloppée, elle est reconnue pour ce qu'elle est —
   * un gestionnaire d'événement, où l'heure courante est parfaitement légitime.
   */
  const send = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();

    // Mode édition : on modifie au lieu d'envoyer.
    if (editing) {
      const target = editing;
      setEditing(null);
      setText(target.original);
      if (!content) return;
      // Optimiste, avec restauration si le serveur refuse (fenêtre écoulée, horloge décalée).
      const before = messages.find((m) => m.id === target.id)?.content ?? '';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === target.id ? { ...m, content, editedAt: new Date().toISOString() } : m,
        ),
      );
      void editMessage(id, target.id, content).catch((err) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === target.id ? { ...m, content: before } : m)),
        );
        window.alert(err.message);
      });
      return;
    }

    if (!content) return;
    const socket = connectSocket();

    /**
     * Bulle OPTIMISTE : le message s'affiche avant l'écho du serveur.
     *
     * ⚠️ Sans elle, on tape, on valide, et rien ne bouge tant que le serveur n'a pas
     * répondu — sur un réseau lent, l'impression que l'envoi a échoué.
     *
     * ⚠️ L'identifiant est LOCAL (`local-…`) : le vrai est attribué par le serveur. L'écho
     * arrive ensuite par `new_message` et remplace ce brouillon, apparié sur le contenu et
     * l'expéditeur — faute d'URL ou d'identifiant commun sur un message texte.
     */
    const draft: Message = {
      id: `local-${Date.now()}`,
      content,
      createdAt: new Date().toISOString(),
      sender: { id: meId ?? '', name: '' },
      conversationId: id,
      type: 'text',
      replyTo,
      pendingLocal: true,
    };
    setMessages((prev) => [...prev, draft]);
    requestAnimationFrame(() => scrollToBottom(true));

    socket.emit('send_message', { conversationId: id, content, replyToId: replyTo?.id });
    setReplyTo(null);
    setText('');
    stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stopTyping` est stable (refs)
  }, [text, editing, messages, id, replyTo, meId, scrollToBottom]);


  const onType = (value: string) => {
    setText(value);
    const socket = connectSocket();
    if (!typingSentRef.current) {
      socket.emit('typing', { conversationId: id, typing: true });
      typingSentRef.current = true;
    }
    // Arrêt automatique après 3 s sans frappe, comme sur mobile.
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(stopTyping, 3000);
  };

  /**
   * Saut vers un message, y compris hors de la mémoire.
   *
   * ⚠️ Une cible ancienne n'est PAS dans le fil chargé : on recharge alors une fenêtre
   * centrée sur elle. On ne peut pas défiler vers un élément absent du DOM, et remonter page
   * par page serait interminable.
   */
  const jumpTo = useCallback(
    (messageId: string) => {
      /**
       * ⚠️ On vise la LIGNE, pas le message. Un album est plusieurs messages mais une seule
       * ligne, ancrée sur le premier du lot : chercher `msg-<id>` échouait donc en silence
       * pour le 2ᵉ ou 3ᵉ média d'un envoi groupé, et le saut ne faisait rien.
       */
      const centerOn = (list: Message[], smooth: boolean) => {
        const anchor = rowAnchorId(list, messageId);
        const el = anchor ? document.getElementById(`msg-${anchor}`) : null;
        if (!el) return null;
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
        return anchor;
      };

      /**
       * Le surlignage porte sur la LIGNE, donc sur son ancre — et n'est posé QU'UNE FOIS.
       *
       * ⚠️ Le calage re-vise à chaque image : y appeler `setHighlightId` déclencherait un
       * rendu par image pendant plus d'une seconde, et chaque appel armerait un minuteur de
       * plus. C'est le genre de gaspillage qui finit par provoquer le décalage qu'on essaie
       * justement de corriger.
       */
      const highlight = (anchor: string) => {
        setHighlightId(anchor);
        setTimeout(() => setHighlightId(null), 2000);
      };

      const scrollToIt = (list: Message[]) => {
        const anchor = centerOn(list, true);
        if (anchor) highlight(anchor);
        return !!anchor;
      };
      if (scrollToIt(messages)) return;

      void (async () => {
        try {
          const win = await fetchAround(id, messageId);
          setMessages(win.messages.slice().reverse());
          setHasOlder(win.hasOlder);
          // ⚠️ C'est CE drapeau qui rend le bas du fil de nouveau atteignable : sans lui, la
          // fenêtre centrée devenait un cul-de-sac.
          setHasNewer(win.hasNewer);
          /**
           * ⚠️ Posé À LA MAIN, sans attendre un événement de défilement : si la cible tombe
           * à la position déjà occupée, `scrollIntoView` ne déplace rien, aucun `scroll`
           * n'est émis, et l'état gardait sa valeur d'avant le saut — le bouton de retour au
           * présent ne s'affichait donc pas.
           */
          if (win.hasNewer) {
            setAtBottom(false);
            // ⚠️ Sinon l'observateur ramènerait au bas dès la première image chargée, en
            // annulant le saut qu'on vient de faire.
            stickRef.current = false;
          }
          /**
           * ⚠️ Ciblage RÉPÉTÉ, pas une seule tentative. Le DOM n'a pas encore rendu la
           * fenêtre à cet instant, et surtout les images n'ont pas leur hauteur : la
           * position calculée à la première image dérive dès qu'une image se charge. On
           * re-vise donc pendant une courte fenêtre, et on s'arrête dès que la hauteur
           * totale cesse de bouger.
           */
          const window_ = win.messages.slice().reverse();
          let highlighted = false;
          settle(() => {
            // ⚠️ Sans animation : une animation en cours serait interrompue par la suivante
            // à chaque image, et le fil n'atteindrait jamais sa cible.
            const anchor = centerOn(window_, false);
            if (anchor && !highlighted) {
              highlighted = true;
              highlight(anchor);
            }
          });
        } catch {
          // Message introuvable (supprimé, expiré) : on ne bouge pas.
        }
      })();
    },
    // `messages` sert au raccourci « déjà à l'écran » : sans lui, on relirait une liste
    // périmée et on irait rechercher au serveur une fenêtre déjà chargée.
    [id, messages, settle],
  );

  const react = useCallback(
    (m: Message, emoji: string) => {
      // Optimiste : la pastille doit apparaître sous le doigt. Le serveur rediffuse ensuite
      // l'état complet par `message_reaction`, qui fait foi.
      setMessages((prev) =>
        prev.map((x) => {
          if (x.id !== m.id) return x;
          const others = (x.reactions ?? []).filter((r) => r.userId !== meId);
          const mine = (x.reactions ?? []).find((r) => r.userId === meId);
          // Reposer le même emoji le retire — c'est le geste attendu.
          const next =
            mine?.emoji === emoji ? others : [...others, { userId: meId ?? '', emoji }];
          return { ...x, reactions: next };
        }),
      );
      void reactToMessage(id, m.id, emoji).catch(() => {});
    },
    [id, meId],
  );

  const actions: BubbleActions = useMemo(
    () => ({
      onReply: (m) =>
        setReplyTo({
          id: m.id,
          senderId: m.sender?.id ?? '',
          sender: m.sender ? { id: m.sender.id, name: m.sender.name } : null,
          type: m.type,
          content: m.content,
          mediaUrl: m.mediaUrl,
          mediaType: m.mediaType,
          fileName: m.fileName,
        }),
      onReact: react,
      onEdit: (m) => {
        setEditing({ id: m.id, original: text });
        setText(m.content ?? '');
      },
      onDelete: (m) => {
        // ⚠️ « Pour tout le monde » n'est proposé que si le serveur l'accepterait : sur ses
        // propres messages récents, ou en modération. Offrir un choix voué au refus est pire
        // que de ne pas l'offrir.
        const mine = m.sender?.id === meId;
        const recent = Date.now() - new Date(m.createdAt).getTime() < 2 * 24 * 3600 * 1000;
        const canAll = mine && recent;
        const scope: 'me' | 'all' =
          canAll && window.confirm(t('thread.delete_all'))
            ? 'all'
            : 'me';
        void deleteMessage(id, m.id, scope)
          .then(() => {
            setMessages((prev) =>
              scope === 'me'
                ? prev.filter((x) => x.id !== m.id)
                : prev.map((x) =>
                    x.id === m.id
                      ? { ...x, deletedAt: new Date().toISOString(), content: '', mediaUrl: null, reactions: [] }
                      : x,
                  ),
            );
          })
          .catch((e) => window.alert(e.message));
      },
      onPin: (m) => {
        const pinned = flags.pinned.includes(m.id);
        void pinMessage(id, m.id, pinned)
          .then(() => fetchFlags(id).then(setFlags))
          .catch(() => {});
      },
      onStar: (m) => {
        const starred = flags.starred.includes(m.id);
        void starMessage(id, m.id, starred)
          .then(() => fetchFlags(id).then(setFlags))
          .catch(() => {});
      },
      onForward: (m) => {
        // ⚠️ Un ALBUM est UNE bulle mais PLUSIEURS messages : ne transférer que celui sur
        // lequel on a cliqué n'enverrait qu'une image sur cinq.
        const group = m.batchId
          ? messages.filter((x) => x.batchId === m.batchId)
          : [m];
        setForwarding(group);
      },
      onJumpTo: jumpTo,
      onOpenMedia: setViewer,
    }),
    // ⚠️ `t` inclus : les libellés du menu doivent suivre un changement de langue.
    [react, jumpTo, id, flags, meId, text, messages, t],
  );

  /**
   * Transfert : on RÉÉMET les messages vers chaque conversation choisie.
   *
   * ⚠️ Le média est réutilisé par son URL S3, sans re-téléverser : le fichier est déjà en
   * ligne, en poster une copie multiplierait le stockage pour un contenu identique.
   * ⚠️ La CITATION n'est pas reprise — le message cité n'existe pas dans la conversation
   * d'arrivée, et l'y afficher exposerait un extrait d'une conversation dont le destinataire
   * n'est pas membre.
   */
  const forwardTo = useCallback(
    (msgs: Message[], conversationIds: string[]) => {
      const socket = connectSocket();
      // ⚠️ Ordre explicite : l'horodatage est posé par le SERVEUR à la réception, donc
      // émettre dans le désordre remettrait les messages dans le désordre chez l'autre.
      const ordered = [...msgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      for (const convId of conversationIds) {
        // ⚠️ Un batchId NEUF par transfert : réutiliser celui d'origine ferait cohabiter
        // deux albums de même identifiant, et le `#n` serait faux si l'on n'en transfère
        // qu'une partie.
        const withBatch = ordered.filter((m) => m.batchId);
        const fresh =
          withBatch.length > 1 ? `${meId}-${Date.now()}#${withBatch.length}` : undefined;

        for (const m of ordered) {
          socket.emit('send_message', {
            conversationId: convId,
            content: m.content ?? '',
            type: m.type === 'story_reply' ? 'text' : m.type,
            mediaUrl: m.mediaUrl ?? undefined,
            mediaType: m.mediaType ?? undefined,
            fileName: m.fileName ?? undefined,
            fileSize: m.fileSize ?? undefined,
            mimeType: m.mimeType ?? undefined,
            durationMs: m.durationMs ?? undefined,
            latitude: m.latitude ?? undefined,
            longitude: m.longitude ?? undefined,
            batchId: m.batchId ? fresh : undefined,
            forwarded: true,
          });
        }
      }
    },
    [meId],
  );

  /** Envoi de fichiers : téléversement S3 puis un message par pièce jointe. */
  const sendFiles = useCallback(
    (files: FileList) => {
      const list = Array.from(files).slice(0, 10);
      if (!list.length) return;
      setUploading(true);
      // ⚠️ Un `batchId` partagé regroupe les médias d'un même envoi en UNE bulle chez le
      // destinataire — le suffixe `#n` lui dit combien en attendre.
      const batchId = list.length > 1 ? `${meId}-${Date.now()}#${list.length}` : undefined;

      void (async () => {
        const socket = connectSocket();
        for (const file of list) {
          try {
            const url = await uploadFile(file);
            socket.emit('send_message', {
              conversationId: id,
              content: '',
              mediaUrl: url,
              mediaType: mediaKindOf(file.type),
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type,
              batchId,
            });
          } catch {
            window.alert(`Échec de l'envoi de ${file.name}`);
          }
        }
        setUploading(false);
      })();
    },
    [id, meId],
  );

  /**
   * Envoi d'un vocal enregistré.
   *
   * ⚠️ `durationMs` est transmis : c'est ce qui permet d'afficher la durée AVANT tout
   * chargement du fichier, côté web comme sur mobile.
   */
  const sendVoice = useCallback(
    (file: File, durationMs: number) => {
      setRecording(false);
      setUploading(true);
      void (async () => {
        try {
          const url = await uploadFile(file);
          connectSocket().emit('send_message', {
            conversationId: id,
            content: '',
            mediaUrl: url,
            mediaType: 'audio',
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            durationMs,
          });
        } catch (err) {
          // ⚠️ On remonte le message RÉEL : un `catch` muet ne dit pas si c'est la signature
          // (type refusé), le PUT vers S3, ou le socket qui a échoué.
          console.error('[vocal] envoi échoué', err);
          window.alert(
            `Échec de l'envoi du message vocal : ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        } finally {
          setUploading(false);
        }
      })();
    },
    [id],
  );

  /**
   * Bornes d'acheminement : le PLUS ANCIEN accusé parmi les autres membres.
   *
   * ⚠️ `null` dès qu'un seul membre n'a rien accusé — sans quoi un groupe passerait « lu »
   * au premier destinataire servi. Un message est reçu (ou lu) quand TOUS l'ont dépassé.
   */
  const bounds = useMemo(() => {
    const others = (meta?.members ?? []).filter((m) => m.userId !== meId);
    if (!others.length) return { delivered: null as string | null, read: null as string | null };
    const oldest = (key: 'delivered' | 'read') => {
      let min: string | null = null;
      for (const m of others) {
        const v = receipts[m.userId]?.[key];
        if (!v) return null;
        if (!min || v < min) min = v;
      }
      return min;
    };
    return { delivered: oldest('delivered'), read: oldest('read') };
  }, [meta, meId, receipts]);

  /** État d'un de MES messages : envoyé → remis → lu. */
  const statusAt = useCallback(
    (createdAt: string): 'sent' | 'delivered' | 'read' => {
      if (bounds.read && createdAt <= bounds.read) return 'read';
      if (bounds.delivered && createdAt <= bounds.delivered) return 'delivered';
      return 'sent';
    },
    [bounds],
  );

  /** Sous-titre : frappe > en ligne > vu le… — même priorité que le mobile. */
  const subtitle = peerTyping
    ? 'écrit…'
    : meta?.type === 'group'
      ? `${meta.members.length} membres`
      : presence.online
        ? 'en ligne'
        : presence.lastSeenAt
          ? `vu le ${new Date(presence.lastSeenAt).toLocaleDateString(undefined, {
              day: '2-digit',
              month: '2-digit',
            })} à ${new Date(presence.lastSeenAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '';

  /**
   * Groupe en « admins uniquement » et je n'ai pas les droits : fil en lecture seule.
   *
   * ⚠️ Modérateur INCLUS dans ceux qui peuvent écrire — c'est la règle du serveur
   * (`canManage`), et l'exclure ici bloquerait quelqu'un que le backend accepte.
   */
  const readOnly =
    meta?.type === 'group' &&
    meta.whoCanSend === 'admins' &&
    !canManageMembers(meta.myRole as Role | undefined);

  /**
   * Épinglés présents dans le fil, du plus récent au plus ancien.
   *
   * ⚠️ Construit depuis `flags.pinned` ET les messages chargés : un épinglé hors mémoire n'a
   * pas d'aperçu à montrer. Le saut, lui, sait aller le chercher (fenêtre centrée).
   */
  const pinnedRows = useMemo(
    () =>
      [...flags.pinned].sort((a, b) => {
        const ta = messages.find((m) => m.id === a)?.createdAt ?? '';
        const tb = messages.find((m) => m.id === b)?.createdAt ?? '';
        return tb.localeCompare(ta);
      }),
    [flags.pinned, messages],
  );

  // L'index doit rester dans les bornes : désépingler pendant qu'on cycle le ferait sortir.
  const safePinIndex = pinnedRows.length ? pinIndex % pinnedRows.length : 0;
  const pinnedPreview =
    messages.find((m) => m.id === pinnedRows[safePinIndex])?.content ?? t('details.attachment');

  const loadConvSettings = useCallback(() => {
    void fetchConversations()
      .then((list) => setConvSettings(list.find((c) => c.id === id) ?? null))
      .catch(() => {});
  }, [id]);

  // ⚠️ Chargé à l'OUVERTURE du panneau, pas à celle du fil : c'est une liste complète des
  // conversations, inutile de la demander tant que personne ne la regarde.
  useEffect(() => {
    if (detailsOpen) loadConvSettings();
  }, [detailsOpen, loadConvSettings]);

  const title =
    meta?.type === 'group'
      ? meta.name ?? ''
      : meta?.members.find((m) => m.userId !== meId)?.user.name ?? '';
  const photo =
    meta?.type === 'group'
      ? meta.photoUrl
      : meta?.members.find((m) => m.userId !== meId)?.user.photoUrl;

  return (
    // ⚠️ `flex-1` et non `h-dvh` : la hauteur et le fond viennent du layout. `min-w-0` est
    // indispensable dans un conteneur flex — sans lui, un message très long élargirait la
    // colonne au lieu de passer à la ligne, et pousserait la liste hors écran.
    <div className="flex min-w-0 flex-1">
    <section
      className={`flex min-w-0 flex-1 flex-col ${
        // ⚠️ Sur écran étroit, les trois colonnes ne tiennent pas : le panneau prend toute
        // la place et le fil se masque, plutôt que de les comprimer tous les deux.
        detailsOpen ? 'hidden md:flex' : 'flex'
      }`}
    >
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Retour à la liste : utile seulement sur écran étroit, où elle est masquée. */}
        <button
          onClick={() => router.push('/chat')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-zinc-800"
          aria-label={t('common.back')}
        >
          <IconBack size={20} />
        </button>
        {/* ⚠️ Zone cliquable large (avatar + nom), comme sur mobile : viser un petit bouton
            « infos » serait moins direct, et l'en-tête est le repère naturel. */}
        <button
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/60"
        >
        <Avatar name={title} photoUrl={photo} size={40} group={meta?.type === 'group'} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
          {subtitle && (
            <p
              className={`truncate text-xs ${
                peerTyping || presence.online ? 'text-[#1E40AF]' : 'text-slate-400'
              }`}
            >
              {subtitle}
            </p>
          )}
        </div>
        </button>

        {search ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={search.term}
              onChange={(e) => {
                const term = e.target.value;
                setSearch({ term, results: [], index: 0 });
                if (term.trim().length < 2) return;
                void searchInConversation(id, term.trim())
                  .then((res) =>
                    setSearch((prev) =>
                      // ⚠️ On ignore une réponse périmée : les requêtes ne reviennent pas
                      // forcément dans l'ordre, et une ancienne écraserait les résultats
                      // d'un terme que l'utilisateur a fini de corriger.
                      prev && prev.term === term
                        ? { ...prev, results: res.map((r) => r.id), index: 0 }
                        : prev,
                    ),
                  )
                  .catch(() => {});
              }}
              placeholder={t('thread.search_ph')}
              className="w-48 rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />
            {search.results.length > 0 && (
              <>
                <span className="text-xs text-slate-500">
                  {search.index + 1}/{search.results.length}
                </span>
                {/* La flèche HAUT va vers le plus ANCIEN : les résultats sont ordonnés du
                    plus récent au plus ancien, comme le fil. */}
                <button
                  onClick={() => {
                    const next = (search.index + 1) % search.results.length;
                    setSearch({ ...search, index: next });
                    jumpTo(search.results[next]);
                  }}
                  className="px-1 text-slate-500"
                  aria-label={t('thread.prev_result')}
                >
                  <IconUp size={16} />
                </button>
                <button
                  onClick={() => {
                    const next =
                      (search.index - 1 + search.results.length) % search.results.length;
                    setSearch({ ...search, index: next });
                    jumpTo(search.results[next]);
                  }}
                  className="px-1 text-slate-500"
                  aria-label={t('thread.next_result')}
                >
                  <IconDown size={16} />
                </button>
              </>
            )}
            <button
              onClick={() => setSearch(null)}
              className="px-1 text-slate-500"
              aria-label={t('thread.close_search')}
            >
              <IconClose size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearch({ term: '', results: [], index: 0 })}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            aria-label={t('search.placeholder')}
          >
            <IconSearch size={18} />
          </button>
        )}
      </header>

      {!pinBarHidden && pinnedRows.length > 0 && (
        <button
          onClick={() => {
            jumpTo(pinnedRows[safePinIndex]);
            // On avance APRÈS avoir sauté : le prochain clic mène au suivant.
            setPinIndex((i) => i + 1);
          }}
          className="flex w-full items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-left text-sm dark:border-zinc-800 dark:bg-zinc-800/60"
        >
          <IconPin size={16} className="shrink-0 text-[#1E40AF]" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-[#1E40AF]">
              {pinnedRows.length > 1
                ? t('thread.pinned_message_n', { index: safePinIndex + 1, total: pinnedRows.length })
                : t('thread.pinned_message')}
            </span>
            <span className="block truncate text-slate-600 dark:text-zinc-300">
              {pinnedPreview}
            </span>
          </span>
          {/* ⚠️ Ferme le bandeau, ne DÉSÉPINGLE pas : désépingler est partagé par tous les
              membres, masquer un bandeau ne regarde que soi. */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setPinBarHidden(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && setPinBarHidden(true)}
            className="px-2 text-slate-400"
            aria-label={t('thread.hide_banner')}
          >
            <IconClose size={16} />
          </span>
        </button>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
      {!atBottom && (
        // ⚠️ Positionné par rapport à CETTE zone (`relative` ci-dessus) et non à la fenêtre :
        // en absolu sans conteneur positionné, il se plaçait au-dessus de la liste.
        <button
          onClick={goToPresent}
          className="absolute bottom-4 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg dark:bg-zinc-800 dark:text-zinc-100"
          aria-label={t('thread.back_to_bottom')}
        >
          <IconDown size={20} />
        </button>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`h-10 animate-pulse rounded-2xl bg-slate-200 dark:bg-zinc-800 ${
                  i % 2 ? 'ml-auto w-1/3' : 'w-1/2'
                }`}
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">
            Dites bonjour à {title} !
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col">
            {!hasOlder && (
              <p className="pb-4 text-center text-xs text-slate-400">
                Début de la conversation
              </p>
            )}
            {rows.map((row, i) => {
              const first = row.messages[0];
              const prevRow = rows[i - 1];
              const prevMsg = prevRow?.messages[prevRow.messages.length - 1];
              const nextMsg = rows[i + 1]?.messages[0];
              const newDay =
                !prevMsg ||
                new Date(prevMsg.createdAt).toDateString() !==
                  new Date(first.createdAt).toDateString();
              /**
               * ⚠️ Le repère se pose sur la LIGNE qui contient le premier non lu, pas sur le
               * message : dans un album, seule la ligne existe dans le DOM — même règle que
               * le saut vers un message (`rowAnchorId`).
               */
              const showUnread =
                !!unreadMark && row.messages.some((m) => m.id === unreadMark.id);
              return (
                <div key={row.key}>
                  {showUnread && (
                    <div
                      id={`unread-${unreadMark!.id}`}
                      className="my-3 flex items-center gap-3 px-1"
                    >
                      <span className="h-px flex-1 bg-[#1E40AF]/40" />
                      <span className="rounded-full bg-[#1E40AF] px-3 py-1 text-xs font-semibold text-white">
                        {unreadMark!.count === 1
                          ? '1 nouveau message'
                          : `${unreadMark!.count} nouveaux messages`}
                      </span>
                      <span className="h-px flex-1 bg-[#1E40AF]/40" />
                    </div>
                  )}
                  {newDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-zinc-800/85 dark:text-zinc-300">
                        {dayLabel(first.createdAt)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    row={row}
                    meId={meId}
                    isGroup={meta?.type === 'group'}
                    firstOfGroup={!sameGroup(prevMsg, first)}
                    lastOfGroup={!sameGroup(row.messages[row.messages.length - 1], nextMsg)}
                    pinned={row.messages.some((m) => flags.pinned.includes(m.id))}
                    starred={row.messages.some((m) => flags.starred.includes(m.id))}
                    canModerate={meta?.myRole === 'admin' || meta?.myRole === 'moderator'}
                    highlighted={row.messages.some((m) => m.id === highlightId)}
                    // Uniquement sur MES messages : on n'accuse pas ceux des autres.
                    status={first.sender?.id === meId ? statusAt(first.createdAt) : undefined}
                    actions={actions}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>



      </div>

      {(replyTo || editing) && (
        <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/60">
          <div className="min-w-0 flex-1 border-l-[3px] border-[#1E40AF] pl-2">
            <p className="font-semibold text-[#1E40AF]">
              {editing ? t('thread.edit_banner') : replyTo?.sender?.name}
            </p>
            {replyTo && !editing && (
              <p className="truncate text-slate-500">
                {replyTo.content ?? t('details.attachment')}
              </p>
            )}
          </div>
          <button
            onClick={() => {
              // Annuler une modification restaure ce qu'on écrivait AVANT d'y entrer.
              if (editing) setText(editing.original);
              setEditing(null);
              setReplyTo(null);
            }}
            className="px-2 text-slate-400"
            aria-label={t('cancel')}
          >
            <IconClose size={16} />
          </button>
        </div>
      )}

      {/* ⚠️ Groupe réservé aux admins : le socket REFUSE déjà l'envoi côté serveur, la barre
          n'est donc pas une sécurité — elle évite d'écrire un message qui serait rejeté sans
          explication. Les modérateurs peuvent envoyer, comme sur mobile et comme le serveur
          l'autorise (`canManage`). */}
      {readOnly ? (
        <div className="border-t border-slate-200 bg-white px-4 py-4 text-center text-sm text-slate-400 dark:border-zinc-800 dark:bg-zinc-900">
          {t('details.read_only')}
        </div>
      ) : recording ? (
        <div className="flex items-center border-t border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} />
        </div>
      ) : (
      <form
        onSubmit={send}
        className="flex items-end gap-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) sendFiles(e.target.files);
            // ⚠️ Remis à zéro : sans cela, choisir DEUX FOIS le même fichier ne déclenche
            // pas `onChange`, la valeur de l'input n'ayant pas changé.
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !!editing}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          aria-label={t('thread.attach')}
        >
          {uploading ? <IconSpinner size={19} className="animate-spin" /> : <IconAttach size={19} />}
        </button>
        <textarea
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée passe à la ligne — convention des messageries web.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
          placeholder={t('chat.message_placeholder')}
          className="max-h-32 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-base outline-none dark:bg-zinc-800 dark:text-zinc-100"
        />
        {/* ⚠️ Micro quand le champ est vide, envoi sinon — et jamais de micro en mode
            édition : on modifie du texte, pas un vocal. */}
        {text.trim() || editing ? (
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1E40AF] text-white disabled:opacity-40"
            aria-label={t(editing ? 'thread.validate' : 'thread.send')}
          >
            {editing ? <IconCheck size={20} /> : <IconSend size={19} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRecording(true)}
            disabled={uploading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1E40AF] text-white disabled:opacity-40"
            aria-label={t('thread.record')}
          >
            <IconMic size={19} />
          </button>
        )}
      </form>
      )}
      <ForwardDialog
        open={!!forwarding}
        // Compte de BULLES : un album désigné une fois ne doit pas annoncer « 5 messages ».
        count={forwarding ? new Set(forwarding.map((m) => m.batchId ?? m.id)).size : 0}
        meId={meId}
        onClose={() => setForwarding(null)}
        onConfirm={(ids) => {
          if (forwarding) forwardTo(forwarding, ids);
          setForwarding(null);
        }}
      />

    </section>

    <DetailsPanel
      open={detailsOpen}
      meta={meta}
      conversation={convSettings}
      meId={meId}
      onClose={() => setDetailsOpen(false)}
      onOpenMedia={setViewer}
      onOpenProfile={setProfileUserId}
      onChanged={loadConvSettings}
      onMetaChanged={() => {
        void fetchConversationMeta(id).then(setMeta).catch(() => {});
      }}
      onJumpTo={(mid) => {
        jumpTo(mid);
        // Sur écran étroit le panneau couvre le fil : le refermer permet de VOIR le message
        // qu'on vient de rejoindre. Sur grand écran il pourrait rester, mais un
        // comportement unique se retient mieux qu'une règle qui dépend de la largeur.
        setDetailsOpen(false);
      }}
    />

    {/* ⚠️ Hors des colonnes : la visionneuse est plein écran et appartient à la PAGE.
        Laissée dans la section du fil, elle disparaissait avec elle quand le panneau de
        détails prend l'écran sur mobile — un média ouvert depuis le panneau ne s'affichait
        alors pas. */}
    {viewer && (
      <MediaViewer conversationId={id} initial={viewer} onClose={() => setViewer(null)} />
    )}

    {profileUserId && (
      <UserProfileDialog
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        onOpenConversation={(convId) => router.push(`/chat/${convId}`)}
      />
    )}
    </div>
  );
}
