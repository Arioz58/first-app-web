'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { IconClose, IconTrash } from '@/components/icons';
import {
  backgroundCss,
  deleteStory,
  fetchStoryViewers,
  isVideoStory,
  markStoryViewed,
  storyAge,
  textStyle,
  type Story,
  type StoryGroup,
  type StoryView,
} from '@/lib/stories';

/**
 * Visionneuse de stories — portage web d'`app/story/[id].tsx`.
 *
 * ⚠️ Le cadre garde le RATIO 9/16 du mobile au lieu d'occuper l'écran : les positions des
 * textes sont normalisées sur ce format, et les étaler sur un cadre 16/9 les déplacerait par
 * rapport à ce que l'auteur a composé sur son téléphone.
 *
 * ⚠️ La progression est pilotée par un `requestAnimationFrame` et non par une transition CSS :
 * il faut pouvoir la GELER au survol prolongé (pause) et reprendre au temps restant, ce
 * qu'une transition ne sait pas faire sans être relancée depuis zéro.
 */

const PHOTO_MS = 5000;

export function StoryViewer({
  groups,
  startGroup,
  meId,
  onClose,
  onViewed,
  onDeleted,
}: {
  groups: StoryGroup[];
  startGroup: number;
  meId: string | null;
  onClose: () => void;
  /** Prévient la barre qu'une story a été vue, pour qu'elle éteigne son anneau. */
  onViewed: (storyId: string) => void;
  /**
   * ⚠️ Prévient la barre d'une SUPPRESSION. Sans cela, la vignette restait affichée tant que
   * la visionneuse n'était pas fermée — on venait pourtant de supprimer la story sous ses
   * propres yeux, et la voir survivre laisse croire que l'action a échoué.
   */
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [viewers, setViewers] = useState<StoryView[] | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** ⚠️ Lu par la boucle d'animation : un state y serait figé à sa valeur de création. */
  const pausedRef = useRef(false);
  const viewSentRef = useRef<Set<string>>(new Set());

  const group = groups[gi];
  const story: Story | undefined = group?.stories[si];
  const isMine = group?.user.id === meId;
  const isVideo = story ? isVideoStory(story) : false;
  /**
   * ⚠️ DÉRIVÉ, jamais stocké : une story « fond coloré » n'a aucun média à charger, elle est
   * prête d'emblée. En faire un état demandait de le poser dans un effet — ce que React 19
   * interdit — pour une valeur que ses deux entrées suffisent à calculer.
   */
  const ready = !story?.mediaUrl || mediaReady;

  /** Story suivante, groupe suivant, ou fermeture — un seul endroit qui décide. */
  const next = useCallback(() => {
    setProgress(0);
    setMediaReady(false);
    setViewers(null);
    if (!group) return onClose();
    if (si + 1 < group.stories.length) return setSi(si + 1);
    if (gi + 1 < groups.length) {
      setGi(gi + 1);
      return setSi(0);
    }
    onClose();
  }, [group, gi, si, groups.length, onClose]);

  const previous = useCallback(() => {
    setProgress(0);
    setMediaReady(false);
    setViewers(null);
    if (si > 0) return setSi(si - 1);
    if (gi > 0) {
      const precedent = gi - 1;
      setGi(precedent);
      return setSi(groups[precedent].stories.length - 1);
    }
  }, [gi, si, groups]);

  // Mesure du cadre : les textes sont positionnés en proportion, il faut sa taille réelle.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Enregistre la vue.
   *
   * ⚠️ Une seule fois par story (`viewSentRef`) et JAMAIS sur les siennes — le serveur refuse
   * l'auto-vue, mais l'appeler quand même ferait une requête perdue à chaque story affichée.
   */
  useEffect(() => {
    if (!story || isMine || !ready || viewSentRef.current.has(story.id)) return;
    viewSentRef.current.add(story.id);
    void markStoryViewed(story.id)
      .then(() => onViewed(story.id))
      .catch(() => {});
  }, [story, isMine, ready, onViewed]);

  /**
   * Barre de progression.
   *
   * ⚠️ Ne démarre qu'une fois le média AFFICHÉ (`ready`). Sinon la barre défile sur une image
   * encore en chargement, et les stories lentes passent avant d'avoir été vues.
   */
  useEffect(() => {
    if (!story || !ready) return;
    const duree = isVideo ? (videoRef.current?.duration || 0) * 1000 || PHOTO_MS : PHOTO_MS;
    let ecoule = 0;
    let dernier = performance.now();
    let raf = 0;
    const pas = (maintenant: number) => {
      const delta = maintenant - dernier;
      dernier = maintenant;
      if (!pausedRef.current) ecoule += delta;
      const p = Math.min(1, ecoule / duree);
      setProgress(p);
      if (p >= 1) return next();
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
  }, [story, ready, isVideo, next]);

  // Pause : le média doit suivre, sinon la vidéo continue derrière une barre figée.
  useEffect(() => {
    pausedRef.current = paused;
    const v = videoRef.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused]);

  // Clavier : flèches et Échap, attendus dans un navigateur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') previous();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, next, previous]);

  // Les viewers sont pré-chargés pour MES stories seulement (le serveur les refuse sinon).
  useEffect(() => {
    if (!story || !isMine) return;
    void fetchStoryViewers(story.id).then(setViewers).catch(() => {});
  }, [story, isMine]);

  if (!group || !story) return null;

  const supprimer = () => {
    void deleteStory(story.id)
      .then(() => {
        onDeleted();
        next();
      })
      .catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <button
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
      >
        <IconClose size={22} />
      </button>

      {/* ⚠️ Ratio 9/16 conservé : c'est le cadre sur lequel les textes ont été composés. */}
      <div
        ref={frameRef}
        className="relative aspect-[9/16] h-full max-h-[92vh] overflow-hidden rounded-xl bg-black"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {/* Barres de progression, une par story du groupe */}
        <div className="absolute left-0 right-0 top-0 z-20 flex gap-1 p-2">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white"
                style={{ width: `${i < si ? 100 : i === si ? progress * 100 : 0}%` }}
              />
            </div>
          ))}
        </div>

        <div className="absolute left-0 right-0 top-4 z-20 flex items-center gap-2 px-3 pt-2">
          <Avatar name={group.user.name} photoUrl={group.user.photoUrl} size={32} />
          <span className="text-sm font-medium text-white">{group.user.name}</span>
          <span className="text-xs text-white/60">{storyAge(story.createdAt)}</span>
          {isMine && (
            <button
              onClick={supprimer}
              aria-label={t('stories.delete')}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
            >
              <IconTrash size={17} />
            </button>
          )}
        </div>

        {/* Média ou fond coloré */}
        {story.mediaUrl ? (
          isVideo ? (
            <video
              ref={videoRef}
              key={story.id}
              src={story.mediaUrl}
              autoPlay
              playsInline
              className="h-full w-full object-contain"
              onLoadedData={() => setMediaReady(true)}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={story.id}
              src={story.mediaUrl}
              alt=""
              className="h-full w-full object-contain"
              onLoad={() => setMediaReady(true)}
              onError={() => setMediaReady(true)}
            />
          )
        ) : (
          <div
            className="h-full w-full"
            style={{ background: backgroundCss(story.background) }}
          />
        )}

        {/* Textes et stickers, positionnés en proportion du cadre */}
        {frame.h > 0 &&
          (story.texts ?? []).map((item, i) => {
            const { wrapper, text } = textStyle(item, frame.h);
            return (
              <div
                key={i}
                className="pointer-events-none absolute"
                style={{
                  /**
                   * ⚠️ Ancré en HAUT À GAUCHE et déplacé par `transform`, jamais par `left`.
                   *
                   * Un élément en `position: absolute` avec `left: 50%` ne dispose plus que
                   * de la moitié DROITE du cadre pour se dessiner : le texte se repliait sur
                   * trois lignes là où il en tient une sur le téléphone, et un texte posé
                   * près du bord droit se serait retrouvé écrasé en colonne. Avec `left: 0`,
                   * la largeur disponible est celle du cadre entier, et `max-width` fait
                   * seule le travail.
                   *
                   * ⚠️ Le `-50%` de la translation se rapporte à la taille de l'ÉLÉMENT :
                   * c'est ce qui place son centre — et non son coin — sur le point voulu,
                   * ce que `normX`/`normY` désignent.
                   */
                  left: 0,
                  top: 0,
                  transform:
                    `translate(calc(${item.normX * frame.w}px - 50%), ` +
                    `calc(${item.normY * frame.h}px - 50%)) ` +
                    `rotate(${item.rotation}rad) scale(${item.scale})`,
                  maxWidth: '80%',
                  ...wrapper,
                }}
              >
                <span style={text}>{item.content}</span>
              </div>
            );
          })}

        {/* Zones de navigation — sous les boutons d'en-tête, au-dessus du média */}
        <button
          onClick={previous}
          aria-label={t('stories.previous')}
          className="absolute bottom-0 left-0 top-16 z-10 w-1/3 cursor-default"
        />
        <button
          onClick={next}
          aria-label={t('stories.next')}
          className="absolute bottom-0 right-0 top-16 z-10 w-2/3 cursor-default"
        />

        {/* « Vu par », sur mes stories uniquement */}
        {isMine && (
          <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
            <p className="text-sm text-white/90">
              {t('stories.seen_by', { count: viewers?.length ?? story.viewCount ?? 0 })}
            </p>
            {viewers && viewers.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {viewers.slice(0, 8).map((v) => (
                  <span key={v.id} className="flex items-center gap-1.5">
                    <Avatar name={v.viewer.name} photoUrl={v.viewer.photoUrl} size={22} />
                    <span className="text-xs text-white/70">{v.viewer.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
