'use client';

import { useSyncExternalStore } from 'react';

/**
 * Thème clair / sombre — pendant web de `lib/theme.ts` du mobile.
 *
 * ⚠️ Trois valeurs et non un booléen : `system` (défaut) SUIT le réglage de l'appareil et
 * doit continuer à le suivre quand celui-ci change. Un booléen figerait le choix au premier
 * rendu, et basculer son Mac en sombre le soir ne changerait plus rien.
 *
 * ⚠️ La préférence est appliquée par une CLASSE `dark` sur `<html>`, pas par la media query
 * seule : c'est ce qui permet de forcer un thème contre celui du système. Voir
 * `globals.css`, où la variante `dark:` de Tailwind est redéfinie en conséquence.
 */

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'nexa.theme';

/**
 * Écrit (ou efface) le cookie que le SERVEUR lit pour rendre la bonne classe dès le premier
 * octet.
 *
 * ⚠️ Le cookie ne porte QUE les choix explicites. « Système » l'EFFACE, au lieu d'y écrire
 * « system » : le serveur ne connaît pas le réglage de l'appareil, et poser une classe à sa
 * place le figerait. Sans classe, c'est `prefers-color-scheme` qui tranche dans le CSS —
 * donc la bonne valeur, et elle continue de suivre l'OS s'il change.
 *
 * ⚠️ `SameSite=Lax` et un an de durée : c'est une préférence d'affichage, elle n'a rien de
 * sensible, mais elle doit survivre à la fermeture du navigateur.
 */
const ecrireCookie = (pref: ThemePref) => {
  try {
    document.cookie =
      pref === 'system'
        ? `${KEY}=; path=/; max-age=0; SameSite=Lax`
        : `${KEY}=${pref}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Cookies bloqués : le thème s'applique quand même pour cette session, mais le
    // rechargement repartira du réglage système.
  }
};

/**
 * ⚠️ Plus de `label` ici : le libellé est traduit à l'affichage (`profile.light`,
 * `profile.dark`, `profile.system`). Un texte figé dans ce module aurait échappé à l'i18n,
 * et ce module n'est pas un composant — il ne peut pas appeler `t`.
 */
export const THEME_OPTIONS: { value: ThemePref }[] = [
  { value: 'light' },
  { value: 'dark' },
  { value: 'system' },
];

export const getThemePref = (): ThemePref => {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    // Navigation privée ou stockage bloqué : on retombe sur le réglage système.
    return 'system';
  }
};

/** Le thème EFFECTIF, une fois `system` résolu. */
export const resolveTheme = (pref: ThemePref): 'light' | 'dark' => {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * Pose la classe sur `<html>`.
 *
 * ⚠️ `color-scheme` est posé EN PLUS de la classe : c'est lui qui fait suivre ce que le
 * navigateur dessine lui-même — barres de défilement, champs de saisie, sélecteurs natifs.
 * Sans lui, une app en sombre garde des ascenseurs blancs.
 */
export const applyTheme = (pref: ThemePref) => {
  const root = document.documentElement;
  /**
   * ⚠️ Les DEUX classes sont gérées, et « système » n'en pose aucune : `light` doit exister
   * pour pouvoir contredire un système en sombre (voir la variante `dark:` de globals.css,
   * qui l'exclut explicitement). Se contenter de retirer `dark` laisserait la media query
   * reprendre la main et ignorerait le choix « Clair ».
   */
  root.classList.toggle('dark', pref === 'dark');
  root.classList.toggle('light', pref === 'light');
  root.style.colorScheme = pref === 'system' ? 'light dark' : pref;
};

// --- Store externe, pour que les composants réagissent au changement ---

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const setThemePref = (pref: ThemePref) => {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    // Le choix ne survivra pas au rechargement, mais il s'applique pour cette session.
  }
  ecrireCookie(pref);
  applyTheme(pref);
  emit();
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  /**
   * ⚠️ On écoute AUSSI le réglage du système : en mode `system`, l'utilisateur peut basculer
   * son OS en sombre pendant que l'onglet est ouvert. Sans cet écouteur, la page resterait
   * claire jusqu'au prochain rechargement.
   */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  /**
   * ⚠️ En mode « système », rien à réappliquer : aucune classe n'est posée et le CSS suit
   * déjà la media query. On se contente de PRÉVENIR les composants, dont l'affichage du
   * réglage dans le profil.
   */
  const onSystem = () => {
    if (getThemePref() === 'system') emit();
  };
  mq.addEventListener('change', onSystem);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener('change', onSystem);
  };
};

/**
 * ⚠️ Le hook RENVOIE la valeur qu'il observe, il ne la relit pas par un appel externe — même
 * règle que sur mobile (`friendRequests.ts`, `unreadMessages.ts`). Lire l'état à côté de
 * `useSyncExternalStore` laisse le compilateur React mémoïser cet appel, et l'affichage reste
 * figé jusqu'au remontage.
 */
export const useThemePref = (): ThemePref =>
  useSyncExternalStore(
    subscribe,
    getThemePref,
    // Rendu serveur : aucune préférence lisible, et c'est bien le défaut.
    () => 'system' as ThemePref,
  );
