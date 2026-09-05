'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
  anchorFromEvent,
  FloatingMenu,
  MenuItem,
  openOnRightClick,
  type MenuAnchor,
} from '@/components/FloatingMenu';
import {
  IconArchive,
  IconBack,
  IconChat,
  IconBell,
  IconBellOff,
  IconDocument,
  IconLocation,
  IconMic,
  IconMore,
  IconPhoto,
  IconPin,
  IconPlus,
  IconStar,
  IconUsers,
  IconVideo,
} from '@/components/icons';
import { NewChatDialog } from '@/components/NewChatDialog';
import { FriendsPanel } from '@/components/FriendsPanel';
import { MessageRequestsPanel } from '@/components/MessageRequestsPanel';
import { fetchFriendRequests } from '@/lib/friends';
import { ProfilePanel } from '@/components/ProfilePanel';
import { UserProfileDialog } from '@/components/UserProfileDialog';
import { setSessionExpiredHandler } from '@/lib/api';
import { hasSession } from '@/lib/auth';
import {
  archiveConversation,
  conversationName,
  conversationPhoto,
  favoriteConversation,
  fetchConversations,
  fetchMessageRequests,
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
  type PreviewKind,
} from '@/lib/conversations';
import { fetchMe, type Me } from '@/lib/messages';
import { connectSocket } from '@/lib/socket';
import { getUserId } from '@/lib/storage';

type Filter = 'all' | 'unread' | 'favorites' | 'groups' | 'archived';

/**
 * Icône d'aperçu selon le type de pièce jointe.
 *
 * ⚠️ Un GIF prend l'icône « photo » : lucide n'a pas de dessin dédié, et le mot « GIF »
 * accolé suffit à lever l'ambiguïté. Mieux vaut ça qu'une icône approchante qui dirait faux.
 */
const PREVIEW_ICON: Record<Exclude<PreviewKind, null>, typeof IconPhoto> = {
  photo: IconPhoto,
  gif: IconPhoto,
  video: IconVideo,
  audio: IconMic,
  document: IconDocument,
  location: IconLocation,
};



