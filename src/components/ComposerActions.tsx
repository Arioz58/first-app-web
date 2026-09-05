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
 * Courbe des pastilles : la première PILE AU-DESSUS du « + », chacune ensuite plus haute et
 * un peu plus à droite que la précédente.
 *
 * ⚠️ Ce n'est PAS un arc centré sur le bouton. Sur un tel arc, passé la verticale les
 * pastilles se mettent à REDESCENDRE — c'est ce qui rendait les deux tentatives précédentes
 * fausses : elles partaient presque à l'horizontale et remontaient, au lieu de partir droit
 * en l'air et de s'incliner. Ici le centre du cercle est à DROITE, à la hauteur de la
 * première pastille, ce qui rend la tangente VERTICALE à cet endroit : la courbe démarre
 * droite et se couche progressivement vers la droite en montant.
 */

/** Hauteur de la première pastille au-dessus du centre du bouton. */
const HAUTEUR = 62;

/**
 * Rayon de la courbe.
 *
 * ⚠️ Il règle l'INCLINAISON, pas la taille : plus il est grand, plus la courbe reste droite
 * longtemps ; plus il est petit, plus elle se couche vite vers la droite.
 */
const RAYON = 150;

/**
 * Écart angulaire entre deux pastilles.
 *
 * ⚠️ Déduit de l'espacement voulu, pas choisi : sur un cercle, la distance entre deux points
 * vaut `rayon x angle`. 54 px de centre à centre pour 42 px de diamètre laissent 12 px de
 * jour ; réduire le rayon sans toucher à cet angle les ferait se toucher.
 */
const PAS = 54 / RAYON;

/** Angle de la i-ème pastille, mesuré depuis la verticale au-dessus du bouton. */
const angleLame = (index: number) => index * PAS;

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
            /*
              ⚠️ Le conteneur est ancré sur le CENTRE DU CERCLE — décalé de `RAYON` vers la
              droite et de `HAUTEUR` vers le haut par rapport au bouton — et non sur le bouton
              lui-même. C'est ce centre qui sert de pivot aux bras ; l'ancrer sur le « + »
              redonnerait l'arc qui redescend.
            */
            className="absolute z-50 h-0 w-0"
            style={{ left: 22 + RAYON, bottom: 22 + HAUTEUR }}
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
              const angle = angleLame(i);
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
                    /*
                      ⚠️ Fermé, TOUTES les lames sont à l'angle 0, c'est-à-dire empilées au
                      même endroit : juste au-dessus du « + ». L'éventail s'ouvre en les
                      écartant de là — c'est ce qui fait l'accordéon, et c'est ce qui donne au
                      « + » son rôle d'origine.
                    */
                    ferme: { rotate: 0, scale: 0.35, opacity: 0 },
                    ouvert: { rotate: `${(angle * 180) / Math.PI}deg`, scale: 1, opacity: 1, transition: soft },
                  }}
                >
                  {/* La longueur du bras. */}
                  {/* ⚠️ Bras vers la GAUCHE : le pivot est à droite des pastilles, la lame
                      pointe donc vers le bouton. */}
                  <div style={{ transform: `translateX(${-RAYON}px)` }}>
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
                        ferme: { rotate: 0 },
                        ouvert: { rotate: `${(-angle * 180) / Math.PI}deg`, transition: soft },
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
