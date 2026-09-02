'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { hasSession, logout } from '@/lib/auth';
import { setSessionExpiredHandler } from '@/lib/api';

type Me = { id: string; name: string; phone: string; photoUrl: string | null };

/**
 * Coquille de la messagerie — pour l'instant, une preuve que la chaîne complète fonctionne :
 * session ouverte, jeton envoyé, réponse authentifiée du backend.
 */
export default function ChatPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setSessionExpiredHandler(() => router.replace('/login'));
    if (!hasSession()) {
      router.replace('/login');
      return;
    }
    apiRequest<Me>('/users/me')
      .then(setMe)
      .catch((e) => setError(e.message));
  }, [router]);

  return (
    <main className="min-h-dvh bg-slate-50 p-8 dark:bg-zinc-950">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow dark:bg-zinc-900">
        <h1 className="text-2xl font-bold text-[#1E40AF] dark:text-blue-400">Nexa Web</h1>
        {me ? (
          <p className="mt-3 text-slate-700 dark:text-zinc-200">
            Connecté en tant que <strong>{me.name}</strong> ({me.phone})
          </p>
        ) : error ? (
          <p className="mt-3 text-red-500">{error}</p>
        ) : (
          <p className="mt-3 text-slate-400">Chargement…</p>
        )}
        <button
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="mt-6 rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200"
        >
          Se déconnecter
        </button>
      </div>
    </main>
  );
}
