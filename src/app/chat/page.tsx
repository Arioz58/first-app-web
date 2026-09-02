'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { setSessionExpiredHandler } from '@/lib/api';
import { hasSession, logout } from '@/lib/auth';
import {
  conversationName,
  conversationPhoto,
  fetchConversations,
  formatListDate,
  messagePreview,
  sortConversations,
  type Conversation,
  type LastMessage,
} from '@/lib/conversations';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { getUserId } from '@/lib/storage';

type Filter = 'all' | 'unread' | 'favorites' | 'groups';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'unread', label: 'Non lues' },
  { key: 'favorites', label: 'Favoris' },
  { key: 'groups', label: 'Groupes' },
];

export default function ChatPage() {
  const router = useRouter();
  /**
   * ⚠️ Initialiseur PARESSEUX (`useState(fn)`) plutôt qu'un `setState` dans un effet :
   * `getUserId` lit `localStorage`, absent côté serveur — la fonction n'est donc appelée
   * qu'au premier rendu client, et la valeur est disponible immédiatement.
   */
  const [meId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getUserId(),
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  /**
   * Chargement de la liste.
   *
   * ⚠️ `void (async () => …)()` plutôt qu'un `async` appelé directement depuis l'effet :
   * React 19 interdit un `setState` SYNCHRONE dans un effet (rendu en cascade avant le
   * commit), et une fonction `async` dont la première instruction échoue peut poser son
   * état de façon synchrone. Envelopper garantit que tout `setState` arrive après.
   */
  const load = useCallback(() => {
    void (async () => {
      try {
        setConversations(sortConversations(await fetchConversations()));
      } catch {
        // L'erreur d'authentification est traitée par `setSessionExpiredHandler`. Toute
        // autre panne laisse la liste telle quelle plutôt que de la vider sous les yeux.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => router.replace('/login'));
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    // ⚠️ Pas de `setState` SYNCHRONE dans l'effet (règle React 19, erreur de lint) : il
    // déclencherait un rendu en cascade avant même que le premier soit commité. L'identité
    // est lue au premier rendu par `useState(getUserId)` — voir sa déclaration.
    load();

    const socket = connectSocket();

    /**
     * ⚠️ `conversation_updated` (room `user:`) et NON `new_message` (room `conv:`) : seul le
     * premier arrive pour une conversation qu'on n'a pas ouverte. Écouter les deux
     * double-compterait les non-lus de la conversation affichée.
     */
    const onUpdate = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: LastMessage;
    }) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conversationId);
        // Conversation inconnue (créée à l'instant) : on recharge plutôt que d'inventer.
        if (idx === -1) {
          load();
          return prev;
        }
        const fromMe = message.senderId === getUserId();
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          messages: [message],
          lastMessageAt: message.createdAt,
          unreadCount: fromMe ? next[idx].unreadCount : next[idx].unreadCount + 1,
        };
        return sortConversations(next);
      });
    };

    socket.on('conversation_updated', onUpdate);
    socket.on('added_to_group', load);
    socket.on('removed_from_group', load);

    return () => {
      socket.off('conversation_updated', onUpdate);
      socket.off('added_to_group', load);
      socket.off('removed_from_group', load);
    };
  }, [router, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      // Les archivées ont leur propre écran, comme sur mobile.
      .filter((c) => !c.archivedAt)
      .filter((c) => {
        if (filter === 'unread') return c.unreadCount > 0 || c.manualUnread;
        if (filter === 'favorites') return !!c.favoritedAt;
        if (filter === 'groups') return c.type === 'group';
        return true;
      })
      .filter((c) => !q || conversationName(c, meId).toLowerCase().includes(q));
  }, [conversations, filter, query, meId]);

  const unreadTotal = conversations.reduce((n, c) => n + (c.unreadCount || 0), 0);

  return (
    <main className="flex h-dvh bg-slate-50 dark:bg-zinc-950">
      <aside className="flex w-full max-w-sm flex-col border-r border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-bold text-[#1E40AF] dark:text-blue-400">
            Discussions
            {unreadTotal > 0 && (
              <span className="ml-2 rounded-full bg-[#1E40AF] px-2 py-0.5 text-xs text-white align-middle">
                {unreadTotal}
              </span>
            )}
          </h1>
          <button
            onClick={() => {
              // ⚠️ Le socket porte le jeton dans son handshake : le fermer est indispensable,
              // sinon la connexion resterait ouverte au nom du compte qu'on vient de quitter.
              disconnectSocket();
              logout();
              router.replace('/login');
            }}
            className="text-sm text-slate-500 hover:underline dark:text-zinc-400"
          >
            Déconnexion
          </button>
        </header>

        <div className="px-4 pb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher"
            className="w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="flex gap-2 px-4 pb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f.key
                  ? 'bg-[#1E40AF] text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {f.label}
              {f.key === 'unread' && unreadTotal > 0 ? ` (${unreadTotal})` : ''}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            // Silhouettes plutôt qu'un écran vide : une liste vide annoncerait à tort qu'il
            // n'y a aucune conversation (même raison que le squelette du fil mobile).
            <ul className="space-y-1 px-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="flex animate-pulse items-center gap-3 rounded-xl p-3">
                  <div className="h-12 w-12 rounded-full bg-slate-200 dark:bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-zinc-800" />
                    <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-zinc-800/60" />
                  </div>
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">
              {query ? 'Aucun résultat.' : 'Aucune conversation.'}
            </p>
          ) : (
            <ul className="px-2 pb-4">
              {visible.map((c) => {
                const last = c.messages[0];
                const name = conversationName(c, meId);
                const unread = c.unreadCount > 0;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => router.push(`/chat/${c.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                    >
                      <Avatar
                        name={name}
                        photoUrl={conversationPhoto(c, meId)}
                        group={c.type === 'group'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-semibold text-slate-900 dark:text-zinc-100">
                            {name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {last ? formatListDate(last.createdAt) : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate text-sm ${
                              unread
                                ? 'font-medium text-slate-700 dark:text-zinc-200'
                                : 'text-slate-400'
                            }`}
                          >
                            {c.pinnedAt && '📌 '}
                            {messagePreview(last)}
                          </span>
                          {unread ? (
                            <span className="shrink-0 rounded-full bg-[#1E40AF] px-2 py-0.5 text-xs font-semibold text-white">
                              {c.unreadCount}
                            </span>
                          ) : c.manualUnread ? (
                            // Pastille SANS nombre : le « non lu » manuel ne compte pas de
                            // messages (même convention que le mobile).
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1E40AF]" />
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="hidden flex-1 items-center justify-center md:flex">
        <p className="text-slate-400">Sélectionnez une conversation.</p>
      </section>
    </main>
  );
}
