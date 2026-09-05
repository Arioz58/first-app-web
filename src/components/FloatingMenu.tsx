'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { damped, menuItem } from '@/lib/motion';

/**
 * Menu flottant, positionné au point où on l'a ouvert.
 *
 * ⚠️ Rendu dans un PORTAIL sur `document.body`, pas à sa place dans l'arbre : les menus
 * vivent dans des conteneurs en `overflow-y-auto` (le fil de discussion, la liste des
 * conversations, le panneau de détails). Un enfant en `absolute` y est DÉCOUPÉ au bord du
 * conteneur, et sur les dernières lignes le menu se retrouvait tronqué ou invisible.
 *
 * ⚠️ En `position: fixed`, donc coordonnées relatives à la FENÊTRE — ce sont exactement
 * celles que donne un événement souris (`clientX`/`clientY`), sans conversion.
 */

export type MenuAnchor = { x: number; y: number };

/** Marge minimale avec le bord de la fenêtre, pour que le menu ne colle jamais au ras. */
const EDGE = 8;

/**
 * Point d'ouverture depuis un événement souris.
 *
 * ⚠️ `detail === 0` signale un clic déclenché au CLAVIER (Entrée/Espace sur un bouton
 * focalisé) : `clientX/clientY` valent alors 0 et le menu s'ouvrirait dans le coin de
 * l'écran. On retombe sur la position du bouton lui-même.
 */
export const anchorFromEvent = (e: React.MouseEvent): MenuAnchor => {
  if (e.detail === 0) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  }
  return { x: e.clientX, y: e.clientY };
};

/** Ouvre le menu et empêche celui du navigateur. À poser sur `onContextMenu`. */
export const openOnRightClick =
  (open: (a: MenuAnchor) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open({ x: e.clientX, y: e.clientY });
  };

export function FloatingMenu({
  anchor,
  onClose,
  width = 224,
  children,
}: {
  /** `null` = fermé. */
  anchor: MenuAnchor | null;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuAnchor | null>(null);

  /**
   * Repli dans la fenêtre, une fois la HAUTEUR RÉELLE connue.
   *
   * ⚠️ En `useLayoutEffect` et non `useEffect` : la mesure et le repositionnement doivent
   * arriver avant la peinture, sinon le menu s'affiche une frame au mauvais endroit puis
   * saute. Il est rendu invisible (`pos === null`) tant qu'il n'est pas placé.
   */
  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPos(null);
      return;
    }
    const h = ref.current.offsetHeight;
    const { innerWidth: vw, innerHeight: vh } = window;
    // Déborde à droite → on tire vers la gauche ; déborde en bas → le menu monte.
    const x = Math.max(EDGE, Math.min(anchor.x, vw - width - EDGE));
    const y = anchor.y + h + EDGE > vh ? Math.max(EDGE, anchor.y - h) : anchor.y;
    setPos({ x, y });
  }, [anchor, width]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();

    /**
     * Fermeture au clic extérieur, en écouteur DOCUMENT plutôt qu'avec un fond capteur.
     *
     * ⚠️ C'est ce qui permet d'enchaîner : un clic DROIT sur une autre ligne ferme ce menu
     * (`mousedown`) puis ouvre le sien (`contextmenu`, qui suit). Avec un fond couvrant, le
     * second menu ne s'ouvrait jamais — il fallait deux clics droits.
     *
     * ⚠️ En capture, avant que la cible ne réagisse.
     */
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
      /**
       * ⚠️ Le clic gauche qui ferme ne doit RIEN activer d'autre : sans ça, fermer le menu
       * en cliquant sur une conversation l'ouvrirait au passage. On avale donc le `click`
       * qui suit ce `mousedown` — un seul, d'où `once`.
       */
      if (e.button === 0) {
        window.addEventListener(
          'click',
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          },
          { capture: true, once: true },
        );
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    /**
     * ⚠️ Fermé au DÉFILEMENT (en capture, donc y compris dans les conteneurs internes) : le
     * menu est en position fixe, il ne suit pas le contenu et se retrouverait sinon posé à
     * côté d'une autre ligne que celle qu'on visait.
     */
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor, close]);

  /**
   * ⚠️ `document` n'existe pas au rendu serveur de Next.js. Pas besoin d'un drapeau « monté »
   * pour autant : le menu ne s'ouvre que sur une interaction, donc `anchor` vaut forcément
   * `null` côté serveur ET au premier rendu client — les deux rendus concordent.
   */
  if (!anchor || typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      /**
       * ⚠️ Le menu SORT du point cliqué : `transformOrigin` sur le coin d'ouverture et
       * échelle qui part de 0.9. Sans cette origine, il grandirait depuis son centre et
       * l'ancrage au geste ne se lirait pas.
       *
       * ⚠️ Transition amortie et non élastique sur la SURFACE : un panneau de texte qui
       * rebondit devient flou le temps du dépassement. Le ressort, lui, vit sur les ENTRÉES,
       * qui sont petites — même règle que le bouton d'action du composeur.
       */
      variants={{
        hidden: { opacity: 0, scale: 0.9, y: -6 },
        show: {
          opacity: 1,
          scale: 1,
          y: 0,
          /**
           * ⚠️ La transition de la SURFACE et la cascade des ENTRÉES vivent dans le même
           * objet. Les fusionner par étalement (`...`) écrasait l'une par l'autre — le menu
           * perdait son amortissement ou ses entrées leur décalage, selon l'ordre.
           */
          transition: { ...damped, staggerChildren: 0.025, delayChildren: 0.02 },
        },
      }}
      initial="hidden"
      animate="show"
      style={{
        transformOrigin: 'top left',
        left: pos?.x ?? anchor.x,
        top: pos?.y ?? anchor.y,
        width,
        // Invisible tant que la hauteur n'est pas mesurée (une seule frame).
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[61] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-zinc-800 dark:ring-zinc-700"
    >
      {children}
    </motion.div>,
    document.body,
  );
}

/** Une entrée de menu. Partagée par tous les menus, pour qu'ils se ressemblent. */
export function MenuItem({
  label,
  onClick,
  danger,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Composant d'icône (voir `components/icons.ts`), optionnel. */
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  return (
    <motion.button
      role="menuitem"
      variants={menuItem}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-zinc-700 ${
        danger ? 'text-red-500' : 'text-slate-700 dark:text-zinc-200'
      }`}
    >
      {Icon && <Icon size={15} className="shrink-0" />}
      {label}
    </motion.button>
  );
}
