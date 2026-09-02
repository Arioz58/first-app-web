'use client';

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
  const [viewer, setViewer] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);
  const [search, setSearch] = useState<{ term: string; results: string[]; index: number } | null>(
    null,
  );
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
      setMessages((prev) => mergeMessages(prev, [msg], 'end'));
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

    socket.on('new_message', onNew);
    socket.on('peer_typing', onTyping);
    socket.on('message_deleted', onDeleted);
    socket.on('message_reaction', onReaction);

    return () => {
      socket.emit('leave_conversation', id);
      socket.off('new_message', onNew);
      socket.off('peer_typing', onTyping);
      socket.off('message_deleted', onDeleted);
      socket.off('message_reaction', onReaction);
    };
  }, [id, meId, scrollToBottom]);

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
  const send = (e: React.FormEvent) => {
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
    // La citation est consommée par CET envoi : on la vide tout de suite, sinon un second
    // message partirait en citant encore le même.
    socket.emit('send_message', { conversationId: id, content, replyToId: replyTo?.id });
    setReplyTo(null);
    setText('');
    stopTyping();
  };

  const stopTyping = () => {
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    if (typingSentRef.current) {
      connectSocket().emit('typing', { conversationId: id, typing: false });
      typingSentRef.current = false;
    }
  };

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
      onForward: () => window.alert('Transfert : à venir sur le web.'),
      onJumpTo: jumpTo,
      onOpenMedia: (url, kind) => setViewer({ url, kind }),
    }),
    [react, jumpTo, id, flags, meId, text],
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

  const title =
    meta?.type === 'group'
      ? meta.name ?? ''
      : meta?.members.find((m) => m.userId !== meId)?.user.name ?? '';
  const photo =
    meta?.type === 'group'
      ? meta.photoUrl
      : meta?.members.find((m) => m.userId !== meId)?.user.photoUrl;

  return (
    // ⚠️ `flex-1` et non `h-dvh` : la hauteur et le fond viennent du layout à deux colonnes.
    // `min-w-0` est indispensable dans un conteneur flex — sans lui, un message très long
    // élargirait la colonne au lieu de passer à la ligne, et pousserait la liste hors écran.
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        {/* Retour à la liste : utile seulement sur écran étroit, où elle est masquée. */}
        <button
          onClick={() => router.push('/chat')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-zinc-800"
          aria-label="Retour"
        >
          ←
        </button>
        <Avatar name={title} photoUrl={photo} size={40} group={meta?.type === 'group'} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
          {peerTyping && <p className="text-xs text-[#1E40AF]">écrit…</p>}
        </div>

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
                >
                  ↑
                </button>
                <button
                  onClick={() => {
                    const next =
                      (search.index - 1 + search.results.length) % search.results.length;
                    setSearch({ ...search, index: next });
                    jumpTo(search.results[next]);
                  }}
                  className="px-1 text-slate-500"
                >
                  ↓
                </button>
              </>
            )}
            <button onClick={() => setSearch(null)} className="px-1 text-slate-500">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearch({ term: '', results: [], index: 0 })}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            aria-label="Rechercher"
          >
            🔍
          </button>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
      {!atBottom && (
        // ⚠️ Positionné par rapport à CETTE zone (`relative` ci-dessus) et non à la fenêtre :
        // en absolu sans conteneur positionné, il se plaçait au-dessus de la liste.
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-4 right-6 z-10 h-11 w-11 rounded-full bg-white text-lg shadow-lg dark:bg-zinc-800 dark:text-zinc-100"
          aria-label="Revenir en bas"
        >
          ↓
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
          >
            ✕
          </button>
        </div>
      )}

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
          className="h-11 w-11 shrink-0 rounded-full text-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          aria-label="Joindre un fichier"
        >
          {uploading ? '…' : '＋'}
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
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-11 w-11 shrink-0 rounded-full bg-[#1E40AF] text-white disabled:opacity-40"
          aria-label="Envoyer"
        >
          ➤
        </button>
      </form>
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
    </section>
  );
}
