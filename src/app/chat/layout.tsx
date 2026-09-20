import { cookies } from 'next/headers';

import { ConversationList } from '@/components/ConversationList';
import { ToastStack } from '@/components/ToastStack';
import { PANEL_COOKIE } from '@/lib/languages';

/**
 * Disposition deux colonnes de la messagerie, façon WhatsApp Web.
 *
 * ⚠️ La liste vit ICI et non dans une page : Next.js conserve les layouts entre les
 * navigations, donc passer d'une conversation à l'autre ne la démonte pas. Elle garde son
 * défilement, ses filtres et sa recherche — et son écouteur socket n'est pas détaché puis
 * rattaché à chaque clic.
 *
 * ⚠️ Sur mobile (moins de 768 px), les deux colonnes ne tiennent pas côte à côte : la liste
 * occupe tout l'écran sur `/chat`, et la conversation tout l'écran sur `/chat/<id>`. C'est
 * `page.tsx` et `[id]/page.tsx` qui portent ces bascules, via `hidden md:flex`.
 *
 * ⚠️ Layout ASYNCHRONE pour lire le cookie du panneau replié : c'est le seul endroit qui
 * puisse le faire avant le premier rendu. Un composant client n'a accès qu'à
 * `document.cookie`, donc trop tard — la page serait peinte panneau ouvert et celui-ci se
 * refermerait sous les yeux à l'hydratation. Même raison que la langue et le thème.
 */
export default async function ChatLayout({ children }: LayoutProps<'/chat'>) {
  const jar = await cookies();
  const replie = jar.get(PANEL_COOKIE)?.value === '1';

  return (
    <main className="flex h-dvh bg-slate-50 dark:bg-zinc-950">
      <ConversationList initialCollapsed={replie} />
      {children}
      {/* ⚠️ Ici et non dans une page : le layout survit aux navigations, donc un bandeau
          reste lisible quand on passe d'une conversation à l'autre — et c'est justement
          quand on change d'écran qu'il a quelque chose à dire. */}
      <ToastStack />
    </main>
  );
}