/** ⚠️ Clés i18n et non libellés : traduits à l'affichage. */
const FILTERS: { key: Filter; labelKey: string }[] = [
  { key: 'all', labelKey: 'filters.all' },
  { key: 'unread', labelKey: 'filters.unread' },
  { key: 'favorites', labelKey: 'filters.favorites' },
  { key: 'groups', labelKey: 'filters.groups' },
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
  const { t } = useTranslation();
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  /** Onglet sur lequel ouvrir le dialogue « + » — « Par numéro » quand on vient des Amis. */
  const [newChatMode, setNewChatMode] = useState<'direct' | 'phone'>('direct');
  /**
   * Demandes d'ami reçues, pour la pastille de l'en-tête.
   *
   * ⚠️ Alimentée par le panneau lui-même quand il charge : sans compteur visible, une demande
   * reçue n'aurait aucune chance d'être remarquée — c'était tout le problème que ce panneau
   * vient résoudre.
   */
  const [friendRequests, setFriendRequests] = useState(0);
  const [requestsOpen, setRequestsOpen] = useState(false);
  /**
   * Demandes de messages en attente.
   *
   * ⚠️ Chargées par la LISTE : ces conversations ne déclenchent aucune notification push
   * (choix serveur), la bannière est donc le seul signal qu'un inconnu a écrit.
   */
  const [messageRequests, setMessageRequests] = useState(0);
  /**
   * Profil ouvert en fenêtre.
   *
   * ⚠️ Porté par la LISTE et non par chaque appelant : elle est le seul parent commun à la
   * recherche par numéro, au panneau Amis et au panneau de détails. Le dupliquer ferait
   * cohabiter plusieurs fenêtres, dont une seule serait au premier plan.
   */
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  /**
   * Mon profil, chargé ICI et passé au panneau.
   *
   * ⚠️ Une seule requête pour les deux : la vignette du pied de colonne et l'écran « Vous »
   * montrent la même chose. Laisser chacun la faire en produirait deux, dont une à chaque
   * ouverture du panneau.
   */
  const [me, setMe] = useState<Me | null>(null);
  /** Conversation dont le menu d'actions est ouvert. */
  /** Conversation dont le menu est ouvert, et où le poser (voir `FloatingMenu`). */
  const [menuFor, setMenuFor] = useState<{ id: string; at: MenuAnchor } | null>(null);
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
    // Profil affiché en pied de colonne. Un échec n'empêche rien : la vignette reste en
    // squelette et la messagerie fonctionne.
    void fetchMe().then(setMe).catch(() => {});
    /**
     * Pastille des demandes d'ami, chargée ICI et non par le panneau.
     *
     * ⚠️ Sinon elle n'apparaîtrait qu'APRÈS avoir ouvert le panneau — or c'est elle qui doit
     * donner envie de l'ouvrir. Le panneau la met ensuite à jour après chaque accept/refus.
     */
    void fetchFriendRequests()
      .then(([received]) => setFriendRequests(received.length))
      .catch(() => {});
    void fetchMessageRequests()
      .then((list) => setMessageRequests(list.length))
      .catch(() => {});

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

    /**
     * ⚠️ La pastille doit bouger EN DIRECT. Sans cet écouteur, une demande reçue pendant que
     * l'onglet est ouvert n'apparaissait qu'au rechargement — et personne ne recharge une
     * messagerie. Le mobile écoute déjà cet événement dans `app/_layout.tsx`.
     *
     * ⚠️ Incrémenté sans aller-retour, comme sur mobile : l'événement dit qu'une demande
     * vient d'arriver, la recompter au serveur n'apprendrait rien de plus.
     */
    const onFriendRequest = () => setFriendRequests((n) => n + 1);

    socket.on('friend_request_received', onFriendRequest);
    socket.on('conversation_updated', onUpdate);
    socket.on('added_to_group', load);
    socket.on('removed_from_group', load);

    return () => {
      socket.off('friend_request_received', onFriendRequest);
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

  /**
   * Le compte n'a-t-il vraiment AUCUNE conversation ?
   *
   * ⚠️ À ne pas confondre avec « la liste affichée est vide » : un filtre sans résultat, une
   * recherche infructueuse ou des archives vides laissent une liste vide sur un compte bien
   * fourni.
   */
  const hasNoConversations = conversations.length === 0;

  /**
   * Pourquoi la liste est vide.
   *
   * ⚠️ « Aucune conversation » sur un filtre sans resultat est faux et inquietant : la
   * personne en a, elles sont juste ailleurs. Le message doit nommer la cause pour que le
   * reflexe soit de changer de filtre, pas de croire a une perte de donnees.
   */
  const emptyMessage = query
    ? t('common.no_results')
    : hasNoConversations
      ? t('chat.no_conversations')
      : filter === 'archived'
        ? t('list.empty_archived')
        : filter === 'unread'
          ? t('list.empty_unread')
          : filter === 'favorites'
            ? t('list.empty_favorites')
            : filter === 'groups'
              ? t('list.empty_groups')
              : t('chat.no_conversations');

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
    <aside className="relative flex w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-[380px] dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between px-4 py-4">
        <h1 className="text-2xl font-bold text-[#1E40AF] dark:text-blue-400">
          {t('list.title')}
          {unreadTotal > 0 && (
            <span className="ml-2 align-middle rounded-full bg-[#1E40AF] px-2 py-0.5 text-xs text-white">
              {unreadTotal}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFriendsOpen(true)}
            title="Amis"
            aria-label="Amis"
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <IconUsers size={19} />
            {friendRequests > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {friendRequests > 9 ? '9+' : friendRequests}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setNewChatMode('direct');
              setNewChatOpen(true);
            }}
            title={t('fab.new_chat')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#1E40AF] hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <IconPlus size={20} />
          </button>

        </div>
      </header>

      <div className="px-4 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
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
            {t(f.labelKey)}
            {f.key === 'unread' && unreadTotal > 0 ? ` (${unreadTotal})` : ''}
          </button>
        ))}
      </div>

      {/* ⚠️ Visible uniquement sur « Toutes », comme sur mobile : sur un filtre, elle
          prêterait à confusion avec le résultat filtré. Le compte annonce les non-lus
          rangés, que rien ne fait redescendre dans la liste visible. */}
      {/* ⚠️ Visible seulement sur « Toutes », comme l'entrée Archivées et comme sur mobile :
          sur un filtre, elle prêterait à confusion avec le résultat filtré. */}
      {filter === 'all' && messageRequests > 0 && (
        <button
          onClick={() => setRequestsOpen(true)}
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-medium text-[#1E40AF] dark:bg-blue-950/60 dark:text-blue-300"
        >
          <IconChat size={16} />
          {t(messageRequests === 1 ? 'requests.banner_one' : 'requests.banner_other')}
          <span className="ml-auto rounded-full bg-[#1E40AF] px-2 py-0.5 text-xs font-bold text-white">
            {messageRequests}
          </span>
        </button>
      )}

      {filter === 'all' && conversations.some((c) => c.archivedAt) && (
        <button
          onClick={() => setFilter('archived')}
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <IconArchive size={16} />
          {t('list.archived')}
          <span className="ml-auto text-xs text-slate-400">
            {conversations.filter((c) => c.archivedAt).length}
          </span>
        </button>
      )}
      {filter === 'archived' && (
        <button
          onClick={() => setFilter('all')}
          className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-left text-sm text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <IconBack size={16} />
          {t('list.back_to_chats')}
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
            <p className="text-sm text-slate-400">{emptyMessage}</p>
            {/*
              ⚠️ Le bouton n'apparaît QUE si le compte n'a aucune conversation.
              Une liste vide parce qu'un FILTRE ne renvoie rien n'est pas un compte vide :
              proposer « Démarrer une conversation » à quelqu'un qui en a dix, simplement
              parce qu'aucune n'est non lue, laisse croire qu'il les a perdues — et le bouton
              est à portée de doigt là où il n'a rien à faire.
              ⚠️ Il reste indispensable dans le cas vrai : sans lui, un nouvel utilisateur
              n'a aucun moyen de démarrer une conversation depuis le web.
            */}
            {hasNoConversations && !query && (
              <button
                onClick={() => setNewChatOpen(true)}
                className="mt-4 rounded-xl bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white"
              >
                {t('list.start_chat')}
              </button>
            )}
          </div>
        ) : (
          <ul className="px-2 pb-4">
            {visible.map((c) => {
              const last = c.messages[0];
              const preview = messagePreview(last);
              const name = conversationName(c, meId);
              const unread = c.unreadCount > 0;
              const active = c.id === activeId;
              return (
                <li
                  key={c.id}
                  onContextMenu={openOnRightClick((at) => setMenuFor({ id: c.id, at }))}
                  className="group relative"
                >
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
                          {isMuted(c) && <IconBellOff size={13} aria-label={t('details.muted')} />}
                          {c.favoritedAt && (
                            <IconStar size={13} className="fill-current" aria-label={t('details.favorite')} />
                          )}
                          {/* ⚠️ La date s'efface au survol : le bouton « … » est posé en
                              ABSOLU juste au-dessus d'elle, et les deux se superposaient.
                              On joue sur l'opacité et non sur l'affichage — retirer
                              l'élément décalerait les icônes de sourdine et de favori au
                              moment précis où l'on passe la souris. */}
                          {last && (
                            <span className="transition-opacity group-hover:opacity-0">
                              {formatListDate(last.createdAt)}
                            </span>
                          )}
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
                          {c.pinnedAt && (
                            <IconPin size={12} className="mr-1 inline shrink-0 align-[-1px]" />
                          )}
                          {preview.kind &&
                            /* L'icône est `inline` pour rester sur la ligne du texte tronqué. */
                            (() => {
                              const Icon = PREVIEW_ICON[preview.kind];
                              return <Icon size={13} className="mr-1 inline shrink-0 align-[-2px]" />;
                            })()}
                          {preview.text}
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
                      setMenuFor({ id: c.id, at: anchorFromEvent(e) });
                    }}
                    className="absolute right-2 top-2.5 rounded-full p-1 text-slate-500 opacity-0 transition-opacity hover:bg-slate-200 group-hover:opacity-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    aria-label={t('list.actions')}
                  >
                    <IconMore size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* ⚠️ UN SEUL menu, monté hors de la liste qui défile — voir `FloatingMenu`.
          La conversation est retrouvée par son identifiant : après une mise à jour
          optimiste, lire l'objet capturé dans la boucle afficherait l'ancien état
          (« Épingler » sur une conversation qu'on vient d'épingler). */}
      {(() => {
        const c = conversations.find((x) => x.id === menuFor?.id);
        if (!c || !menuFor) return null;
        const close = () => {
          setMenuFor(null);
          setMuteFor(null);
        };
        const act = (patch: Partial<Conversation>, call: () => Promise<unknown>) => {
          close();
          apply(c.id, patch, call);
        };
        const unread = c.unreadCount > 0 || c.manualUnread;
        return (
          <FloatingMenu anchor={menuFor.at} onClose={close} width={228}>
            {muteFor === c.id ? (
              MUTE_OPTIONS.map((o) => (
                <MenuItem
                  key={o.label}
                  label={o.label}
                  onClick={() => act({ mutedUntil: o.value }, () => muteConversation(c.id, o.value))}
                />
              ))
            ) : (
              <>
                <MenuItem
                  icon={IconPin}
                  label={t(c.pinnedAt ? 'conv_actions.unpin' : 'conv_actions.pin')}
                  onClick={() =>
                    act({ pinnedAt: c.pinnedAt ? null : new Date().toISOString() }, () =>
                      pinConversation(c.id, !c.pinnedAt),
                    )
                  }
                />
                <MenuItem
                  icon={IconStar}
                  label={t(c.favoritedAt ? 'conv_actions.unfavorite' : 'conv_actions.favorite')}
                  onClick={() =>
                    act({ favoritedAt: c.favoritedAt ? null : new Date().toISOString() }, () =>
                      favoriteConversation(c.id, !c.favoritedAt),
                    )
                  }
                />
                {isMuted(c) ? (
                  <MenuItem
                    icon={IconBell}
                    label={t('details.reactivate_notifs')}
                    onClick={() => act({ mutedUntil: null }, () => muteConversation(c.id, null))}
                  />
                ) : (
                  <MenuItem
                    icon={IconBellOff}
                    label={t('details.mute_for')}
                    /* ⚠️ Ne ferme pas : on passe à la liste des durées DANS le même menu. */
                    onClick={() => setMuteFor(c.id)}
                  />
                )}
                {!c.archivedAt && !unread && (
                  <MenuItem
                    label={t('conv_actions.mark_unread')}
                    onClick={() => act({ manualUnread: true }, () => markUnread(c.id))}
                  />
                )}
                <MenuItem
                  icon={IconArchive}
                  label={t(c.archivedAt ? 'conv_actions.unarchive' : 'conv_actions.archive')}
                  onClick={() =>
                    act(
                      {
                        archivedAt: c.archivedAt ? null : new Date().toISOString(),
                        // ⚠️ Archiver retire l'épinglage, comme le serveur le fait : sans ça
                        // la liste et la base divergeraient jusqu'au prochain rechargement.
                        ...(c.archivedAt ? {} : { pinnedAt: null }),
                      },
                      () => archiveConversation(c.id, !c.archivedAt),
                    )
                  }
                />
              </>
            )}
          </FloatingMenu>
        );
      })()}

      {/* ⚠️ Pied de colonne, HORS de la zone qui défile : la vignette doit rester
          atteignable quelle que soit la position dans une longue liste. */}
      <button
        onClick={() => setProfileOpen(true)}
        aria-label="Vous"
        className="flex shrink-0 items-center gap-3 border-t border-slate-200 px-4 py-3 text-left hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
      >
        {me ? (
          <Avatar name={me.name} photoUrl={me.photoUrl} size={36} />
        ) : (
          <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200 dark:bg-zinc-800" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {me?.name ?? '\u00A0'}
          </span>
          <span className="block text-xs text-slate-400">Vous</span>
        </span>
      </button>

      {requestsOpen && (
        <MessageRequestsPanel
          meId={meId}
          onClose={() => setRequestsOpen(false)}
          onOpenConversation={(convId) => {
            // Acceptée, elle rejoint la liste normale : il faut la recharger pour l'y voir.
            load();
            router.push(`/chat/${convId}`);
          }}
          onCountChange={setMessageRequests}
        />
      )}

      {profileUserId && (
        <UserProfileDialog
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onOpenConversation={(convId) => {
            load();
            router.push(`/chat/${convId}`);
          }}
        />
      )}

      {friendsOpen && (
        <FriendsPanel
          onOpenProfile={setProfileUserId}
          onClose={() => setFriendsOpen(false)}
          onOpenConversation={(convId) => {
            // La conversation peut être neuve : on recharge pour qu'elle figure dans la liste.
            load();
            router.push(`/chat/${convId}`);
          }}
          onFindPeople={() => {
            // ⚠️ On referme le panneau AVANT d'ouvrir le dialogue : les deux se posent au
            // même endroit, les laisser coexister empilerait deux couches sur la colonne.
            setFriendsOpen(false);
            setNewChatMode('phone');
            setNewChatOpen(true);
          }}
          onCountChange={setFriendRequests}
        />
      )}

      {profileOpen && <ProfilePanel me={me} onClose={() => setProfileOpen(false)} />}

      <NewChatDialog
        open={newChatOpen}
        initialMode={newChatMode}
        onOpenProfile={setProfileUserId}
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
