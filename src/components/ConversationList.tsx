'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { NewChatDialog } from '@/components/NewChatDialog';
import { setSessionExpiredHandler } from '@/lib/api';
import { hasSession, logout } from '@/lib/auth';
import {
  archiveConversation,
  conversationName,
  conversationPhoto,
  favoriteConversation,
  fetchConversations,
  formatListDate,
  isMuted,
  markUnread,
  messagePreview,
  muteConversation,
  MUTE_OPTIONS,
  pinConversation,
  sortConversations,
  type Conversation,
  type LastMessage,
} from '@/lib/conversations';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { getUserId } from '@/lib/storage';

type Filter = 'all' | 'unread' | 'favorites' | 'groups' | 'archived';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'unread', label: 'Non lues' },
  { key: 'favorites', label: 'Favoris' },
  { key: 'groups', label: 'Groupes' },
];

/**
 * Colonne de gauche, PERSISTANTE.
 *
 * ⚠️ Montée par `app/chat/layout.tsx` et non par une page : Next.js conserve les layouts
 * entre les navigations, donc changer de conversation ne la démonte pas. Elle garde ainsi
 * son défilement, ses filtres, sa recherche — et surtout son écouteur socket, qui serait
 * sinon détaché et rattaché à chaque clic.
 */
