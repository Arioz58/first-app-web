'use client';

import { useSyncExternalStore } from 'react';

/**
 * Sons d'interface : envoi et réception d'un message. Pendant web de `lib/sounds.ts` du mobile,
 * avec les MÊMES fichiers — un son qui diffère d'un appareil à l'autre ne s'entend pas comme
 * la même application.
 *
 * Demande du client (15/09) : un son à l'envoi comme sur WhatsApp, un son de notification sur
 * le web qui n'en avait aucun, et de quoi couper les deux.
 *
 * ⚠️ RÉGLAGE LOCAL au navigateur, comme le thème : on peut vouloir le son sur l'ordinateur et
 * le silence sur le téléphone. Il n'a pas à suivre le compte.
 *
 * ⚠️ Les fichiers sont ceux fournis par Berke, et ce sont les MÊMES que sur mobile — un son qui
 * diffère d'un appareil à l'autre ne s'entend pas comme la même application.
 */

const KEY = 'nexa.sounds';

const lire = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    // Navigation privée ou stockage bloqué : le son reste actif pour cette session.
    return true;
  }
};

let actif = lire();
const listeners = new Set<() => void>();

export const setSoundsEnabled = (next: boolean) => {
  if (next === actif) return;
  actif = next;
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // Le choix ne survivra pas au rechargement, mais il s'applique tout de suite.
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * ⚠️ Le hook RENVOIE la valeur qu'il observe, et le rendu SERVEUR répond le défaut : lire
 * `localStorage` là-bas est impossible, et prétendre le contraire ferait diverger l'hydratation.
 */
export const useSoundsEnabled = () => useSyncExternalStore(subscribe, () => actif, () => true);

export const soundsEnabled = () => actif;

/**
 * ⚠️ Éléments créés UNE FOIS et réutilisés : en fabriquer un par message enverrait le
 * navigateur rechercher le fichier à chaque fois, et laisserait derrière lui autant d'objets
 * audio que de messages.
 */
let audioEnvoi: HTMLAudioElement | null = null;
let audioReception: HTMLAudioElement | null = null;

/**
 * Gain de lecture, un par son — mêmes valeurs que sur mobile.
 *
 * ⚠️ BAISSÉ À LA LECTURE et non dans les fichiers : ils sortaient à −4,9 dBFS (envoi) et −3,6
 * (réception), une dizaine de décibels au-dessus d'un son d'interface. Les fichiers restent
 * ceux fournis par Berke, octet pour octet — un MP3 réencodé perd en qualité à chaque passage.
 *
 * ⚠️ DEUX VALEURS : un son REÇU plus fort que celui qu'on déclenche soi-même s'entend comme
 * une alerte. Elles ramènent les deux à environ −13 dBFS, donc au même volume perçu.
 */
const GAIN_ENVOI = 0.39;
const GAIN_RECEPTION = 0.34;

const jouer = (obtenir: () => HTMLAudioElement, gain: number) => {
  if (!actif || typeof window === 'undefined') return;
  try {
    const a = obtenir();
    a.volume = gain;
    /**
     * ⚠️ Remis à zéro avant chaque lecture : un élément déjà joué reste positionné à la FIN,
     * et le second envoi serait muet.
     */
    a.currentTime = 0;
    /**
     * ⚠️ La promesse est avalée. Les navigateurs REFUSENT de jouer un son tant que la page n'a
     * pas reçu d'interaction : au tout premier message reçu sur un onglet qu'on n'a pas encore
     * touché, la lecture est rejetée. Ce n'est pas une erreur à traiter, et surtout pas de
     * quoi interrompre l'arrivée du message.
     */
    void a.play().catch(() => {});
  } catch {
    // Audio indisponible : on passe.
  }
};

export const playSent = () =>
  jouer(() => (audioEnvoi ??= new Audio('/sounds/sent.mp3')), GAIN_ENVOI);

/**
 * ⚠️ À jouer là où le SERVEUR a déjà dit qu'il y avait matière à prévenir (champ `alert`) :
 * jamais à l'émetteur, ni sur une conversation en sourdine, ni sur une demande de message, ni
 * sur les médias suivants d'un album.
 */
export const playReceived = () =>
  jouer(() => (audioReception ??= new Audio('/sounds/received.mp3')), GAIN_RECEPTION);
