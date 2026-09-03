'use client';

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
const AT_BOTTOM_PX = 120;
/** Déclenchement du chargement d'historique, en pixels depuis le haut. */
const LOAD_OLDER_PX = 300;

export default function ThreadPage() {
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
  const [viewer, setViewer] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [search, setSearch] = useState<{ term: string; results: string[]; index: number } | null>(
    null,
  );
  /** Messages à transférer — un album en compte plusieurs pour une seule bulle. */
  const [forwarding, setForwarding] = useState<Message[] | null>(null);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
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
        setMessages(page.slice().reverse());
        setHasOlder(page.length >= 30);
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

  // Calage en bas à l'ouverture, une fois les messages rendus.
  useEffect(() => {
    if (loading || !openingRef.current || !messages.length) return;
    openingRef.current = false;
    scrollToBottom(false);
  }, [loading, messages.length, scrollToBottom]);

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
        const page = await fetchMessages(id, messages[0].id);
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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX);
    if (el.scrollTop < LOAD_OLDER_PX) loadOlder();
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
      const scrollToIt = () => {
        const el = document.getElementById(`msg-${messageId}`);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 2000);
        return true;
      };
      if (scrollToIt()) return;

      void (async () => {
        try {
          const win = await fetchAround(id, messageId);
          setMessages(win.messages.slice().reverse());
          setHasOlder(win.hasOlder);
          // Le DOM n'a pas encore rendu la fenêtre : on vise à l'image suivante.
          requestAnimationFrame(() => requestAnimationFrame(scrollToIt));
        } catch {
          // Message introuvable (supprimé, expiré) : on ne bouge pas.
        }
      })();
    },
    [id],
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
          canAll && window.confirm('Supprimer pour tout le monde ?\n\nAnnuler = supprimer pour moi seulement.')
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
      onOpenMedia: (url, kind) => setViewer({ url, kind }),
    }),
    [react, jumpTo, id, flags, meId, text, messages],
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
    messages.find((m) => m.id === pinnedRows[safePinIndex])?.content ?? 'Pièce jointe';

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
          aria-label="Retour"
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
              placeholder="Rechercher…"
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
                  aria-label="Résultat précédent"
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
                  aria-label="Résultat suivant"
                >
                  <IconDown size={16} />
                </button>
              </>
            )}
            <button
              onClick={() => setSearch(null)}
              className="px-1 text-slate-500"
              aria-label="Fermer la recherche"
            >
              <IconClose size={16} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearch({ term: '', results: [], index: 0 })}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            aria-label="Rechercher"
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
                ? `Message épinglé ${safePinIndex + 1}/${pinnedRows.length}`
                : 'Message épinglé'}
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
            aria-label="Masquer le bandeau"
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
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg dark:bg-zinc-800 dark:text-zinc-100"
          aria-label="Revenir en bas"
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
              return (
                <div key={row.key}>
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
              {editing ? 'Modification du message' : replyTo?.sender?.name}
            </p>
            {replyTo && !editing && (
              <p className="truncate text-slate-500">
                {replyTo.content ?? 'Pièce jointe'}
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
            aria-label="Annuler"
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
          Seuls les admins peuvent envoyer des messages dans ce groupe.
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
          aria-label="Joindre un fichier"
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
          placeholder="Écrire un message"
          className="max-h-32 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-base outline-none dark:bg-zinc-800 dark:text-zinc-100"
        />
        {/* ⚠️ Micro quand le champ est vide, envoi sinon — et jamais de micro en mode
            édition : on modifie du texte, pas un vocal. */}
        {text.trim() || editing ? (
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1E40AF] text-white disabled:opacity-40"
            aria-label={editing ? 'Valider' : 'Envoyer'}
          >
            {editing ? <IconCheck size={20} /> : <IconSend size={19} />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRecording(true)}
            disabled={uploading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1E40AF] text-white disabled:opacity-40"
            aria-label="Enregistrer un message vocal"
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
      onOpenMedia={(url, kind) => setViewer({ url, kind })}
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
      <div
        onClick={() => setViewer(null)}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8"
      >
        {viewer.kind === 'video' ? (
          <video src={viewer.url} controls autoPlay className="max-h-full max-w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={viewer.url} alt="" className="max-h-full max-w-full object-contain" />
        )}
      </div>
    )}
    </div>
  );
}