export function ConversationList() {
  const router = useRouter();
  // Conversation ouverte, pour la marquer comme active. `useParams` est vide sur /chat.
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;

  const [meId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getUserId(),
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newChatOpen, setNewChatOpen] = useState(false);
  /** Conversation dont le menu d'actions est ouvert. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Conversation pour laquelle on choisit une durée de sourdine. */
  const [muteFor, setMuteFor] = useState<string | null>(null);

  const load = useCallback(() => {
    void (async () => {
      try {
        setConversations(sortConversations(await fetchConversations()));
      } catch {
        // Panne réseau : on laisse la liste telle quelle plutôt que de la vider.
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
    load();

    const socket = connectSocket();

    const onUpdate = ({
      conversationId,
      message,
    }: {
      conversationId: string;
      message: LastMessage;
    }) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === conversationId);
        if (idx === -1) {
          load();
          return prev;
        }
        const fromMe = message.senderId === getUserId();
        // ⚠️ La conversation OUVERTE ne compte pas de non-lus : elle est sous les yeux, et
        // le fil la marque lue à chaque message reçu. Sans cette garde, la pastille
        // clignoterait pendant qu'on lit.
        const isOpen = conversationId === activeId;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          messages: [message],
          lastMessageAt: message.createdAt,
          unreadCount: fromMe || isOpen ? next[idx].unreadCount : next[idx].unreadCount + 1,
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
  }, [router, load, activeId]);

  // Même règle que le rendu : la conversation ouverte ne compte pas, sinon l'en-tête
  // annoncerait des non-lus que la liste affiche à zéro.
  /**
   * ⚠️ Les ARCHIVÉES sont exclues du total, comme sur mobile (décision du 5 août) : sans
   * cela le titre d'onglet et la pastille annonceraient un nombre que rien ne fait
   * redescendre dans la liste visible. Leur compte reste visible sur l'entrée « Archivées ».
   *
   * La conversation ouverte l'est aussi : elle est sous les yeux et le fil la marque lue.
   */
  const unreadTotal = conversations.reduce(
    (n, c) => n + (c.id === activeId || c.archivedAt ? 0 : c.unreadCount || 0),
    0,
  );

  /**
   * Titre de l'onglet : « (3) Nexa » quand des messages attendent.
   *
   * ⚠️ Posé ici et non dans le fil : cette liste est montée en permanence (elle vit dans le
   * layout), donc le compte reste juste quel que soit l'écran ouvert. Dans une page, il
   * disparaîtrait à chaque navigation.
   */
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Nexa` : 'Nexa';
  }, [unreadTotal]);

  /**
   * Applique un changement localement puis appelle le serveur.
   *
   * ⚠️ Optimiste : la liste doit réagir au clic, pas après un aller-retour. En cas d'échec on
   * RECHARGE plutôt que d'annuler à la main — le serveur fait foi, et deviner l'état
   * antérieur d'un tri qui a peut-être bougé serait fragile.
   */
  const apply = useCallback(
    (convId: string, patch: Partial<Conversation>, call: () => Promise<unknown>) => {
      setMenuFor(null);
      setConversations((prev) =>
        sortConversations(prev.map((c) => (c.id === convId ? { ...c, ...patch } : c))),
      );
      void call().catch(() => load());
    },
    [load],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      // ⚠️ Les archivées sont EXCLUES des autres vues et n'apparaissent que dans la leur :
      // c'est tout l'objet de l'archivage.
      .filter((c) => (filter === 'archived' ? !!c.archivedAt : !c.archivedAt))
      /**
       * ⚠️ La conversation OUVERTE n'affiche jamais de non-lus : elle est sous les yeux et
       * le fil la marque lue à chaque message.
       *
       * Dérivé au RENDU plutôt que corrigé par un effet : React 19 interdit un `setState`
       * synchrone dans un effet (rendu en cascade), et surtout une valeur qu'on peut
       * calculer ne devrait pas être un état à entretenir.
       */
      .map((c) =>
        c.id === activeId && (c.unreadCount > 0 || c.manualUnread)
          ? { ...c, unreadCount: 0, manualUnread: false }
          : c,
      )
      .filter((c) => {
        if (filter === 'archived') return true;
        if (filter === 'unread') return c.unreadCount > 0 || c.manualUnread;
        if (filter === 'favorites') return !!c.favoritedAt;
        if (filter === 'groups') return c.type === 'group';
        return true;
      })
      .filter((c) => !q || conversationName(c, meId).toLowerCase().includes(q));
  }, [conversations, filter, query, meId, activeId]);



  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-[380px] dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-4 py-4">
        <h1 className="text-2xl font-bold text-[#1E40AF] dark:text-blue-400">
          Discussions
          {unreadTotal > 0 && (
            <span className="ml-2 align-middle rounded-full bg-[#1E40AF] px-2 py-0.5 text-xs text-white">
              {unreadTotal}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setNewChatOpen(true)}
            title="Nouvelle conversation"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#1E40AF] hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            ✚
          </button>
          <button
            onClick={() => {
              // Le socket porte le jeton dans son handshake : le laisser ouvert maintiendrait
              // la connexion au nom du compte qu'on vient de quitter.
              disconnectSocket();
              logout();
              router.replace('/login');
            }}
            className="text-sm text-slate-500 hover:underline dark:text-zinc-400"
          >
            Déconnexion
          </button>
        </div>
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

      {/* ⚠️ Visible uniquement sur « Toutes », comme sur mobile : sur un filtre, elle
          prêterait à confusion avec le résultat filtré. Le compte annonce les non-lus
          rangés, que rien ne fait redescendre dans la liste visible. */}
      {filter === 'all' && conversations.some((c) => c.archivedAt) && (
        <button
          onClick={() => setFilter('archived')}
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          🗄️ Archivées
          <span className="ml-auto text-xs text-slate-400">
            {conversations.filter((c) => c.archivedAt).length}
          </span>
        </button>
      )}
      {filter === 'archived' && (
        <button
          onClick={() => setFilter('all')}
          className="mx-4 mb-2 rounded-xl bg-slate-100 px-3 py-2 text-left text-sm text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          ← Retour aux discussions
        </button>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
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
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-400">
              {query ? 'Aucun résultat.' : 'Aucune conversation.'}
            </p>
            {/* ⚠️ Sans ce bouton, une liste vide est un CUL-DE-SAC : un nouvel utilisateur
                n'avait aucun moyen de démarrer une conversation depuis le web. */}
            {!query && (
              <button
                onClick={() => setNewChatOpen(true)}
                className="mt-4 rounded-xl bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white"
              >
                Démarrer une conversation
              </button>
            )}
          </div>
        ) : (
          <ul className="px-2 pb-4">
            {visible.map((c) => {
              const last = c.messages[0];
              const name = conversationName(c, meId);
              const unread = c.unreadCount > 0;
              const active = c.id === activeId;
              return (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => router.push(`/chat/${c.id}`)}
                    className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${
                      active
                        ? 'bg-[#1E40AF]/10 dark:bg-[#1E40AF]/25'
                        : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'
                    }`}
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
                        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
                          {isMuted(c) && <span title="En sourdine">🔕</span>}
                          {c.favoritedAt && <span title="Favori">⭐</span>}
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
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1E40AF]" />
                        ) : null}
                      </div>
                    </div>
                  </button>

                  {/* Actions au survol — la ligne entière reste cliquable pour ouvrir. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === c.id ? null : c.id);
                    }}
                    className="absolute right-2 top-3 rounded-full px-2 py-0.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-zinc-700"
                    aria-label="Actions"
                  >
                    ⋯
                  </button>

                  {menuFor === c.id && (
                    <>
                      {/* Fond transparent : un clic n'importe où referme le menu. */}
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-2 top-9 z-20 w-56 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-zinc-800 dark:ring-zinc-700">
                        {muteFor === c.id ? (
                          MUTE_OPTIONS.map((o) => (
                            <button
                              key={o.label}
                              onClick={() => {
                                setMuteFor(null);
                                apply(c.id, { mutedUntil: o.value }, () =>
                                  muteConversation(c.id, o.value),
                                );
                              }}
                              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              {o.label}
                            </button>
                          ))
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                apply(
                                  c.id,
                                  {
                                    pinnedAt: c.pinnedAt ? null : new Date().toISOString(),
                                  },
                                  () => pinConversation(c.id, !!c.pinnedAt),
                                )
                              }
                              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              {c.pinnedAt ? 'Désépingler' : 'Épingler'}
                            </button>
                            <button
                              onClick={() =>
                                apply(
                                  c.id,
                                  {
                                    favoritedAt: c.favoritedAt ? null : new Date().toISOString(),
                                  },
                                  () => favoriteConversation(c.id, !c.favoritedAt),
                                )
                              }
                              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              {c.favoritedAt ? 'Retirer des favoris' : 'Mettre en favori'}
                            </button>
                            {isMuted(c) ? (
                              <button
                                onClick={() =>
                                  apply(c.id, { mutedUntil: null }, () =>
                                    muteConversation(c.id, null),
                                  )
                                }
                                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              >
                                Réactiver les notifications
                              </button>
                            ) : (
                              <button
                                onClick={() => setMuteFor(c.id)}
                                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              >
                                Mettre en sourdine…
                              </button>
                            )}
                            {!c.archivedAt && !unread && (
                              <button
                                onClick={() =>
                                  apply(c.id, { manualUnread: true }, () => markUnread(c.id))
                                }
                                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              >
                                Marquer comme non lu
                              </button>
                            )}
                            <button
                              onClick={() =>
                                apply(
                                  c.id,
                                  {
                                    archivedAt: c.archivedAt ? null : new Date().toISOString(),
                                    // ⚠️ Archiver retire l'épinglage, comme le serveur le
                                    // fait : sans ça la liste et la base divergeraient
                                    // jusqu'au prochain rechargement.
                                    ...(c.archivedAt ? {} : { pinnedAt: null }),
                                  },
                                  () => archiveConversation(c.id, !c.archivedAt),
                                )
                              }
                              className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              {c.archivedAt ? 'Désarchiver' : 'Archiver'}
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onOpened={(convId) => {
          // La conversation peut être neuve : on recharge la liste pour qu'elle y figure.
          load();
          router.push(`/chat/${convId}`);
        }}
      />
    </aside>
  );
}
