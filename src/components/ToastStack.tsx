'use client';

import { Avatar } from '@/components/Avatar';
import { IconChevronDown } from '@/components/icons';
import {
  dismissToast,
  pauseToastExpiry,
  resumeToastExpiry,
  useToasts,
  type Toast,
} from '@/lib/toasts';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Bandeaux visibles quand la pile est FERMÉE. Au-delà, elle se lit comme un tas de papiers. */
const VISIBLE = 3;

/**
 * Hauteur d'un bandeau, FIXE.
 *
 * ⚠️ Imposée et non mesurée : déplier la pile demande de savoir où poser chaque carte, et une
 * hauteur mesurée arriverait une image trop tard — la liste se déplierait en deux temps. C'est
 * aussi ce qui permet au corps de tenir sur UNE ligne, comme une notification du système : la
 * liste dépliée est un index, pas une lecture.
 */
const CARD_H = 64;

/** Écart entre deux bandeaux une fois la pile dépliée. */
const GAP = 8;

/**
 * Lisière laissée à chaque carte du dessous, pile fermée.
 *
 * ⚠️ Combinée au rétrécissement, c'est ELLE qui fait lire une pile plutôt qu'un décalage : on
 * doit voir dépasser le bord inférieur de la carte suivante, et ses côtés rentrer.
 */
const STACK_OFFSET = 12;

/** Rétrécissement par niveau de profondeur, pile fermée. */
const SCALE_STEP = 0.05;

/** Opacité par profondeur, pile fermée. La troisième ne dit que « il y en a d'autres ». */
const DEPTH_OPACITY = [1, 0.65, 0.35];

/**
 * Distance d'entrée et de sortie, vers le HAUT.
 *
 * ⚠️ Le bandeau vient du bord de la fenêtre, là où arrivent les notifications du système :
 * c'est ce qui le fait lire comme une alerte et non comme un élément de l'interface. Même
 * principe que partout ailleurs — une chose vient de là où elle est déclenchée.
 */
const TRAVEL = 80;

/** Glissement vers le haut au-delà duquel le bandeau est rejeté. */
const DISMISS_DISTANCE = -50;

/**
 * Repli automatique de la pile ouverte.
 *
 * ⚠️ Indispensable puisque l'ouverture SUSPEND l'expiration : sans lui, une pile dépliée puis
 * oubliée resterait à l'écran indéfiniment.
 */
const COLLAPSE_AFTER = 8000;

/**
 * Déplacements — une COURBE, plus un ressort.
 *
 * ⚠️ Trois corrections successives le même jour, la dernière ayant réglé le fond : le
 * dépliement paraissait « rebondir » alors que le ressort n'oscillait plus (ζ ≈ 1). Ce qu'on
 * voyait était sa QUEUE — un ressort s'approche de sa cible de façon asymptotique, sans jamais
 * s'arrêter franchement, et met d'autant plus de temps que le trajet est long. Sur les 80 px
 * d'une arrivée la fin passe inaperçue ; au dépliement, la dernière carte parcourt plus de
 * 200 px et la même traîne se lit comme de l'élasticité.
 *
 * ⚠️ D'où une courbe `easeOutCubic`, qui décélère franchement et s'arrête À LA DATE PRÉVUE,
 * quelle que soit la distance.
 *
 * ⚠️ Réglage PROPRE à ce composant : ne pas le « rétablir » sur le vocabulaire commun
 * (`lib/motion.ts`), fait pour des objets qu'on manipule, où le dépassement se lit comme de la
 * matière. Une alerte se pose, elle ne rebondit pas. Mêmes nombres que le mobile.
 */
const EASE_OUT = [0.33, 1, 0.68, 1] as const;

const TRANSITION = {
  y: { duration: 0.24, ease: EASE_OUT },
  scale: { duration: 0.18, ease: EASE_OUT },
  opacity: { duration: 0.14 },
};

