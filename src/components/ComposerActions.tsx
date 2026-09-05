'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';

import { IconPlus } from '@/components/icons';
import { snappy, soft } from '@/lib/motion';

/**
 * Bouton d'action flottant du composeur — remplace le « + » et son menu en liste.
 *
 * Reprend le procédé de l'exemple `floating-action-button` de motion.dev, désigné comme
 * référence : le bouton se déploie en une COLONNE d'actions décalées dans le temps, chacune
 * portant son libellé en infobulle, avec ressorts et retours au survol et à l'appui.
 *
 * ⚠️ Le code de l'exemple est derrière Motion+ (payant). Reconstruit à partir de sa
 * description publique et des APIs qu'elle cite (`AnimatePresence`, `whileHover`,
 * `whilePress`) — l'équivalent React de `whilePress` étant `whileTap`.
 *
 * ⚠️ Le déploiement va vers le HAUT : le composeur est en bas de l'écran, une colonne
 * descendante sortirait de la fenêtre.
 */

export type ComposerAction = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  onSelect: () => void;
};

/** Taille d'une pastille d'action et écart entre elles — la colonne se calcule dessus. */
const TAILLE = 42;
const ECART = 10;

export function ComposerActions({
  open,
  onOpenChange,
  actions,
  disabled,
  label,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ⚠️ Du plus PROCHE du bouton au plus loin : c'est l'ordre d'apparition. */
  actions: ComposerAction[];
  disabled?: boolean;
  label: string;
  /** Remplace l'icône par un indicateur d'activité pendant un téléversement. */
  busy?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <div className="relative shrink-0">
      {/*
        Voile transparent qui ferme au clic à côté.

        ⚠️ Rendu SOUS la colonne mais AU-DESSUS du reste : sans lui, cliquer dans la
        conversation laissait le menu ouvert par-dessus, et il fallait viser le bouton pour
        s'en débarrasser.
      */}
      <AnimatePresence>
        {open && (
          <motion.div
            /* ⚠️ Légèrement assombri, pas transparent : les pastilles sont blanches et se
               perdaient dans les bulles blanches du fil. Un voile discret les détache sans
               masquer la conversation. */
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => onOpenChange(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.ul
            className="absolute bottom-full left-0 z-50 mb-3 flex flex-col-reverse"
            style={{ gap: ECART }}
            initial="ferme"
            animate="ouvert"
            exit="ferme"
            variants={{
              /**
               * ⚠️ La cascade s'inverse à la fermeture (`staggerDirection: -1`) : les actions
               * rentrent dans le bouton en commençant par la plus éloignée. Sans cela, la
               * colonne se replie à l'envers de la façon dont elle s'est ouverte, et le
               * mouvement paraît accidentel.
               */
              ouvert: { transition: { staggerChildren: 0.04 } },
              ferme: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
            }}
          >
            {actions.map((action) => (
              <motion.li
                key={action.key}
                /* ⚠️ `group` sur la LIGNE et non sur le bouton : le libellé est son voisin,
                   pas son descendant, et `group-hover` ne l'atteignait jamais. */
                className="group flex items-center gap-2"
                variants={{
                  /**
                   * ⚠️ Les actions partent DU BOUTON (`y: 14`, échelle réduite) et non du
                   * vide : c'est ce qui donne l'impression qu'elles en sortent, au lieu
                   * d'apparaître en l'air au-dessus de lui.
                   */
                  ferme: { opacity: 0, y: 14, scale: 0.6 },
                  ouvert: { opacity: 1, y: 0, scale: 1, transition: soft },
                }}
              >
                <motion.button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    action.onSelect();
                  }}
                  whileHover={{ scale: 1.09 }}
                  whileTap={{ scale: 0.9 }}
                  transition={snappy}
                  aria-label={action.label}
                  style={{ width: TAILLE, height: TAILLE }}
                  className="flex items-center justify-center rounded-full bg-white text-[#1E40AF] shadow-lg ring-1 ring-slate-200 dark:bg-zinc-800 dark:text-blue-300 dark:ring-zinc-700"
                >
                  <action.icon size={18} />
                </motion.button>

                {/*
                  Libellé en infobulle, révélé au survol de la LIGNE entière.

                  ⚠️ `pointer-events-none` : l'infobulle recouvre la conversation, et sans
                  cela elle intercepterait les clics destinés à ce qu'il y a derrière.
                */}
                <span className="pointer-events-none whitespace-nowrap rounded-lg bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100/95 dark:text-zinc-900">
                  {action.label}
                </span>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.88 }}
        transition={snappy}
        aria-label={label}
        aria-expanded={open}
        className="relative z-50 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-zinc-800"
      >
        {busy ?? (
          // ⚠️ Le « + » PIVOTE en croix : le bouton dit lui-même s'il est ouvert.
          <motion.span animate={{ rotate: open ? 45 : 0 }} transition={soft} className="flex">
            <IconPlus size={22} />
          </motion.span>
        )}
      </motion.button>
    </div>
  );
}
