'use client';

import type { Transition, Variants } from 'framer-motion';

/**
 * Vocabulaire d'animation de l'application.
 *
 * ⚠️ UN SEUL endroit définit le « ressenti ». Chaque composant qui invente son propre ressort
 * donne une application qui ne bat pas la même mesure d'un écran à l'autre — le défaut se
 * voit moins qu'une faute de couleur, mais s'entend tout autant.
 *
 * ⚠️ LE REBOND VIT SUR LES TRANSLATIONS, JAMAIS SUR LES ÉCHELLES. Un ressort sur `scale` fait
 * gonfler l'élément au-delà de sa taille finale puis revenir : sur du texte, c'est un flou
 * passager ; sur une boîte de dialogue, ça donne l'impression que l'interface hésite. Les
 * échelles utilisent donc un amortissement franc (`damped`), les déplacements un ressort à
 * peine élastique (`soft`).
 */

/**
 * Ressort principal : souple, avec un léger dépassement.
 *
 * ⚠️ Calé sur celui des exemples de motion.dev (`stiffness: 200, damping: 22`), demandé par
 * le client comme référence. Le rapport d'amortissement vaut ζ ≈ 0.78 — sous 1, donc le
 * mouvement dépasse sa cible et revient : c'est ce qui donne le rebond. Ma première version
 * (420/30, ζ ≈ 0.88) arrivait plus vite et ne dépassait presque pas : nette, mais sans
 * « flow ».
 */
export const soft: Transition = { type: 'spring', stiffness: 200, damping: 22 };

/**
 * Plus vif, pour les micro-interactions au doigt (boutons, icônes).
 *
 * ⚠️ Même rapport d'amortissement que `soft` (ζ ≈ 0.78) mais plus raide : le rebond se
 * ressemble d'un bout à l'autre de l'application, seule la vitesse change. Deux ressorts de
 * caractères différents donneraient deux interfaces cousues ensemble.
 */
export const snappy: Transition = { type: 'spring', stiffness: 420, damping: 32 };

/**
 * Transformation d'un élément en un autre (`layoutId`) — le geste « dossier iOS ».
 *
 * ⚠️ Volontairement PLUS LENT que `soft` : un morphing parcourt toute la distance entre deux
 * endroits de l'écran, souvent plusieurs centaines de pixels. À la vitesse d'une apparition,
 * l'œil ne suit pas le lien entre le point de départ et l'arrivée — et c'est précisément ce
 * lien qui fait tout l'intérêt du procédé.
 */
export const morph: Transition = { type: 'spring', stiffness: 170, damping: 24 };

/**
 * Sans dépassement — pour tout ce qui change d'ÉCHELLE, et pour les surfaces larges.
 *
 * ⚠️ ζ ≈ 0.87, juste sous le seuil critique : le mouvement arrive vite et s'arrête sans
 * osciller visiblement. C'est ce qu'il faut sur une échelle, où un dépassement rend le texte
 * flou le temps du rebond.
 */
export const damped: Transition = { type: 'spring', stiffness: 300, damping: 30 };

/** Fondu simple, quand un mouvement n'apporterait rien (voiles, incrustations). */
export const fade: Transition = { duration: 0.18, ease: [0.4, 0, 0.2, 1] };

/**
 * Décalage d'une cascade.
 *
 * ⚠️ Volontairement court (35 ms) : au-delà, une liste de dix éléments met une demi-seconde
 * à finir d'apparaître, et l'effet passe de « vivant » à « lent ».
 */
export const STAGGER = 0.035;

/** Apparition d'un élément de liste : monte légèrement en se révélant. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: soft },
};

/** Conteneur d'une cascade, décalage fixe — pour les listes courtes et connues. */
export const listContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER } },
};

