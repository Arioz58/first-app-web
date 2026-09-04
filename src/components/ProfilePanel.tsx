'use client';

import { useCallback, useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import {
  IconBack,
  IconBlock,
  IconChevron,
  IconDark,
  IconLeave,
  IconLight,
  IconSystem,
} from '@/components/icons';
import { logout } from '@/lib/auth';
import { fetchBlocked, unblockUser } from '@/lib/messages';
import { type Me } from '@/lib/messages';
import { disconnectSocket } from '@/lib/socket';
import { setThemePref, THEME_OPTIONS, useThemePref, type ThemePref } from '@/lib/theme';

const THEME_ICON: Record<ThemePref, typeof IconLight> = {
  light: IconLight,
  dark: IconDark,
  system: IconSystem,
};

/**
 * « Vous » — pendant web de l'onglet Profil du mobile.
 *
 * ⚠️ Il RECOUVRE la colonne de la liste au lieu d'ouvrir un écran à part : la conversation
 * ouverte reste visible à droite, et revenir à la liste ne la ferme pas. Un onglet comme sur
 * mobile n'a pas de sens ici, où les deux colonnes coexistent.
 *
 * ⚠️ Périmètre volontairement réduit à ce qui a du sens dans un navigateur : apparence et
 * déconnexion. L'édition du nom, de la photo, de la bio, la langue et la confidentialité
 * restent sur le mobile — les porter demanderait de dupliquer des écrans entiers pour un
 * client qui n'est pas l'appareil principal.
 */
export function ProfilePanel({
  /** ⚠️ Fourni par la liste, qui l'a déjà chargé pour sa vignette — pas de seconde requête. */
  me,
  onClose,
}: {
  me: Me | null;
  onClose: () => void;
}) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blocked, setBlocked] = useState<{ id: string; name: string; photoUrl: string | null }[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * ⚠️ Chargée DÈS L'OUVERTURE du profil, pas à l'entrée dans la sous-vue : c'est le compte
   * affiché à côté de l'entrée qui dit s'il y a quelqu'un à débloquer, avant d'aller voir.
   *
   * ⚠️ Chaîne de promesses : les `setState` vivent dans un `.then`, donc après le rendu —
   * React 19 refuse le `setState` synchrone dans un effet.
   */
  const loadBlocked = useCallback(() => fetchBlocked().then(setBlocked).catch(() => {}), []);
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked]);

  const pref = useThemePref();
  const router = useRouter();

  /**
   * ⚠️ Sous-vue plutôt qu'une section dépliante : la liste peut être longue, et la mêler aux
   * réglages ferait glisser le bouton de déconnexion loin sous elle. Même schéma que la
   * galerie de médias du panneau de détails.
   */
  if (blockedOpen) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
          <button
            onClick={() => setBlockedOpen(false)}
            aria-label="Retour au profil"
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <IconBack size={20} />
          </button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
            Utilisateurs bloques
          </h1>
        </header>

        <p className="px-4 py-3 text-sm text-slate-400">
          Ces personnes ne peuvent pas vous ecrire ni voir votre profil. Elles n&rsquo;en sont
          pas informees.
        </p>

        <div className="flex-1 overflow-y-auto">
          {blocked.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">
              Vous n&rsquo;avez bloque personne.
            </p>
          ) : (
            <ul>
              {blocked.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={u.name} photoUrl={u.photoUrl} size={40} />
                  <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-zinc-100">
                    {u.name}
                  </span>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setBusy(u.id);
                      void unblockUser(u.id)
                        .then(loadBlocked)
                        .catch(() => {})
                        .finally(() => setBusy(null));
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#1E40AF] hover:bg-slate-100 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-zinc-800"
                  >
                    Debloquer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          aria-label="Retour aux discussions"
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Vous</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-6 py-8">
          {/* Squelette tant que la requête n'a pas répondu, pour que la mise en page ne saute pas. */}
          {me ? (
            <>
              <Avatar name={me.name} photoUrl={me.photoUrl} size={96} />
              <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-zinc-100">
                {me.name}
              </h2>
              {me.profile?.bio && (
                <p className="mt-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                  {me.profile.bio}
                </p>
              )}
              <p className="mt-1 text-sm text-slate-400">{me.phone}</p>
            </>
          ) : (
            <>
              <div className="h-24 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-zinc-800" />
              <div className="mt-4 h-5 w-32 animate-pulse rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="mt-2 h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-zinc-800" />
            </>
          )}
        </div>

        <section className="border-t border-slate-100 px-4 py-4 dark:border-zinc-800">
          <h3 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Apparence
          </h3>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((o) => {
              const Icon = THEME_ICON[o.value];
              const on = pref === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setThemePref(o.value)}
                  aria-pressed={on}
                  className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 text-xs transition ${
                    on
                      ? 'border-[#1E40AF] bg-blue-50 font-semibold text-[#1E40AF] dark:bg-blue-900/30'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon size={18} />
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="px-2 pt-2 text-xs text-slate-400">
            «&nbsp;Système&nbsp;» suit le réglage de votre ordinateur, et le suit encore s&rsquo;il
            change.
          </p>
        </section>

        <section className="border-t border-slate-100 px-4 py-4 dark:border-zinc-800">
          {/* ⚠️ Bloquer était possible depuis les détails d'une conversation, débloquer non :
              une fois quelqu'un bloqué, plus rien sur le web ne permettait de revenir en
              arrière. */}
          <button
            onClick={() => setBlockedOpen(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <IconBlock size={16} />
            Utilisateurs bloques
            <span className="ml-auto flex items-center gap-1 text-slate-400">
              {blocked.length > 0 && blocked.length}
              <IconChevron size={16} />
            </span>
          </button>

          <button
            onClick={() => {
              /**
               * ⚠️ Le socket porte le jeton dans son handshake : le laisser ouvert
               * maintiendrait la connexion au nom du compte qu'on vient de quitter.
               * Il est donc fermé AVANT d'effacer la session.
               */
              disconnectSocket();
              logout();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <IconLeave size={16} />
            Déconnexion
          </button>
        </section>
      </div>
    </div>
  );
}
