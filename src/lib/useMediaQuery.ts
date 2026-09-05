'use client';

import { useSyncExternalStore } from 'react';

/**
 * Suit une media query CSS depuis React.
 *
 * ⚠️ `useSyncExternalStore` et non un `useState` + effet : le navigateur est déjà la source de
 * vérité, et la dupliquer dans un état obligerait à le poser dans un effet — ce que React 19
 * interdit. Le hook RENVOIE la valeur qu'il observe, règle déjà apprise sur `useThemePref`.
 *
 * ⚠️ Rendu serveur : on répond `false`. Le serveur ne connaît pas la taille de la fenêtre, et
 * prétendre le contraire produirait une divergence d'hydratation.
 */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
