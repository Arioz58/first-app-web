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

/** Taille d'une pastille d'action. */
const TAILLE = 42;

/**
 * Géométrie de l'arc, en coordonnées polaires depuis le CENTRE du bouton.
 *
 * ⚠️ L'arc s'ouvre vers le HAUT et la DROITE. Le composeur est en bas de l'écran et le bouton
 * contre le bord gauche : vers le bas il sortirait de la fenêtre, vers la gauche il n'y a pas
 * de place. Le premier angle est volontairement au-dessus de l'horizontale (28°) pour que la
 * pastille la plus basse dégage la barre de saisie au lieu de la recouvrir.
 */
const RAYON = 225;
const ANGLE_BAS = 24;
const ANGLE_HAUT = 80;

/*
 * ⚠️ Le rayon est dicté par l'ESPACEMENT, pas choisi à l'œil. Cinq pastilles de 42 px
 * réparties sur 56° doivent rester séparées : l'écart entre deux centres vaut
 * `rayon × (angle total en radians) / (n - 1)`, soit ici 225 × 0.977 / 4 ≈ 55 px — 13 px de
 * jour entre deux pastilles. Avec le rayon initial de 132, cet écart tombait à 41 px et les
 * pastilles se touchaient.
 *
 * ⚠️ L'angle haut s'arrête à 80° et non à la verticale : au-delà, la pastille du sommet passe
 * à gauche du bouton, qui est déjà contre le bord du panneau — et son libellé, posé à gauche,
 * sortait de l'écran.
 */

/**
 * Position d'une pastille sur l'arc.
 *
 * ⚠️ `y` est NÉGATIF vers le haut : l'axe des ordonnées du navigateur descend, alors que
 * l'angle d'un cercle trigonométrique monte. Oublier ce signe déploie l'arc sous le bouton,
 * hors de l'écran.
 */
const positionArc = (index: number, total: number) => {
  const t = total <= 1 ? 0 : index / (total - 1);
  const angle = ((ANGLE_BAS + (ANGLE_HAUT - ANGLE_BAS) * t) * Math.PI) / 180;
  return { x: Math.cos(angle) * RAYON, y: -Math.sin(angle) * RAYON };
};

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
            /*
              ⚠️ Conteneur de taille NULLE, ancré sur le centre du bouton : chaque pastille est
              placée par un décalage depuis ce point. C'est ce qui leur permet de partir
              exactement du « + » — un conteneur avec ses propres dimensions les ferait naître
              d'un de ses coins.
            */
            className="absolute bottom-5 left-5 z-50 h-0 w-0"
            initial="ferme"
            animate="ouvert"
            exit="ferme"
            variants={{
              /**
               * ⚠️ La cascade s'inverse à la fermeture (`staggerDirection: -1`) : les actions
               * rentrent dans le bouton en commençant par la plus haute. Sans cela, l'arc se
               * replie à l'envers de la façon dont il s'est ouvert.
               */
              ouvert: { transition: { staggerChildren: 0.045 } },
              ferme: { transition: { staggerChildren: 0.035, staggerDirection: -1 } },
            }}
          >
            {actions.map((action, i) => {
              const { x, y } = positionArc(i, actions.length);
              return (
                <motion.li
                  key={action.key}
                  /* ⚠️ `group` sur la LIGNE et non sur le bouton : le libellé est son voisin,
                     pas son descendant, et `group-hover` ne l'atteindrait jamais. */
                  className="group absolute hover:z-10"
                  style={{ left: -TAILLE / 2, top: -TAILLE / 2, width: TAILLE, height: TAILLE }}
                  variants={{
                    /**
                     * ⚠️ Départ à (0, 0) et à l'échelle 0.3 : les pastilles SORTENT du bouton
                     * au lieu d'apparaître à leur place. C'est tout ce qui distingue un menu
                     * qui se déploie d'un menu qui s'affiche.
                     */
                    ferme: { x: 0, y: 0, scale: 0.3, opacity: 0 },
                    ouvert: { x, y, scale: 1, opacity: 1, transition: soft },
                  }}
                >
                  <motion.button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      action.onSelect();
                    }}
                    whileHover={{ scale: 1.12 }}
                    whileTap={{ scale: 0.9 }}
                    transition={snappy}
                    aria-label={action.label}
                    className="flex h-full w-full items-center justify-center rounded-full bg-white text-[#1E40AF] shadow-lg ring-1 ring-slate-200 dark:bg-zinc-800 dark:text-blue-300 dark:ring-zinc-700"
                  >
                    <action.icon size={18} />
                  </motion.button>

                  {/*
                    Libellé À GAUCHE de la pastille, révélé au survol.

                    ⚠️ `pointer-events-none` : il déborde sur la conversation et sur les autres
                    pastilles, et sans cela il intercepterait leurs clics.

                    ⚠️ Un seul libellé est visible à la fois (au survol) : posés en permanence,
                    ceux des pastilles hautes et basses se chevaucheraient, l'arc les rapprochant
                    horizontalement.
                  */}
                  {/* ⚠️ `hover:z-10` sur la ligne : sans lui, le libellé d'une pastille basse
                      passait DERRIÈRE les pastilles voisines, l'arc les faisant se recouvrir. */}
                  <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100/95 dark:text-zinc-900">
                    {action.label}
                  </span>
                </motion.li>
              );
            })}
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
