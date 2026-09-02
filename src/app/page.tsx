'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasSession } from '@/lib/auth';

/**
 * Racine : aiguillage selon la session.
 *
 * ⚠️ Décision côté CLIENT et non dans un middleware serveur : les jetons vivent dans
 * `localStorage`, que le serveur ne voit pas. Un middleware ne pourrait rien en dire, et
 * rediriger depuis le serveur exigerait des cookies — donc la seconde mécanique
 * d'authentification écartée dans `lib/storage.ts`.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasSession() ? '/chat' : '/login');
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 dark:bg-zinc-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#1E40AF]" />
    </main>
  );
}
