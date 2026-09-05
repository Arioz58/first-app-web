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
 * Éventail : chaque pastille est au bout d'un BRAS qui pivote autour du bouton.
 *
 * ⚠️ Le mouvement ne consiste PAS à déplacer les pastilles vers un point calculé sur un
 * cercle — ce serait un déplacement en ligne droite vers une position qui se trouve être sur
 * un arc. Ici c'est le bras qui tourne, donc la pastille SUIT réellement l'arc, comme la lame
 * d'un éventail. C'est la différence entre « disposé en arc » et « déplié en arc ».
 *
 * ⚠️ Toutes les lames partent du MÊME angle (celui de la première) : l'éventail est fermé au
 * départ, les pastilles empilées, et s'ouvre en les écartant. C'est ce qui donne l'accordéon.
 */
const RAYON = 225;

/** Angle de la lame la plus BASSE, en degrés au-dessus de l'horizontale, vers la droite. */
const ANGLE_FERME = 18;
/** Angle de la lame la plus HAUTE. */
const ANGLE_OUVERT = 74;

/**
 * ⚠️ L'angle bas ne descend pas sous 18° : la pastille passerait derrière la barre de saisie.
 * L'angle haut s'arrête à 74° pour que l'éventail reste franchement À DROITE du bouton —
 * au-delà il repasse au-dessus, et la forme ne se lit plus comme un dépliage vers la droite.
 *
 * ⚠️ L'écart entre deux pastilles vaut `rayon x angle_total_en_radians / (n - 1)`, soit
 * 225 x 0.977 / 4 ≈ 55 px pour 42 px de diamètre : 13 px de jour. Réduire le rayon les fait
 * se toucher.
 */
const angleLame = (index: number, total: number) =>
  ANGLE_FERME + (ANGLE_OUVERT - ANGLE_FERME) * (total <= 1 ? 0 : index / (total - 1));

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
              const angle = angleLame(i, actions.length);
              return (
                /*
                  LE BRAS. Longueur nulle, pivot sur le centre du bouton ; c'est lui qui
                  tourne, et la pastille au bout suit l'arc.

                  ⚠️ Rotation NÉGATIVE : en CSS un angle positif tourne dans le sens des
                  aiguilles d'une montre, donc vers le bas. L'éventail doit monter.
                */
                <motion.li
                  key={action.key}
                  className="absolute h-0 w-0"
                  style={{ transformOrigin: '0px 0px' }}
                  variants={{
                    ferme: { rotate: -ANGLE_FERME, scale: 0.35, opacity: 0 },
                    ouvert: { rotate: -angle, scale: 1, opacity: 1, transition: soft },
                  }}
                >
                  {/* La longueur du bras. */}
                  <div style={{ transform: `translateX(${RAYON}px)` }}>
                    {/*
                      ⚠️ CONTRE-ROTATION, animée en même temps que le bras : sans elle, la
                      pastille et surtout son libellé tourneraient avec l'éventail et
                      arriveraient de travers. Elle annule exactement la rotation du bras, si
                      bien que le contenu reste droit pendant tout le dépliage.
                    */}
                    <motion.div
                      className="group relative"
                      style={{ width: TAILLE, height: TAILLE, marginLeft: -TAILLE / 2, marginTop: -TAILLE / 2 }}
                      variants={{
                        ferme: { rotate: ANGLE_FERME },
                        ouvert: { rotate: angle, transition: soft },
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

                        ⚠️ `pointer-events-none` : il déborde sur la conversation et sur les
                        autres pastilles, et sans cela il intercepterait leurs clics.

                        ⚠️ Un seul libellé à la fois : posés en permanence, ceux des lames
                        voisines se chevaucheraient, l'éventail les rapprochant à la verticale.
                      */}
                      <span className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100/95 dark:text-zinc-900">
                        {action.label}
                      </span>
                    </motion.div>
                  </div>
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
