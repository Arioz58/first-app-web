'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { StoryViewer } from '@/components/StoryViewer';
import { StoryComposer } from '@/components/StoryComposer';
import { IconPlus } from '@/components/icons';
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
  const [composeur, setComposeur] = useState(false);

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

  /**
   * ⚠️ Plus de `return null` quand il n'y a aucune story : la tuile « Ma story » est le SEUL
   * point d'entrée pour en publier une. La masquer faute de contenu rendait la création
   * inatteignable — précisément pour qui n'en a encore jamais posté.
   */
  const jaiUneStory = groups.some((g) => g.user.id === me?.id);

  return (
    <>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3">
        {/* Tuile de création, affichée seulement quand je n'ai pas encore de story — sinon
            c'est le « + » posé sur ma propre vignette qui joue ce rôle. */}
        {!jaiUneStory && (
          <button
            onClick={() => setComposeur(true)}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span className="rounded-full p-[2.5px]" style={{ background: '#D1D5DB' }}>
              <span className="block rounded-full bg-white p-[2px] dark:bg-zinc-900">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#1E40AF] dark:bg-zinc-800">
                  <IconPlus size={22} />
                </span>
              </span>
            </span>
            <span className="w-full truncate text-center text-[11px] text-slate-600 dark:text-zinc-400">
              {t('stories.mine')}
            </span>
          </button>
        )}

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
              <span className="relative">
                <span
                  className="block rounded-full p-[2.5px]"
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
                {/*
                  ⚠️ Un « + » DANS le coin de ma vignette, comme sur mobile : le tap sur
                  l'avatar reste « visionner ma story », et ce badge sert à en ajouter une
                  autre. Sans lui, avoir déjà une story rendait la publication impossible.

                  ⚠️ `<span role="button">` et non `<button>` : il est imbriqué dans le bouton
                  de la vignette, et un bouton dans un bouton est du HTML invalide que les
                  navigateurs réparent en les séparant — le clic devenait imprévisible.
                */}
                {estMoi && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('stories.add')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setComposeur(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        setComposeur(true);
                      }
                    }}
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#1E40AF] text-white dark:border-zinc-900"
                  >
                    <IconPlus size={12} />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[11px] text-slate-600 dark:text-zinc-400">
                {estMoi ? t('stories.mine') : g.user.name}
              </span>
            </button>
          );
        })}
      </div>

      {composeur && (
        <StoryComposer
          onClose={() => setComposeur(false)}
          onPublished={() => void charger().catch(() => {})}
        />
      )}

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
