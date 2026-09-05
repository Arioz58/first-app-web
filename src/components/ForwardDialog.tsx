'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { backdrop, dialog } from '@/lib/motion';

import { IconCheck } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
  conversationName,
  conversationPhoto,
  fetchConversations,
  type Conversation,
} from '@/lib/conversations';

/**
 * Choix des conversations vers lesquelles transférer.
 *
 * ⚠️ Multi-sélection : transférer une photo à trois personnes est le cas courant, et rouvrir
 * la boîte trois fois pour cela serait pénible. Le bouton porte le compte pour que l'envoi
 * ne parte jamais par surprise.
 */
export function ForwardDialog({
  open,
  count,
  meId,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Nombre de BULLES transférées — un album compte pour une. */
  count: number;
  meId: string | null;
  onClose: () => void;
  onConfirm: (conversationIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  /**
   * ⚠️ Rechargé à CHAQUE ouverture et sélection remise à zéro : la liste bouge sans arrêt,
   * et garder une sélection d'une fois sur l'autre ferait partir un transfert vers une
   * conversation qu'on ne vise plus.
   *
   * ⚠️ Les remises à zéro sont DIFFÉRÉES (`queueMicrotask`) : posées directement dans
   * l'effet, elles s'exécuteraient de façon synchrone au montage — rendu en cascade, que
   * React 19 signale comme une erreur.
   */
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setPicked([]);
      setQuery('');
      setLoading(true);
    });
    void fetchConversations()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((c) => !c.archivedAt)
      .filter((c) => !q || conversationName(c, meId).toLowerCase().includes(q));
  }, [items, query, meId]);

  /**
   * ⚠️ `AnimatePresence` reste monté, c'est le CONTENU qui apparaît et disparaît. Avec un
   * `if (!open) return null`, le composant était retiré de l'arbre à la fermeture et
   * l'animation de sortie n'avait jamais lieu de se jouer : la boîte disparaissait d'un coup.
   */

  return (
    <AnimatePresence>
      {open && (
    <motion.div
      onClick={onClose}
      variants={backdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        variants={dialog}
        className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
      >
        <div className="px-5 pt-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
            {count > 1 ? t('chat.forward_n_to', { count: String(count) }) : t('chat.forward_to')}
          </h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">{t('chat.no_conversations')}</p>
          ) : (
            visible.map((c) => {
              const on = picked.includes(c.id);
              const name = conversationName(c, meId);
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                >
                  <Avatar
                    name={name}
                    photoUrl={conversationPhoto(c, meId)}
                    size={40}
                    group={c.type === 'group'}
                  />
                  <span className="flex-1 truncate text-slate-900 dark:text-zinc-100">
                    {name}
                  </span>
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs text-white ${
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

        <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm dark:border-zinc-700 dark:text-zinc-200"
          >
            Annuler
          </button>
          <button
            disabled={!picked.length}
            onClick={() => {
              onConfirm(picked);
              onClose();
            }}
            className="flex-1 rounded-xl bg-[#1E40AF] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Envoyer{picked.length ? ` (${picked.length})` : ''}
          </button>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
