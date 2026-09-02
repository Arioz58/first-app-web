import { ConversationList } from '@/components/ConversationList';

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
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh bg-slate-50 dark:bg-zinc-950">
      <ConversationList />
      {children}
    </main>
  );
}