/**
 * Cascade dont la DURÉE TOTALE est bornée, quel que soit le nombre d'éléments.
 *
 * ⚠️ Un décalage fixe ne tient pas sur une liste dont on ignore la longueur : mesuré sur une
 * recherche à 41 résultats, 35 ms par ligne faisaient apparaître la dernière 1,4 seconde
 * après la première — on attend devant une liste déjà chargée. Le décalage se resserre donc à
 * mesure que la liste s'allonge, pour que l'ensemble tienne dans ~300 ms.
 *
 * ⚠️ Borné aussi vers le BAS (4 ms) : en dessous, la cascade ne se lit plus et autant tout
 * afficher d'un coup — mais la garder évite un saut de comportement au-delà d'un seuil.
 */
export const staggeredList = (count: number): Variants => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren: Math.max(0.004, Math.min(STAGGER, 0.3 / Math.max(1, count))),
    },
  },
});

/**
 * Boîte de dialogue : monte et se révèle.
 *
 * ⚠️ L'échelle part de 0.97 et non de 0.8 : une boîte qui grandit beaucoup donne l'impression
 * de jaillir de nulle part. Un écart faible suffit à faire sentir l'arrivée.
 */
export const dialog: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: damped },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } },
};

/** Voile derrière une boîte de dialogue. */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: fade },
  exit: { opacity: 0, transition: fade },
};

/**
 * PRINCIPE DIRECTEUR, tiré du bouton d'action du composeur (`ComposerActions`) que le client
 * a validé : **une chose vient de là où on l'a déclenchée**.
 *
 * Un menu sort du bouton qu'on a cliqué, une feuille sort du bord dont elle vient, les
 * entrées d'une liste arrivent l'une après l'autre. Ce qui apparaît « sur place » n'a pas
 * d'origine, et l'œil ne relie pas ce qu'il voit à ce qu'il a fait.
 *
 * ⚠️ L'ÉCHELLE SE RÈGLE SUR LA TAILLE DE L'ÉLÉMENT. Un petit objet (pastille, entrée de menu)
 * supporte le ressort `soft` : le léger dépassement se lit comme du ressort. Une grande
 * surface (boîte de dialogue, panneau) prend `damped` : sur plusieurs centaines de pixels, le
 * même dépassement devient un tremblement, et le texte qu'elle porte se brouille le temps du
 * rebond.
 */

/** Cascade d'un menu : ses entrées sortent l'une après l'autre. */
export const menuContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025 } },
  exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
};

/**
 * Une entrée de menu.
 *
 * ⚠️ Elle glisse depuis le HAUT (`y: -6`), c'est-à-dire depuis le point d'ouverture du menu,
 * et non depuis le vide. L'ampleur est faible exprès : sur une liste dense, un déplacement
 * marqué donne l'impression que le menu se déballe.
 */
export const menuItem: Variants = {
  hidden: { opacity: 0, y: -6 },
  show: { opacity: 1, y: 0, transition: soft },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/**
 * Surface qui SORT D'UN POINT — un popover ancré à son bouton.
 *
 * ⚠️ À utiliser avec un `transformOrigin` posé sur le coin d'où elle vient, sinon elle grandit
 * depuis son centre et l'ancrage ne se lit pas.
 */
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: damped },
  exit: { opacity: 0, scale: 0.94, y: 6, transition: { duration: 0.12 } },
};

/** Panneau qui recouvre une colonne (profil, détails, confidentialité). */
export const panel: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: soft },
  exit: { opacity: 0, x: 16, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } },
};

/**
 * Bulle de message qui arrive.
 *
 * ⚠️ TRANSFORM SEULEMENT — jamais de `height`, de `margin` ni de `layout`. Le fil de
 * discussion tient sa position au pixel près (`settle`, `holdRef`) ; une animation qui change
 * la HAUTEUR du contenu déplacerait le fil sous les yeux de qui est en train de lire, et
 * ferait dériver un saut vers un message. Une transformation ne coûte rien à la mise en page.
 *
 * ⚠️ Le côté d'arrivée dépend de l'auteur : les miens entrent par la droite, ceux d'en face
 * par la gauche. C'est ce qui fait lire l'échange comme une conversation et non comme une
 * liste qui se remplit.
 */
export const bubble = (mine: boolean): Variants => ({
  hidden: { opacity: 0, y: 12, x: mine ? 14 : -14 },
  show: { opacity: 1, y: 0, x: 0, transition: soft },
});
