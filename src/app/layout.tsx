import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/components/I18nProvider';
// ⚠️ Depuis `lib/languages` et non `lib/i18n` : ce layout est un composant SERVEUR, et
// `lib/i18n` est marqué `'use client'`.
import {
  LANG_COOKIE,
  THEME_COOKIE,
  isLanguage,
  isThemeChoice,
  type Language,
} from '@/lib/languages';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Nexa Web',
  description: 'Messagerie Nexa dans le navigateur.',
};

/**
 * Le thème est décidé par le SERVEUR, à partir d'un cookie.
 *
 * ⚠️ Il y avait ici un script inline qui lisait `localStorage` avant la première peinture.
 * Rendu dans l'arbre React, il était recréé à l'hydratation — ce que React signale par
 * « Encountered a script tag while rendering React component » — et le résultat était pire
 * qu'un avertissement : à chaque rechargement, la classe `dark` ET `color-scheme` étaient
 * effacées, donc le thème sombre perdu. Constaté au test : préférence `dark` en stockage,
 * script exécuté une fois, et `colorScheme` vidé après le F5.
 *
 * ⚠️ Un cookie et non `localStorage` : le serveur ne peut pas lire le stockage du navigateur,
 * et c'est toute la raison pour laquelle un script était nécessaire. En cookie, le serveur
 * rend directement la bonne classe — plus de script, plus de divergence à corriger, et
 * toujours aucun éclair blanc. Même mécanisme que la langue, juste au-dessus.
 *
 * ⚠️ La préférence « système » — le défaut — ne pose AUCUNE classe : le serveur ignore le
 * réglage de l'appareil. C'est `globals.css` qui tranche alors, par `prefers-color-scheme`.
 */

/**
 * ⚠️ Layout ASYNCHRONE pour lire le cookie de langue. C'est le seul endroit qui puisse le
 * faire : un composant client n'a accès qu'à `document.cookie`, donc trop tard — le serveur
 * aurait déjà rendu la page dans une autre langue, et React signalerait la divergence.
 */
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const jar = await cookies();
  const cookie = jar.get(LANG_COOKIE)?.value;
  const lang: Language = isLanguage(cookie) ? cookie : 'tr';

  const choix = jar.get(THEME_COOKIE)?.value;
  const theme = isThemeChoice(choix) ? choix : null;

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ${theme ?? ''}`}
      /**
       * ⚠️ `color-scheme` est posé EN PLUS de la classe : c'est lui qui fait suivre ce que le
       * navigateur dessine lui-même — ascenseurs, champs, sélecteurs natifs. Sans lui, une
       * app en sombre garde des ascenseurs blancs. En préférence « système », on le laisse
       * au navigateur (`light dark`), qui sait déjà quoi faire.
       */
      style={{ colorScheme: theme ?? 'light dark' }}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider lang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
