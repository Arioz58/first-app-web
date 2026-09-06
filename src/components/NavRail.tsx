'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { IconChat, IconSparkle, IconUsers } from '@/components/icons';
import { damped, listItem, morph, snappy, staggeredList } from '@/lib/motion';

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

/**
 * Libellé révélé au survol, à DROITE de l'icône.
 *
 * ⚠️ Même traitement que les actions du composeur, mais du côté opposé : la barre est contre
 * le bord gauche, un libellé posé à sa gauche sortirait de l'écran.
 *
 * ⚠️ `pointer-events-none` : il déborde sur la colonne de contenu, et sans cela il
 * intercepterait les clics destinés à ce qu'il y a derrière.
 */
function Bulle({ texte }: { texte: string }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900/90 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-zinc-100/95 dark:text-zinc-900">
      {texte}
    </span>
  );
}

export function NavRail({
  vue,
  onChange,
  badges,
  me,
  onOpenProfile,
}: {
  vue: Vue;
  onChange: (v: Vue) => void;
  /** Compteurs affichés en pastille. Une valeur nulle n'affiche rien. */
  badges?: Partial<Record<Vue, number>>;
  me: { name: string; photoUrl: string | null } | null;
  onOpenProfile: () => void;
}) {
  const { t } = useTranslation();

  /*
   * ⚠️ Alignée EN HAUT et non centrée : centrée dans une colonne pleine hauteur, la pilule
   * flottait au milieu d'un vide, loin du contenu qu'elle commande.
   *
   * ⚠️ `shrink-0` : elle ne doit pas se comprimer quand la liste à côté manque de place.
   */
  return (
    /*
      ⚠️ `relative z-20` sur la BARRE : ses infobulles débordent sur la colonne de contenu,
      qui vient APRÈS elle dans le document et se peignait donc par-dessus — le libellé
      apparaissait tronqué, coupé net par le champ de recherche. Un `z-index` sur l'infobulle
      seule n'y suffit pas : sans contexte d'empilement remonté sur la barre, il ne joue qu'à
      l'intérieur de celle-ci.

      ⚠️ Reste SOUS les panneaux (`z-30`, profil et demandes de messages), qui doivent
      recouvrir la barre elle-même.
    */
    <nav className="relative z-20 flex shrink-0 flex-col items-center justify-between px-2.5 py-4">
      {/*
        ⚠️ La pilule ARRIVE au montage, ses icônes l'une après l'autre. Sans cela elle est
        simplement « déjà là » au chargement, alors que tout le reste de l'application se
        présente en venant de quelque part.

        ⚠️ `damped` sur la pilule (une surface) et ressort sur les icônes (de petits objets) :
        même règle que partout — le dépassement se lit comme du ressort sur ce qui est petit,
        comme un tremblement sur ce qui est large.
      */}
      <motion.div
        variants={staggeredList(ENTREES.length)}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-1 rounded-full bg-slate-100 p-1.5 shadow-sm ring-1 ring-slate-200/70 dark:bg-zinc-800 dark:ring-zinc-700/70"
      >
        {ENTREES.map(({ vue: v, icone: Icone, cle }) => {
          const actif = v === vue;
          const compte = badges?.[v] ?? 0;
          return (
            <motion.button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              variants={listItem}
              /* ⚠️ Pas de survol sur l'entrée ACTIVE : elle est déjà mise en avant par son
                 indicateur, et l'agrandir encore la ferait déborder de la pilule. */
              whileHover={actif ? undefined : { scale: 1.12 }}
              whileTap={{ scale: 0.9 }}
              transition={snappy}
              aria-label={t(cle)}
              aria-current={actif ? 'page' : undefined}
              className="group relative flex h-11 w-11 items-center justify-center rounded-full"
            >
              <Bulle texte={t(cle)} />
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
              {/*
                ⚠️ Les icônes INACTIVES sont légèrement en retrait (0.9). Au changement de vue,
                le ressort fait donc « éclore » la nouvelle et se retirer l'ancienne — un
                mouvement obtenu sans image-clé ni état supplémentaire, juste par la différence
                entre deux tailles au repos.
              */}
              <motion.span
                animate={{ scale: actif ? 1 : 0.9 }}
                transition={snappy}
                className="relative flex"
              >
                <Icone
                  size={19}
                  className={
                    actif
                      ? 'text-[#1E40AF] dark:text-blue-400'
                      : 'text-slate-500 dark:text-zinc-400'
                  }
                />
              </motion.span>
              {/*
                ⚠️ La pastille ARRIVE et REPART au lieu d'apparaître d'un coup : c'est le seul
                élément de la barre qui change sans qu'on ait rien fait — un message reçu, une
                demande d'ami — et ce mouvement est ce qui attire l'œil vers lui.
              */}
              <AnimatePresence>
                {compte > 0 && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={damped}
                    className="absolute -right-0.5 -top-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                  >
                    {compte > 9 ? '9+' : compte}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </motion.div>

      {/*
        ⚠️ Le profil est DANS la colonne de la barre mais HORS de la pilule, et c'est
        volontaire : il n'est pas une destination de même rang que les trois autres. Celles-ci
        changent le contenu de la colonne ; lui ouvre un panneau qui la RECOUVRE. Dans la
        pilule, avec le même traitement, il annoncerait un quatrième onglet — et il faudrait
        alors trancher un cas bancal : l'indicateur actif se pose-t-il dessus ? S'il se pose,
        il ment ; s'il ne se pose pas, le contrôle devient incohérent avec lui-même.

        ⚠️ Le nom du compte, visible en permanence dans l'ancien pied de colonne, n'est plus
        que dans l'infobulle. C'est la contrepartie assumée du gain de place : c'est ainsi
        qu'on remarquait être connecté avec le mauvais compte.
      */}
      <motion.button
        type="button"
        onClick={onOpenProfile}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        transition={snappy}
        aria-label={t('list.you')}
        className="group relative flex h-11 w-11 items-center justify-center rounded-full"
      >
        <Bulle texte={me ? `${me.name} · ${t('list.you')}` : t('list.you')} />
        {me ? (
          <Avatar name={me.name} photoUrl={me.photoUrl} size={36} />
        ) : (
          <span className="h-9 w-9 animate-pulse rounded-full bg-slate-200 dark:bg-zinc-800" />
        )}
      </motion.button>
    </nav>
  );
}
