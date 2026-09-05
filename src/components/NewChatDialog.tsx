'use client';

import { IconCheck } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { PhoneSearchPanel } from '@/components/PhoneSearchPanel';
import {
  createGroup,
  fetchFriends,
  startDirectConversation,
  type Friend,
} from '@/lib/conversations';

/**
 * ⚠️ « Par numéro » rejoint ici les deux autres plutôt que d'avoir sa propre entrée : c'est
 * la structure du FAB mobile (nouvelle conversation / nouveau groupe / ajouter un contact),
 * et le web n'a pas d'onglet Contacts où le loger.
 */
type Mode = 'direct' | 'group' | 'phone';

/** ⚠️ Clés i18n et non libellés : traduits à l'affichage. */
const MODE_KEY: Record<Mode, string> = {
  direct: 'newchat.chat',
  group: 'fab.new_group',
  phone: 'phone.tab',
};

/**
 * Démarrer une conversation ou créer un groupe.
 *
 * ⚠️ La liste vient de `/friends` et non d'une recherche d'utilisateurs : on ne peut écrire
 * qu'à ses amis, et proposer des inconnus donnerait des conversations que le serveur
 * refuserait selon le réglage `privacyMessages` de la cible.
 */
export function NewChatDialog({
  open,
  onClose,
  onOpened,
  initialMode = 'direct',
  onOpenProfile,
}: {
  open: boolean;
  /**
   * Onglet ouvert d'emblée.
   *
   * ⚠️ Existe pour que le panneau Amis puisse mener DIRECTEMENT à la recherche par numéro :
   * y arriver sur « Conversation » obligerait à comprendre qu'il faut encore changer
   * d'onglet, juste après avoir cliqué sur un bouton qui promettait autre chose.
   */
  initialMode?: Mode;
  /** Transmis à la recherche par numéro, dont la carte mène au profil. */
  onOpenProfile: (userId: string) => void;
  onClose: () => void;
  /** Reçoit l'identifiant de la conversation créée ou retrouvée. */
  onOpened: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('direct');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    // ⚠️ Différé : posés directement dans l'effet, ces `setState` s'exécuteraient de façon
    // synchrone au montage — rendu en cascade, que React 19 signale comme une erreur.
    queueMicrotask(() => {
      setMode(initialMode);
      setQuery('');
      setPicked([]);
      setGroupName('');
      setError('');
      setLoading(true);
    });
    void fetchFriends()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setLoading(false));
    // ⚠️ `initialMode` inclus : il change TOUJOURS juste avant l'ouverture (même geste, donc
    // même lot de rendu), l'effet ne se rejoue donc pas pour autant. L'omettre laisserait le
    // dialogue s'ouvrir sur le mode précédent.
  }, [open, initialMode]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? friends.filter((f) => f.name.toLowerCase().includes(q)) : friends;
  }, [friends, query]);

  if (!open) return null;

  const openDirect = (friendId: string) => {
    setBusy(true);
    void startDirectConversation(friendId)
      .then((conv) => {
        onOpened(conv.id);
        onClose();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const submitGroup = () => {
    if (!groupName.trim() || !picked.length) return;
    setBusy(true);
    void createGroup(groupName.trim(), picked)
      .then((conv) => {
        onOpened(conv.id);
        onClose();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
      >
        <div className="px-5 pt-5">
          <div className="flex gap-2">
            {(['direct', 'group', 'phone'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  mode === m
                    ? 'bg-[#1E40AF] text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                {t(MODE_KEY[m])}
              </button>
            ))}
          </div>

          {mode === 'phone' && (
            <PhoneSearchPanel
              onOpenProfile={(id) => {
                onOpenProfile(id);
                onClose();
              }}
              onOpened={(convId) => {
                onOpened(convId);
                onClose();
              }}
            />
          )}

          {mode === 'group' && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t('details.group_name')}
              className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />
          )}

          {mode !== 'phone' && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('newchat.search_contact')}
              className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />
          )}
        </div>

        <div className={`mt-3 flex-1 overflow-y-auto px-2 ${mode === 'phone' ? 'hidden' : ''}`}>
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : visible.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              {query
                ? t('newchat.no_contact_found')
                : t('newchat.no_contacts')}
            </p>
          ) : (
            visible.map((f) => {
              const on = picked.includes(f.id);
              return (
                <button
                  key={f.id}
                  disabled={busy}
                  onClick={() =>
                    mode === 'direct'
                      ? openDirect(f.id)
                      : setPicked((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-zinc-800/60"
                >
                  <Avatar name={f.name} photoUrl={f.photoUrl} size={40} />
                  <span className="flex-1 truncate text-slate-900 dark:text-zinc-100">
                    {f.name}
                  </span>
                  {mode === 'group' && (
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs text-white ${
                        on
                          ? 'border-[#1E40AF] bg-[#1E40AF]'
                          : 'border-slate-300 dark:border-zinc-600'
                      }`}
                    >
                      {on && <IconCheck size={14} strokeWidth={3} />}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {error && <p className="px-5 pb-1 text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm dark:border-zinc-700 dark:text-zinc-200"
          >
            {t('cancel')}
          </button>
          {mode === 'group' && (
            <button
              disabled={busy || !groupName.trim() || !picked.length}
              onClick={submitGroup}
              className="flex-1 rounded-xl bg-[#1E40AF] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t('newchat.create')}{picked.length ? ` (${picked.length})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
