'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { IconCheck } from '@/components/icons';
import { fetchFriends, type Friend } from '@/lib/conversations';
import { addMembers } from '@/lib/groups';

/**
 * Ajouter des membres à un groupe existant.
 *
 * ⚠️ Les membres DÉJÀ présents sont retirés de la liste plutôt que grisés : le serveur les
 * ignore silencieusement, donc les cocher ne produirait rien et laisserait croire à un échec.
 *
 * ⚠️ La source est `/friends`, comme à la création d'un groupe : on n'ajoute que ses amis.
 * Proposer des inconnus donnerait des ajouts que le serveur accepterait peut-être, mais qui
 * exposeraient la conversation à quelqu'un qu'on ne connaît pas.
 */
export function AddMembersDialog({
  open,
  conversationId,
  existingIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  conversationId: string;
  /** Identifiants des membres actuels — filtrés de la liste proposée. */
  existingIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    // ⚠️ Différé : un `setState` synchrone dans un effet est un rendu en cascade (React 19).
    queueMicrotask(() => {
      setQuery('');
      setPicked([]);
      setError('');
      setLoading(true);
    });
    void fetchFriends()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setLoading(false));
  }, [open]);

  const visible = useMemo(() => {
    const already = new Set(existingIds);
    const q = query.trim().toLowerCase();
    return friends
      .filter((f) => !already.has(f.id))
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true));
  }, [friends, existingIds, query]);

  if (!open) return null;

  const submit = () => {
    if (!picked.length) return;
    setBusy(true);
    void addMembers(conversationId, picked)
      .then(() => {
        onAdded();
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
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100">{t('newchat.add_members')}</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('newchat.search_contact')}
            className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : visible.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              {query ? t('newchat.no_contact_found') : t('newchat.all_in_group')}
            </p>
          ) : (
            visible.map((f) => {
              const on = picked.includes(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))
                  }
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-slate-50 dark:hover:bg-zinc-800"
                >
                  <Avatar name={f.name} photoUrl={f.photoUrl} size={40} />
                  <span className="flex-1 truncate text-sm text-slate-900 dark:text-zinc-100">
                    {f.name}
                  </span>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-white ${
                      on ? 'border-[#1E40AF] bg-[#1E40AF]' : 'border-slate-300 dark:border-zinc-600'
                    }`}
                  >
                    {on && <IconCheck size={14} strokeWidth={3} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {error && <p className="px-5 pt-2 text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 px-5 py-4">
          <button onClick={onClose} className="px-3 py-2 text-sm text-slate-500">
            {t('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy || !picked.length}
            className="rounded-xl bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {t('newchat.add')}{picked.length ? ` (${picked.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
