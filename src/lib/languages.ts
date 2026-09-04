/**
 * Constantes de langue, PARTAGÉES entre le serveur et le client.
 *
 * ⚠️ Ce fichier n'est PAS marqué `'use client'`, et c'est tout son objet. Le layout racine
 * est un composant serveur : importer ces valeurs depuis `lib/i18n.ts`, qui l'est, faisait
 * passer ses exports par la frontière client — `LANGUAGES` y arrivait comme une référence
 * opaque, et `LANGUAGES.some` levait « is not a function » au rendu serveur.
 */

export const LANGUAGES = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
] as const;

export type Language = (typeof LANGUAGES)[number]['code'];

export const LANG_COOKIE = 'nexa.lang';

/** Marché principal de la V1 — comme le repli du sélecteur de pays. */
export const FALLBACK_LANGUAGE: Language = 'tr';

export const isLanguage = (v: string | undefined | null): v is Language =>
  !!v && LANGUAGES.some((l) => l.code === v);
