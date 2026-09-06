'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { IconPlus } from '@/components/icons';
import { StoryComposer } from '@/components/StoryComposer';
import { StoryViewer } from '@/components/StoryViewer';
import { listItem, morph, snappy, staggeredList } from '@/lib/motion';
import { fetchMyStories, fetchStories, storyAge, type StoryGroup } from '@/lib/stories';

/**
 * Page Stories — remplace la bande horizontale posée en tête de la liste des conversations.
 *
 * ⚠️ En bande, les stories occupaient une place fixe en haut d'un écran qui sert à autre
 * chose, et disparaissaient dès qu'un filtre ou une recherche était actif. En destination, on
 * y va quand on veut les voir, et elles ne coûtent rien au reste du temps.
 *
 * ⚠️ Mes propres stories arrivent par une AUTRE route (`/stories/me`) : `GET /stories` ne
 * renvoie que celles des amis, jamais les siennes.
 */
export function StoriesPage({
  me,
}: {
  me: { id: string; name: string; photoUrl: string | null } | null;
}) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [composeur, setComposeur] = useState(false);

  /** ⚠️ Chaîne de promesses : le `setState` vit dans un `.then`, donc après le rendu. */
  const charger = useCallback(
    () =>
      Promise.allSettled([fetchStories(), fetchMyStories()]).then(([amis, miennes]) => {
        const desAmis = amis.status === 'fulfilled' ? amis.value : [];
        const aMoi = miennes.status === 'fulfilled' ? miennes.value : [];
        setGroups(
          me && aMoi.length
            ? [{ user: me, stories: aMoi, hasUnviewed: false }, ...desAmis]
            : desAmis,
        );
      }),
    [me],
  );

  useEffect(() => {
    void charger().catch(() => {});
  }, [charger]);

  const marquerVue = useCallback((storyId: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (!g.stories.some((s) => s.id === storyId)) return g;
        const stories = g.stories.map((s) => (s.id === storyId ? { ...s, viewed: true } : s));
        return { ...g, stories, hasUnviewed: stories.some((s) => !s.viewed) };
      }),
    );
  }, []);

  const jaiUneStory = groups.some((g) => g.user.id === me?.id);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="px-4 py-4">
        <h1 className="text-2xl font-bold text-[#1E40AF] dark:text-blue-400">{t('nav.stories')}</h1>
      </header>

      <motion.ul
        variants={staggeredList(groups.length + 1)}
        initial="hidden"
        animate="show"
        className="px-2 pb-4"
      >
        {/* Publier : en tête quand je n'ai pas encore de story, sinon c'est le « + » posé sur
            ma propre vignette qui joue ce rôle. */}
        {!jaiUneStory && (
          <motion.li variants={listItem}>
            <motion.button
              whileTap={{ scale: 0.98 }}
              transition={snappy}
              onClick={() => setComposeur(true)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#1E40AF] dark:bg-zinc-800">
                <IconPlus size={22} />
              </span>
              <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">
                {t('stories.add')}
              </span>
            </motion.button>
          </motion.li>
        )}

        {groups.map((g, i) => {
          const estMoi = g.user.id === me?.id;
          const derniere = g.stories[g.stories.length - 1];
          return (
            <motion.li key={g.user.id} variants={listItem}>
              <motion.button
                whileTap={{ scale: 0.98 }}
                transition={snappy}
                onClick={() => setOuvert(i)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <span className="relative shrink-0">
                  {/* Même `layoutId` que la visionneuse : la pastille S'OUVRE en story. */}
                  <motion.span
                    layoutId={`story-${g.user.id}`}
                    transition={morph}
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
                  </motion.span>
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

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">
                    {estMoi ? t('stories.mine') : g.user.name}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {t('stories.count', { count: g.stories.length })} ·{' '}
                    {storyAge(derniere.createdAt)}
                  </span>
                </span>
              </motion.button>
            </motion.li>
          );
        })}
      </motion.ul>

      {groups.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-slate-400">{t('stories.empty')}</p>
      )}

      {composeur && (
        <StoryComposer
          onClose={() => setComposeur(false)}
          onPublished={() => void charger().catch(() => {})}
        />
      )}

      <AnimatePresence>
        {ouvert !== null && (
          <StoryViewer
            groups={groups}
            startGroup={ouvert}
            meId={me?.id ?? null}
            onClose={() => {
              setOuvert(null);
              void charger().catch(() => {});
            }}
            onViewed={marquerVue}
            onDeleted={() => void charger().catch(() => {})}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
