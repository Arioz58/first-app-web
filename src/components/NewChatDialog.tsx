'use client';

import { IconCheck } from '@/components/icons';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
  createGroup,
  fetchFriends,
  startDirectConversation,
  type Friend,
} from '@/lib/conversations';

type Mode = 'direct' | 'group';

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
}: {
  open: boolean;
  onClose: () => void;
  /** Reçoit l'identifiant de la conversation créée ou retrouvée. */
  onOpened: (conversationId: string) => void;
}) {
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
      setMode('direct');
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
  }, [open]);

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
            {(['direct', 'group'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  mode === m
                    ? 'bg-[#1E40AF] text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                {m === 'direct' ? 'Conversation' : 'Nouveau groupe'}
              </button>
            ))}
          </div>

          {mode === 'group' && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nom du groupe"
              className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un contact"
            className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Chargement…</p>
          ) : visible.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              {query
                ? 'Aucun contact trouvé.'
                : 'Aucun contact. Ajoutez des amis depuis l’application mobile.'}
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
            Annuler
          </button>
          {mode === 'group' && (
            <button
              disabled={busy || !groupName.trim() || !picked.length}
              onClick={submitGroup}
              className="flex-1 rounded-xl bg-[#1E40AF] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Créer{picked.length ? ` (${picked.length})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
