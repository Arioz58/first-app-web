'use client';

import i18n from 'i18next';
import {
  FALLBACK_LANGUAGE,
  isLanguage as isLang,
  LANG_COOKIE as COOKIE,
  type Language as Lang,
} from './languages';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import tr from '@/locales/tr.json';

/**
 * Traductions du client web — turc, français, anglais, comme le mobile.
 *
 * ⚠️ La langue est stockée en COOKIE et non en `localStorage`. Le layout racine est un
 * composant SERVEUR : il peut lire un cookie, pas le stockage du navigateur. Sans cela, le
 * serveur rendrait la page dans la langue par défaut et le client la rerendrait dans la
 * bonne — divergence d'hydratation, et un clignotement de toute l'interface à chaque
 * chargement. Même problème que le thème, autre solution : le thème n'est qu'une classe,
 * qu'un script en ligne peut poser ; du texte, non.
 *
 * ⚠️ Les fichiers sont PROPRES AU WEB et ne reprennent pas les ~1000 clés du mobile : les
 * stories, la caméra ou la position en direct n'existent pas ici, et les embarquer
 * alourdirait le bundle pour rien. Les libellés COMMUNS gardent en revanche le nom de clé et
 * la formulation du mobile, pour que les deux clients disent la même chose.
 */

/**
 * ⚠️ Ré-exportés depuis `lib/languages.ts`, qui n'est PAS un module client : le layout racine
 * en a besoin côté serveur. Voir l'en-tête de ce fichier-là.
 */
export { LANGUAGES, LANG_COOKIE, isLanguage } from './languages';
export type { Language } from './languages';

const FALLBACK = FALLBACK_LANGUAGE;

/** Lit le cookie côté navigateur. Le serveur, lui, le lit via `next/headers`. */
export const readLangCookie = (): Lang | null => {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`));
  return isLang(m?.[1]) ? (m![1] as Lang) : null;
};

/**
 * Langue à utiliser au tout premier passage : celle du navigateur si on la parle.
 *
 * ⚠️ `navigator.languages` et pas seulement `language` : un navigateur réglé en allemand
 * peut avoir le turc en seconde préférence, et c'est un meilleur choix que le repli.
 */
export const detectLanguage = (): Lang => {
  const stored = readLangCookie();
  if (stored) return stored;
  if (typeof navigator === 'undefined') return FALLBACK;
  for (const tag of [navigator.language, ...(navigator.languages ?? [])]) {
    const code = tag?.split('-')[0]?.toLowerCase();
    if (isLang(code)) return code;
  }
  return FALLBACK;
};

export const setLanguage = (lang: Lang) => {
  // ⚠️ `SameSite=Lax` et un an : c'est une préférence d'affichage, pas une donnée de session.
  document.cookie = `${COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
};

/**
 * ⚠️ Initialisé une seule fois, y compris au rendu serveur : `i18next` est un singleton de
 * module, et le réinitialiser à chaque rendu perdrait la langue en cours.
 */
export const initI18n = (lang: Lang) => {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { tr: { translation: tr }, fr: { translation: fr }, en: { translation: en } },
      lng: lang,
      fallbackLng: FALLBACK,
      interpolation: { escapeValue: false },
      // React échappe déjà, et `Suspense` n'a rien à attendre : tout est embarqué.
      react: { useSuspense: false },
    });
  } else if (i18n.language !== lang) {
    void i18n.changeLanguage(lang);
  }
  return i18n;
};

export default i18n;
