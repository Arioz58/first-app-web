'use client';

import { useTranslation } from 'react-i18next';
import { IconChat } from '@/components/icons';

/**
 * Aucune conversation ouverte.
 *
 * ⚠️ `hidden md:flex` : sur un écran étroit, cette colonne serait vide À CÔTÉ de la liste —
 * ou plutôt en dessous, faute de place. On la masque donc, la liste occupant tout l'écran ;
 * elle réapparaît dès que les deux colonnes tiennent.
 */
export default function ChatIndexPage() {
  // ⚠️ `'use client'` : cet écran n'affichait qu'un texte figé, il doit maintenant traduire.
  const { t } = useTranslation();
  return (
    <section className="hidden flex-1 flex-col items-center justify-center md:flex">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-[#1E40AF] dark:bg-blue-900/30">
        <IconChat size={28} />
      </div>
      <p className="mt-4 text-slate-400">{t('list.select_chat')}</p>
    </section>
  );
}
