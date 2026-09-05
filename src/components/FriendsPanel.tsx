'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { IconBack } from '@/components/icons';
import { fetchFriends, startDirectConversation, type Friend } from '@/lib/conversations';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  fetchFriendRequests,
  refuseFriendRequest,
  removeFriend,
  type FriendRequest,
} from '@/lib/friends';

type Tab = 'friends' | 'received' | 'sent';

/** ⚠️ Clés i18n et non libellés : traduits à l'affichage. */
const TAB_KEY: Record<Tab, string> = {
  friends: 'friends.my_friends',
  received: 'friends.received',
  sent: 'friends.sent',
};

/**
 * « Amis » — pendant web de `components/FriendsPanel.tsx` du mobile.
 *
 * ⚠️ Sa raison d'être : le web savait ENVOYER une demande d'ami (recherche par numéro) mais
 * pas en accepter une. Une demande reçue restait donc en suspens jusqu'à ce que la personne
 * ouvre son téléphone — la moitié d'un échange ne pouvait pas se conclure.
 *
 * ⚠️ Recouvre la colonne de la liste, comme « Vous » : la conversation ouverte reste visible
 * à droite et revenir ne la ferme pas.
 */
export function FriendsPanel({
  onClose,
  onOpenConversation,
  onOpenProfile,
  onFindPeople,
  onCountChange,
}: {
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  /** Ouvre le profil de quelqu'un — la fenêtre est portée par la liste. */
  onOpenProfile: (userId: string) => void;
  /**
   * Mène à la recherche par numéro.
   *
   * ⚠️ C'est le SEUL moyen, sur le web, de trouver quelqu'un qu'on n'a pas déjà : pas de
   * carnet d'adresses dans un navigateur. Sans ce relais, l'onglet « Envoyées » vide est un
   * cul-de-sac — il constate qu'on n'a envoyé aucune demande sans dire par où en envoyer une.
   */
  onFindPeople: () => void;
  /** Remonte le nombre de demandes reçues, pour la pastille de l'en-tête. */
  onCountChange: (n: number) => void;
}) {
  /**
   * ⚠️ Renommée `tr` : ce composant utilise déjà `t` comme variable de boucle sur les onglets
   * (`(['friends', ...] as Tab[]).map((t) => …)`). Garder le nom habituel masquerait l'un par
   * l'autre à l'intérieur de la boucle, là où les deux servent.
   */
  const { t: tr } = useTranslation();
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [received, setReceived] = useState<FriendRequest[]>([]);
  const [sent, setSent] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  /** Ligne en cours de traitement : évite le double clic sur « Accepter ». */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  /**
   * ⚠️ Chaîne de promesses et non `async/await` : les `setState` vivent alors dans un
   * callback `.then`, donc APRÈS le rendu. Écrits dans le corps d'une fonction `async`
   * appelée depuis un effet, React 19 les signale comme des rendus en cascade.
   */
  const load = useCallback(
    () =>
      Promise.all([fetchFriends(), fetchFriendRequests()])
        .then(([f, [r, s]]) => {
          setFriends(f);
          setReceived(r);
          setSent(s);
          onCountChange(r.length);
        })
        // Réseau : on laisse les listes en l'état plutôt que de les vider.
        .catch(() => {})
        .finally(() => setLoading(false)),
    [onCountChange],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * ⚠️ On RECHARGE après chaque action au lieu de retirer la ligne à la main : accepter une
   * demande la fait disparaître des reçues ET apparaître dans les amis. Deux listes à tenir
   * d'un côté, une requête de l'autre — et le serveur fait foi.
   */
  const run = (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    void action()
      .then(load)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const openChat = (userId: string) =>
    run(`chat:${userId}`, () =>
      startDirectConversation(userId).then((c) => {
        onOpenConversation(c.id);
        onClose();
      }),
    );

  const visibleFriends = friends.filter((f) =>
    query.trim() ? f.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  const row = (
    user: Friend,
    actions: { label: string; onClick: () => void; kind?: 'primary' | 'danger' }[],
    subtitle?: string,
  ) => (
    <li key={user.id} className="flex items-center gap-3 px-4 py-2.5">
      {/* ⚠️ Seuls l'avatar et le nom ouvrent le profil, pas la ligne entière : les boutons
          d'action vivent à droite, et un parent cliquable capterait leurs clics. */}
      <button
        onClick={() => onOpenProfile(user.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
      <Avatar name={user.name} photoUrl={user.photoUrl} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-slate-900 dark:text-zinc-100">{user.name}</p>
        {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
      </div>
      </button>
      <div className="flex shrink-0 gap-1.5">
        {actions.map((a) => (
          <button
            key={a.label}
            disabled={!!busy}
            onClick={a.onClick}
            className={`rounded-lg px-2.5 py-1.5 text-sm font-medium disabled:opacity-40 ${
              a.kind === 'primary'
                ? 'bg-[#1E40AF] text-white'
                : a.kind === 'danger'
                  ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </li>
  );

  const empty = (text: string) => (
    <p className="px-6 py-10 text-center text-sm text-slate-400">{text}</p>
  );

  /** Bouton d'appel vers la recherche par numéro. */
  const findPeopleButton = (variant: 'primary' | 'discret') => (
    <button
      onClick={onFindPeople}
      className={
        variant === 'primary'
          ? 'mt-4 rounded-xl bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white'
          : 'mx-auto mt-2 mb-4 block rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }
    >
      {tr('friends.find_by_phone')}
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          aria-label={tr('list.back_to_chats')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">{tr('friends.title')}</h1>
      </header>

      <div className="flex gap-2 px-4 py-3">
        {(['friends', 'received', 'sent'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
              tab === t
                ? 'bg-[#1E40AF] text-white'
                : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {tr(TAB_KEY[t])}
            {/* Pastille sur « Reçues » : c'est le seul onglet qui appelle une action. */}
            {t === 'received' && received.length > 0 && (
              <span
                className={`rounded-full px-1.5 text-xs font-bold ${
                  tab === t ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                }`}
              >
                {received.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'friends' && (
        <div className="px-4 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('search.placeholder')}
            className="w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
      )}

      {error && <p className="px-4 pb-1 text-sm text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          empty(tr('common.loading'))
        ) : tab === 'friends' ? (
          visibleFriends.length === 0 ? (
            empty(query ? tr('common.no_results') : tr('friends.none'))
          ) : (
            <ul>
              {visibleFriends.map((f) =>
                row(f, [
                  { label: tr('friends.message'), onClick: () => openChat(f.id), kind: 'primary' },
                  {
                    label: tr('friends.remove'),
                    kind: 'danger',
                    onClick: () => {
                      if (!window.confirm(tr('friends.remove_confirm', { name: f.name }))) return;
                      run(`remove:${f.id}`, () => removeFriend(f.id));
                    },
                  },
                ]),
              )}
            </ul>
          )
        ) : tab === 'received' ? (
          received.length === 0 ? (
            empty(tr('friends.none_received'))
          ) : (
            <ul>
              {received.map((r) =>
                row(
                  r.user,
                  [
                    {
                      label: tr('friends.accept'),
                      kind: 'primary',
                      onClick: () =>
                        run(`accept:${r.requestId}`, () => acceptFriendRequest(r.requestId)),
                    },
                    {
                      label: tr('friends.refuse'),
                      kind: 'danger',
                      onClick: () =>
                        run(`refuse:${r.requestId}`, () => refuseFriendRequest(r.requestId)),
                    },
                  ],
                  new Date(r.createdAt).toLocaleDateString(),
                ),
              )}
            </ul>
          )
        ) : sent.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-400">{tr('friends.none_sent')}</p>
            <p className="mt-1 text-sm text-slate-400">
              {tr('friends.none_sent_hint')}
            </p>
            {findPeopleButton('primary')}
          </div>
        ) : (
          <ul>
            {sent.map((r) =>
              row(
                r.user,
                [
                  {
                    label: tr('friends.cancel_request'),
                    onClick: () =>
                      run(`cancel:${r.requestId}`, () => cancelFriendRequest(r.requestId)),
                  },
                ],
                tr('friends.sent_on', { date: new Date(r.createdAt).toLocaleDateString() }),
              ),
            )}
            {/* ⚠️ Toujours proposé, pas seulement sur liste vide : sinon envoyer une première
                demande ferait disparaître le seul chemin pour en envoyer une seconde. */}
            {findPeopleButton('discret')}
          </ul>
        )}
      </div>
    </div>
  );
}