function ToastCard({
  toast,
  depth,
  expanded,
  canExpand,
  onToggle,
}: {
  toast: Toast;
  depth: number;
  expanded: boolean;
  /** Vrai sur la carte du dessus quand la pile en cache d'autres : elle porte le chevron. */
  canExpand: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  // Dépliée, la pile devient une LISTE : chaque carte à sa place, pleine et cliquable.
  // Fermée, elle redevient un empilement : les cartes du dessous reculent et s'effacent.
  const hidden = !expanded && depth >= VISIBLE;

  return (
    <motion.div
      initial={{ y: -TRAVEL, opacity: 0, scale: 0.94 }}
      animate={{
        y: expanded ? depth * (CARD_H + GAP) : depth * STACK_OFFSET,
        opacity: expanded ? 1 : hidden ? 0 : DEPTH_OPACITY[depth] ?? 0,
        scale: expanded ? 1 : 1 - depth * SCALE_STEP,
      }}
      exit={{ y: -TRAVEL, opacity: 0, scale: 0.94 }}
      transition={TRANSITION}
      // Glisser vers le haut pour écarter. Vers le bas, le mouvement est retenu par
      // `dragElastic` : on sent que ça résiste plutôt que de décoller un bandeau qui n'irait
      // nulle part.
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.9, bottom: 0.05 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < DISMISS_DISTANCE || info.velocity.y < -600) dismissToast(toast.id);
      }}
      className="absolute inset-x-0 cursor-pointer"
      // La carte de devant passe au-dessus de celles qu'elle repousse. Pile fermée, elle seule
      // reçoit les clics : les autres ne sont que des indices visuels, et viser une carte à
      // moitié cachée n'aurait pas de sens.
      style={{
        zIndex: VISIBLE - depth,
        pointerEvents: expanded || depth === 0 ? 'auto' : 'none',
        height: CARD_H,
      }}
      onClick={() => {
        dismissToast(toast.id);
        if (toast.href) router.push(toast.href);
      }}
    >
      <div className="flex h-full items-center gap-3 rounded-2xl border border-black/5 bg-white/90 px-3 shadow-lg backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
        <Avatar name={toast.title} photoUrl={toast.photoUrl} size={40} group={toast.isGroup} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {toast.title}
          </p>
          {/* Une seule ligne : la hauteur de la carte est fixe, et c'est elle qui permet de
              déplier la pile sans mesurer quoi que ce soit. */}
          <p className="truncate text-[13px] text-slate-600 dark:text-zinc-400">{toast.body}</p>
        </div>
        {canExpand && (
          <button
            type="button"
            aria-label={t('toast.expand')}
            aria-expanded={expanded}
            // ⚠️ `stopPropagation` : sans lui, le clic remonterait à la carte et ouvrirait la
            // conversation au lieu de déplier la pile.
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="-mr-1 flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.18 }}
              className="flex"
            >
              <IconChevronDown size={18} />
            </motion.span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Pile de bandeaux d'alerte, en haut de la fenêtre.
 *
 * ⚠️ Montée dans le LAYOUT de la messagerie et non dans une page : Next.js conserve les
 * layouts d'une navigation à l'autre, donc un bandeau survit au passage d'une conversation à
 * l'autre — c'est précisément quand on change d'écran qu'il doit rester lisible.
 *
 * ⚠️ Ancrée à droite et non centrée : au centre, elle recouvrirait l'en-tête de la conversation
 * ouverte (nom, appels, menu), c'est-à-dire ce qu'on est en train d'utiliser.
 */
export function ToastStack() {
  const toasts = useToasts();
  const [expanded, setExpanded] = useState(false);

  /**
   * La pile s'est vidée : elle ne peut pas rester « dépliée » pour la série suivante, qui n'a
   * rien à voir avec celle qu'on lisait.
   *
   * ⚠️ Ajusté PENDANT LE RENDU et non dans un effet. Un effet qui appelle `setState` déclenche
   * un deuxième rendu en cascade — la pile se dessinerait une image ouverte avant de se
   * refermer. C'est le motif que React recommande pour réinitialiser un état sur changement
   * d'une valeur d'entrée.
   *
   * ⚠️ Le drapeau doit être RÉINITIALISÉ et pas seulement ignoré au rendu : laissé à vrai, il
   * ferait s'ouvrir toute seule la prochaine pile dès sa deuxième alerte.
   */
  const [lastCount, setLastCount] = useState(toasts.length);
  if (lastCount !== toasts.length) {
    setLastCount(toasts.length);
    if (toasts.length <= 1 && expanded) setExpanded(false);
  }

  /**
   * ⚠️ Ouvrir la pile SUSPEND l'expiration des alertes : sans cela, elles s'effaceraient une à
   * une pendant qu'on lit la liste, et la ligne visée se déroberait sous le curseur.
   *
   * ⚠️ Repli automatique au bout de `COLLAPSE_AFTER` : l'expiration étant suspendue, une pile
   * dépliée puis oubliée resterait à l'écran indéfiniment.
   */
  useEffect(() => {
    if (!expanded) return;
    pauseToastExpiry();
    const timer = setTimeout(() => setExpanded(false), COLLAPSE_AFTER);
    return () => {
      clearTimeout(timer);
      resumeToastExpiry();
    };
  }, [expanded]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 w-[min(22rem,calc(100vw-2rem))]">
      <div className="pointer-events-auto relative">
        <AnimatePresence>
          {toasts.map((toast, depth) => (
            <ToastCard
              key={toast.id}
              toast={toast}
              depth={depth}
              expanded={expanded}
              canExpand={depth === 0 && toasts.length > 1}
              onToggle={() => setExpanded((v) => !v)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
