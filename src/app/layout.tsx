import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Nexa Web',
  description: 'Messagerie Nexa dans le navigateur.',
};

/**
 * Applique le thème AVANT la première peinture.
 *
 * ⚠️ Indispensable, et c'est tout le sujet : la page est rendue sur le SERVEUR, qui ne peut
 * pas connaître un choix rangé dans le `localStorage` du navigateur. Sans ce script, une app
 * réglée en sombre s'afficherait en clair le temps que React s'hydrate, puis basculerait —
 * un éclair blanc à chaque chargement. C'est le pendant web de `initTheme()` appelé avant le
 * rendu dans `app/_layout.tsx` du mobile.
 *
 * ⚠️ Il doit rester INLINE et non différé : un `<script src>` serait chargé trop tard, et
 * `defer`/`async` le placeraient après la peinture. Il est court exprès.
 *
 * ⚠️ Enveloppé dans un `try` : en navigation privée stricte, lire `localStorage` LÈVE une
 * exception. Non protégé, le script casserait et rien ne s'afficherait correctement.
 */
const THEME_SCRIPT = `try{var p=localStorage.getItem('nexa.theme');var d=p==='dark'||((!p||p==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // ⚠️ Le script modifie `class` et `style` de <html> avant l'hydratation : React
      // signalerait sinon une divergence avec le balisage rendu par le serveur.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
