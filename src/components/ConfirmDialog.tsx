'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { backdrop, dialog } from '@/lib/motion';

/**
 * Confirmation d'une action — remplace `window.confirm`.
 *
 * ⚠️ `window.confirm` BLOQUE le fil d'exécution du navigateur : rien ne s'affiche ni ne se
 * met à jour tant qu'on n'a pas répondu, socket compris. Il ne se traduit pas non plus — le
 * bouton « OK » reste dans la langue du système, pas dans celle de l'application — et son
 * apparence est celle du navigateur, sans rapport avec le reste de l'interface.
 *
 * ⚠️ L'action destructrice est à DROITE et en rouge, l'annulation à gauche et neutre : c'est
 * la disposition qu'attend l'œil, et l'inverser fait cliquer « bloquer » à qui voulait sortir.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  /** Colore l'action en rouge : suppression, blocage, départ d'un groupe. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
            className="w-full max-w-xs overflow-hidden rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
          >
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</h2>
            {message && (
              <p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{message}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#1E40AF] hover:bg-[#1b378f]'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
