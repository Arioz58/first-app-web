'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { IconBack } from '@/components/icons';
import {
  acceptMessageRequest,
  conversationName,
  conversationPhoto,
  declineMessageRequest,
  fetchMessageRequests,
  messagePreview,
  type Conversation,
} from '@/lib/conversations';

/**
 * Demandes de messages — pendant web d'`app/requests.tsx`.
 *
 * ⚠️ Accepter fait entrer la conversation dans la liste normale ; refuser la supprime pour
 * soi SANS avertir l'expéditeur. C'est tout l'objet du dispositif : décider si l'on veut de
 * cet échange avant qu'il n'occupe la liste.
 */
export function MessageRequestsPanel({
  meId,
  onClose,
  onOpenConversation,
  onCountChange,
}: {
  meId: string | null;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  /** Remonte le nombre de demandes, pour la bannière de la liste. */
  onCountChange: (n: number) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  /** ⚠️ Chaîne de promesses : les `setState` vivent dans un `.then`, donc après le rendu. */
  const load = useCallback(
    () =>
      fetchMessageRequests()
        .then((list) => {
          setItems(list);
          onCountChange(list.length);
        })
        .catch(() => {})
        .finally(() => setLoading(false)),
    [onCountChange],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = (id: string, action: () => Promise<unknown>, then?: () => void) => {
    setBusy(id);
    void action()
      .then(() => {
        then?.();
        return load();
      })
      .catch(() => {})
      .finally(() => setBusy(null));
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          aria-label={t('list.back_to_chats')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
          {t('requests.title')}
        </h1>
      </header>

      <p className="px-4 py-3 text-sm text-slate-400">
        {t('requests.hint')}
      </p>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{t('requests.none')}</p>
        ) : (
          <ul>
            {items.map((c) => {
              const name = conversationName(c, meId);
              return (
                <li key={c.id} className="border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <Avatar name={name} photoUrl={conversationPhoto(c, meId)} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">
                        {name}
                      </p>
                      <p className="truncate text-sm text-slate-400">
                        {messagePreview(c.messages[0]).text}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        run(c.id, () => acceptMessageRequest(c.id), () => {
                          onOpenConversation(c.id);
                          onClose();
                        })
                      }
                      className="flex-1 rounded-xl bg-[#1E40AF] py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {t('requests.accept')}
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => {
                        // ⚠️ Confirmation : refuser efface la conversation pour soi, et rien
                        // ne permet de revenir en arrière.
                        if (!window.confirm(t('requests.delete_confirm', { name }))) return;
                        run(c.id, () => declineMessageRequest(c.id));
                      }}
                      className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-medium text-red-500 disabled:opacity-40 dark:border-zinc-700"
                    >
                      {t('requests.delete')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
