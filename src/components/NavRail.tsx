'use client';

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { IconChat, IconSparkle, IconUsers } from '@/components/icons';
import { morph, snappy } from '@/lib/motion';

/**
 * Barre de navigation en pilule — conversations, amis, stories.
 *
 * ⚠️ Ces trois vues occupaient auparavant le même espace de façons différentes : les stories
 * étaient une bande horizontale posée en tête de la liste, les amis un panneau qui la
 * recouvrait, et les conversations la vue par défaut. Rien ne disait qu'il s'agissait de trois
 * destinations de même rang, ni comment revenir de l'une à l'autre.
 *
 * ⚠️ L'indicateur de la vue active est un `layoutId` : il GLISSE d'une icône à l'autre au lieu
 * de disparaître ici et réapparaître là. C'est le même procédé que l'ouverture d'une photo en
 * plein écran — le déplacement dit d'où l'on vient.
 */

export type Vue = 'chats' | 'friends' | 'stories';

const ENTREES: { vue: Vue; icone: typeof IconChat; cle: string }[] = [
  { vue: 'chats', icone: IconChat, cle: 'nav.chats' },
  { vue: 'friends', icone: IconUsers, cle: 'nav.friends' },
  { vue: 'stories', icone: IconSparkle, cle: 'nav.stories' },
];

export function NavRail({
  vue,
  onChange,
  badges,
}: {
  vue: Vue;
  onChange: (v: Vue) => void;
  /** Compteurs affichés en pastille. Une valeur nulle n'affiche rien. */
  badges?: Partial<Record<Vue, number>>;
}) {
  const { t } = useTranslation();

  /*
   * ⚠️ Alignée EN HAUT et non centrée : centrée dans une colonne pleine hauteur, la pilule
   * flottait au milieu d'un vide, loin du contenu qu'elle commande.
   *
   * ⚠️ `shrink-0` : elle ne doit pas se comprimer quand la liste à côté manque de place.
   */
  return (
    <nav className="flex shrink-0 flex-col items-center px-2.5 pt-4">
      <div className="flex flex-col gap-1 rounded-full bg-slate-100 p-1.5 shadow-sm ring-1 ring-slate-200/70 dark:bg-zinc-800 dark:ring-zinc-700/70">
        {ENTREES.map(({ vue: v, icone: Icone, cle }) => {
          const actif = v === vue;
          const compte = badges?.[v] ?? 0;
          return (
            <motion.button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              whileTap={{ scale: 0.9 }}
              transition={snappy}
              title={t(cle)}
              aria-label={t(cle)}
              aria-current={actif ? 'page' : undefined}
              className="relative flex h-11 w-11 items-center justify-center rounded-full"
            >
              {/*
                ⚠️ L'indicateur est UN SEUL élément partagé (`layoutId`) : il se déplace d'une
                icône à l'autre. En rendre un par bouton et le montrer/cacher donnerait un
                clignotement, sans lien visible entre l'ancienne et la nouvelle position.

                ⚠️ Il est posé DERRIÈRE l'icône (`inset-0`, pas de z-index sur elle) : au
                premier plan, il masquerait le glyphe pendant le déplacement.
              */}
              {actif && (
                <motion.span
                  layoutId="nav-actif"
                  transition={morph}
                  className="absolute inset-0 rounded-full bg-white shadow-sm dark:bg-zinc-900"
                />
              )}
              <Icone
                size={19}
                className={`relative ${
                  actif
                    ? 'text-[#1E40AF] dark:text-blue-400'
                    : 'text-slate-500 dark:text-zinc-400'
                }`}
              />
              {compte > 0 && (
                <span className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {compte > 9 ? '9+' : compte}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
