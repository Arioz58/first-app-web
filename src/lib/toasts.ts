'use client';

import { useSyncExternalStore } from 'react';

/**
 * Bandeaux d'alerte affichés DANS la page.
 *
 * ⚠️ Pendant exact de `lib/toasts.ts` côté mobile, et complément des notifications du
 * navigateur (`webNotifications.ts`), qui ne se déclenchent QUE lorsque l'onglet n'est pas
 * au premier plan : onglet visible, un message arrivé dans une autre conversation ne
 * produisait rien qu'une ligne qui remonte dans la liste, qu'on ne regarde pas
 * nécessairement. Les deux canaux sont donc exclusifs — jamais de bandeau ET de notification
 * système pour le même message.
 *
 * ⚠️ Store externe et non Context : le bandeau est rendu par le layout de la messagerie,
 * alors que l'événement arrive dans la liste des conversations. Un Context imposerait de
 * faire remonter l'état au-dessus des deux, donc de rendre toute la messagerie à chaque
 * message reçu.
 */
export type Toast = {
  id: string;
  /**
   * À quoi se rattache l'alerte : un identifiant de conversation.
   *
   * ⚠️ Ce n'est PAS une clé de regroupement — chaque message a son propre bandeau (voir
   * `showToast`). Elle sert à retirer d'un coup toutes les alertes d'une conversation quand on
   * l'ouvre.
   */
  key: string;
  title: string;
  body: string;
  photoUrl: string | null;
  isGroup: boolean;
  href: string | null;
};

/** Durée d'affichage. Assez pour lire deux lignes, assez court pour ne pas gêner. */
const LIFETIME = 5000;

/**
 * Alertes conservées. Trois sont visibles en pile fermée, toutes une fois dépliée.
 *
 * ⚠️ Plafonné à cinq : dépliée, la liste occupe déjà `5 × 72 px`. Au-delà, une alerte ne
 * préviendrait plus de rien, elle cacherait la page.
 */
const MAX = 5;

let toasts: Toast[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => toasts;

/**
 * ⚠️ Instantané SÉPARÉ pour le rendu serveur : `useSyncExternalStore` l'exige, et il doit
 * être vide. Rendre un bandeau côté serveur le ferait apparaître dans le HTML puis
 * disparaître à l'hydratation — et le tableau doit être une CONSTANTE, un tableau vide
 * recréé à chaque appel bouclerait sur une différence perpétuelle.
 */
const EMPTY: Toast[] = [];
const getServerSnapshot = () => EMPTY;

const emit = () => listeners.forEach((l) => l());

/**
 * Expiration SUSPENDUE — la pile est dépliée, donc quelqu'un est en train de la lire.
 *
 * ⚠️ Sans cela, les entrées s'effaceraient une à une pendant qu'on parcourt la liste, et la
 * ligne visée se déroberait au moment du clic.
 */
let paused = false;

const arm = (id: string) => {
  clearTimeout(timers.get(id));
  if (paused) return;
  timers.set(
    id,
    setTimeout(() => dismissToast(id), LIFETIME),
  );
};

/** La pile s'ouvre : plus rien n'expire tant qu'elle est dépliée. */
export const pauseToastExpiry = (): void => {
  paused = true;
  timers.forEach(clearTimeout);
  timers.clear();
};

/**
 * La pile se referme : chaque alerte repart pour une durée pleine.
 *
 * ⚠️ Le temps déjà écoulé avant l'ouverture est perdu, volontairement : on vient de les
 * relire, les faire disparaître aussitôt après serait le contraire du service rendu.
 */
export const resumeToastExpiry = (): void => {
  paused = false;
  toasts.forEach((t) => arm(t.id));
};

/**
 * Compteur d'identifiants.
 *
 * ⚠️ Un horodatage ne suffit pas : deux messages d'un même envoi arrivent dans la même
 * milliseconde, et deux bandeaux de même identifiant se remplaceraient en silence.
 */
let seq = 0;

/**
 * Empile une alerte.
 *
 * ⚠️ UN BANDEAU PAR MESSAGE, et non un par conversation (première version, corrigée le 11/09
 * après essai). Regrouper par conversation paraissait raisonnable — c'est ce que fait le `tag`
 * des notifications du navigateur — mais la pile n'apparaissait alors JAMAIS en usage normal :
 * il fallait recevoir des messages de plusieurs conversations DIFFÉRENTES dans la même fenêtre
 * de cinq secondes. L'empilement est précisément ce qu'on veut montrer.
 */
export const showToast = (toast: Omit<Toast, 'id'>): void => {
  const next: Toast = { ...toast, id: `${toast.key}-${seq++}` };

  toasts = [next, ...toasts].slice(0, MAX);
  // Les bandeaux évincés emportent leur minuteur, qui parlerait dans le vide.
  for (const [id, timer] of timers) {
    if (!toasts.some((t) => t.id === id)) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }
  arm(next.id);
  emit();
};

export const dismissToast = (id: string): void => {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/**
 * Retire TOUTES les alertes d'une conversation : on vient de l'ouvrir.
 *
 * ⚠️ Toutes et pas une seule — un message par bandeau, il y en a donc autant que de messages
 * reçus pendant qu'on était ailleurs.
 */
export const dismissToastsFor = (key: string): void => {
  const doomed = toasts.filter((t) => t.key === key);
  if (!doomed.length) return;
  doomed.forEach((t) => {
    clearTimeout(timers.get(t.id));
    timers.delete(t.id);
  });
  toasts = toasts.filter((t) => t.key !== key);
  emit();
};

/** Vide tout — déconnexion, changement de compte. */
export const clearToasts = (): void => {
  timers.forEach(clearTimeout);
  timers.clear();
  paused = false;
  if (!toasts.length) return;
  toasts = [];
  emit();
};

export const useToasts = (): Toast[] =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
