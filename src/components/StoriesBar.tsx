'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { StoryViewer } from '@/components/StoryViewer';
import { fetchMyStories, fetchStories, type StoryGroup } from '@/lib/stories';

/**
 * Barre de stories — portage web de `components/StoriesBar.tsx`.
 *
 * ⚠️ Mes propres stories arrivent par une AUTRE route (`/stories/me`) : `GET /stories` ne
 * renvoie que celles des amis, jamais les siennes. Les deux sont fusionnées ici pour que
 * « Ma story » ouvre la même visionneuse que les autres.
 */
export function StoriesBar({ me }: { me: { id: string; name: string; photoUrl: string | null } | null }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [ouvert, setOuvert] = useState<number | null>(null);

  /**
   * ⚠️ Chaîne de promesses plutôt qu'`async`/`await` : le `setState` vit dans un `.then`,
   * donc après le rendu. Écrit en `async`, il est signalé comme un `setState` synchrone dans
   * un effet — ce que React 19 interdit. Même forme que `loadBlocked` du panneau profil.
   *
   * ⚠️ `allSettled` : les stories des amis doivent s'afficher même si `/stories/me` échoue,
   * et réciproquement. Un `all` ferait disparaître toute la barre pour une seule requête en
   * défaut.
   */
  const charger = useCallback(
    () =>
      Promise.allSettled([fetchStories(), fetchMyStories()]).then(([amis, miennes]) => {
        const desAmis = amis.status === 'fulfilled' ? amis.value : [];
        const aMoi = miennes.status === 'fulfilled' ? miennes.value : [];
        setGroups(
          me && aMoi.length
            ? // ⚠️ Les miennes EN TÊTE : convention de toutes les messageries, et « Ma story »
              // est le premier repère qu'on cherche.
              [{ user: me, stories: aMoi, hasUnviewed: false }, ...desAmis]
            : desAmis,
        );
      }),
    [me],
  );

  useEffect(() => {
    void charger().catch(() => {});
  }, [charger]);

  /**
   * Éteint l'anneau d'un groupe dès que toutes ses stories ont été vues.
   *
   * ⚠️ Mis à jour localement plutôt que par un rechargement : le serveur a bien enregistré la
   * vue, mais recharger toute la barre à chaque story affichée ferait clignoter les vignettes
   * pendant qu'on regarde.
   */
  const marquerVue = useCallback((storyId: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (!g.stories.some((s) => s.id === storyId)) return g;
        const stories = g.stories.map((s) => (s.id === storyId ? { ...s, viewed: true } : s));
        return { ...g, stories, hasUnviewed: stories.some((s) => !s.viewed) };
      }),
    );
  }, []);

  if (!groups.length) return null;

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3">
        {groups.map((g, i) => {
          const estMoi = g.user.id === me?.id;
          return (
            <button
              key={g.user.id}
              onClick={() => setOuvert(i)}
              className="flex w-16 shrink-0 flex-col items-center gap-1"
            >
              {/*
                Anneau dégradé si le groupe a du non-vu, gris sinon — même code visuel que le
                mobile. Le dégradé est porté par un conteneur en padding : c'est ce qui laisse
                l'avatar rond au centre sans le déformer.
              */}
              <span
                className="rounded-full p-[2.5px]"
                style={{
                  background: g.hasUnviewed
                    ? 'linear-gradient(135deg, #60A5FA, #1E40AF, #1E3A8A)'
                    : '#D1D5DB',
                }}
              >
                <span className="block rounded-full bg-white p-[2px] dark:bg-zinc-900">
                  <Avatar name={g.user.name} photoUrl={g.user.photoUrl} size={48} />
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px] text-slate-600 dark:text-zinc-400">
                {estMoi ? t('stories.mine') : g.user.name}
              </span>
            </button>
          );
        })}
      </div>

      {ouvert !== null && (
        <StoryViewer
          groups={groups}
          startGroup={ouvert}
          meId={me?.id ?? null}
          onClose={() => {
            setOuvert(null);
            // Rechargement à la fermeture : une story a pu être supprimée ou expirer.
            void charger().catch(() => {});
          }}
          onViewed={marquerVue}
          onDeleted={() => void charger().catch(() => {})}
        />
      )}
    </>
  );
}
