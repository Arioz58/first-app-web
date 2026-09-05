'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

import { IconCheck, IconClose } from '@/components/icons';
import { backdrop, dialog, menuItem } from '@/lib/motion';
import { useTranslation } from 'react-i18next';

/**
 * Choix parmi quelques valeurs — sourdine, messages éphémères, qui peut envoyer.
 *
 * ⚠️ Remplace un motif où la liste des options s'affichait À LA PLACE du bouton, dans le
 * panneau. Rien n'annonçait qu'on entrait dans un choix : le réglage disparaissait, une liste
 * sans titre le remplaçait, et il n'y avait aucun moyen d'en sortir sans choisir. Une boîte de
 * dialogue nomme ce qu'on règle, montre la valeur courante, et se referme sans rien changer.
 *
 * ⚠️ Un seul composant pour les trois réglages : ils posaient la même question et avaient donc
 * le même défaut. Trois corrections séparées auraient laissé trois occasions de diverger.
 */

export type Choice<T> = { label: string; value: T };

export function ChoiceDialog<T>({
  open,
  title,
  options,
  current,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  options: Choice<T>[];
  /** Valeur en cours, cochée dans la liste. `undefined` si aucune ne l'est. */
  current?: T;
  onSelect: (value: T) => void;
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
    /**
     * ⚠️ `AnimatePresence` DANS le composant : avec un `if (!open) return null`, il quitterait
     * l'arbre à la fermeture et l'animation de sortie ne se jouerait jamais.
     */
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
            className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <IconClose size={15} />
              </button>
            </div>

            <ul className="pb-2">
              {options.map((o, i) => {
                const actif = current !== undefined && o.value === current;
                return (
                  /* Les entrées arrivent l'une après l'autre — même principe que partout
                     ailleurs : ce qui apparaît d'un bloc n'a pas d'origine. */
                  <motion.li key={i} variants={menuItem}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(o.value);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <span className="flex-1">{o.label}</span>
                      {/* ⚠️ La valeur courante est COCHÉE : sans repère, on ne sait pas sur
                          quoi le réglage est posé, et on le remet au hasard. */}
                      {actif && <IconCheck size={16} className="text-[#1E40AF] dark:text-blue-400" />}
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
