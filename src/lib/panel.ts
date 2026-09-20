'use client';

import { useSyncExternalStore } from 'react';
import { PANEL_COOKIE } from './languages';

/**
 * Panneau de gauche replié ou non — demande du client (15/09) : pouvoir fermer la liste pour
 * que la conversation prenne toute la largeur, la barre de navigation restant visible.
 *
 * ⚠️ UN COOKIE ET NON `localStorage`, comme le thème et la langue : le layout de la
 * messagerie est un composant SERVEUR, et c'est lui qui rend la disposition. En stockage
 * navigateur, il rendrait toujours le panneau ouvert et celui-ci se refermerait à
 * l'hydratation — un repli visible à chaque chargement de page, pour quelqu'un qui a
 * justement demandé à ne plus voir cette colonne.
 *
 * ⚠️ Store externe et non un état local : deux composants distincts s'en servent — la barre
 * de navigation, qui porte le bouton, et la colonne, qui change de largeur.
 */

/**
 * ⚠️ Lu à l'IMPORT du module, donc avant l'hydratation : `getSnapshot` doit rendre dès la
 * première comparaison la même valeur que celle avec laquelle le serveur a rendu la page.
 * Le relire à chaque appel serait inutile — nous sommes seuls à l'écrire.
 */
const lireCookie = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c === `${PANEL_COOKIE}=1`);
};

let replie = lireCookie();
const listeners = new Set<() => void>();

export const setPanelCollapsed = (next: boolean) => {
  if (next === replie) return;
  replie = next;
  try {
    // ⚠️ Un an, `SameSite=Lax` : c'est une préférence d'affichage, elle n'a rien de sensible
    // mais doit survivre à la fermeture du navigateur. Même forme que le cookie du thème.
    document.cookie = next
      ? `${PANEL_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`
      : `${PANEL_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Cookies bloqués : le repli s'applique pour cette session, mais ne survivra pas au
    // rechargement. Rien de plus à faire — c'est de la disposition.
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getSnapshot = () => replie;

/**
 * ⚠️ `initial` vient du SERVEUR, qui a lu le cookie : c'est la valeur avec laquelle le HTML a
 * été rendu, donc celle que React doit retrouver en hydratant. La déduire ici renverrait
 * `false` au rendu serveur (pas de `document`) et ferait diverger l'hydratation.
 *
 * ⚠️ Le hook RENVOIE la valeur qu'il observe, il ne la relit pas par un appel externe — même
 * règle que `useThemePref` et `useMediaQuery`.
 */
export const usePanelCollapsed = (initial: boolean): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => initial);
