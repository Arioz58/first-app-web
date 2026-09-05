'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { backdrop, dialog } from '@/lib/motion';
import { useTranslation } from 'react-i18next';

import CameraCapture from '@/components/CameraCapture';
import { IconCamera, IconClose, IconPhoto, IconSpinner, IconText } from '@/components/icons';
import {
  backgroundCss,
  createStory,
  STORY_BACKGROUNDS,
  STORY_COLORS,
  textStyle,
  type StoryTextItem,
} from '@/lib/stories';
import { ACCEPT, uploadFile } from '@/lib/upload';

/**
 * Composition d'une story — pendant web (volontairement réduit) d'`app/story/create.tsx`.
 *
 * ⚠️ PÉRIMÈTRE ASSUMÉ : une source (photo/vidéo, webcam ou fond coloré) et UN texte,
 * déplaçable. L'éditeur mobile fait bien plus — textes multiples, pincement, rotation,
 * stickers, rognage vidéo, guides d'alignement — et le porter reviendrait à réécrire un
 * éditeur gestuel pour un client qui n'est pas l'appareil de capture. Les stories composées
 * sur téléphone restent affichées intégralement ici : c'est la CRÉATION qui est simplifiée,
 * pas la lecture.
 *
 * ⚠️ L'aperçu utilise `textStyle()`, la même fonction que la visionneuse. Redéfinir un style
 * « à peu près pareil » pour l'éditeur ferait diverger ce qu'on compose de ce qu'on publie.
 */

type Source =
  | { kind: 'none' }
  | { kind: 'media'; file: File; url: string; isVideo: boolean }
  | { kind: 'background'; id: string };

const DEFAULT_TEXT: Omit<StoryTextItem, 'content'> = {
  kind: 'text',
  normX: 0.5,
  normY: 0.5,
  scale: 1,
  rotation: 0,
  color: '#FFFFFF',
  bgMode: 'translucent',
  bold: true,
  italic: false,
  underline: false,
};

export function StoryComposer({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>({ kind: 'none' });
  const [cameraOuverte, setCameraOuverte] = useState(false);
  const [texte, setTexte] = useState('');
  const [style, setStyle] = useState(DEFAULT_TEXT);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [source.kind]);

  /**
   * ⚠️ L'URL d'objet est révoquée au changement de source ET au démontage : chaque
   * `createObjectURL` retient son fichier en mémoire jusqu'à révocation, et choisir cinq
   * vidéos d'affilée les garderait toutes.
   */
  useEffect(() => {
    if (source.kind !== 'media') return;
    const url = source.url;
    return () => URL.revokeObjectURL(url);
  }, [source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !envoi) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, envoi]);

  const choisirFichier = useCallback((file: File) => {
    setSource({
      kind: 'media',
      file,
      url: URL.createObjectURL(file),
      isVideo: file.type.startsWith('video/'),
    });
  }, []);

  /**
   * Déplacement du texte à la souris.
   *
   * ⚠️ Les coordonnées sont enregistrées NORMALISÉES (0..1) et non en pixels : c'est le
   * contrat partagé avec le mobile, et c'est ce qui permet à la story de s'afficher au bon
   * endroit sur un écran de téléphone comme dans un navigateur.
   */
  const deplacer = useCallback((e: React.PointerEvent) => {
    const el = frameRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const bouger = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setStyle((s) => ({
        ...s,
        // Bornés : un texte lâché hors du cadre serait invisible et irrécupérable.
        normX: Math.min(0.95, Math.max(0.05, (ev.clientX - r.left) / r.width)),
        normY: Math.min(0.95, Math.max(0.05, (ev.clientY - r.top) / r.height)),
      }));
    };
    const finir = () => {
      document.removeEventListener('pointermove', bouger);
      document.removeEventListener('pointerup', finir);
    };
    document.addEventListener('pointermove', bouger);
    document.addEventListener('pointerup', finir);
  }, []);

  const publier = useCallback(() => {
    if (source.kind === 'none') return;
    setEnvoi(true);
    setErreur('');
    const texts: StoryTextItem[] = texte.trim() ? [{ ...style, content: texte.trim() }] : [];

    void (async () => {
      try {
        if (source.kind === 'media') {
          // ⚠️ `folder: 'stories'` : le serveur range les médias par usage, et une story
          // déposée dans le dossier du chat resterait introuvable côté ménage.
          const mediaUrl = await uploadFile(source.file, 'stories');
          await createStory({ mediaUrl, texts });
        } else {
          // Story « fond coloré » : aucun téléversement, on ne publie que l'ID du preset.
          await createStory({ background: source.id, texts });
        }
        onPublished();
        onClose();
      } catch {
        setErreur(t('stories.publish_failed'));
        setEnvoi(false);
      }
    })();
  }, [source, texte, style, onPublished, onClose, t]);

  const apercuTexte = texte.trim() || t('stories.text_placeholder');
  const rendu = frame.h > 0 ? textStyle({ ...style, content: apercuTexte }, frame.h) : null;

  return (
    <motion.div
      variants={backdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-black/90 p-4"
    >
      <div className="mb-3 flex w-full max-w-md items-center justify-between">
        <span className="text-sm font-medium text-white">{t('stories.compose')}</span>
        <button
          type="button"
          onClick={onClose}
          disabled={envoi}
          aria-label={t('common.close')}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          <IconClose size={20} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT.images}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) choisirFichier(f);
          // ⚠️ Remis à zéro : sans cela, rechoisir le MÊME fichier ne déclenche pas `onChange`.
          e.target.value = '';
        }}
      />

      {source.kind === 'none' ? (
        /*
          Choix de la source — trois entrées, comme le mobile.

          ⚠️ Écrites une par une plutôt que produites par un `map` sur un tableau construit
          au rendu : ce tableau contenait un accès à `fileRef`, que React signale comme une
          lecture de ref pendant le rendu. Trois boutons distincts se lisent mieux qu'une
          boucle de trois éléments, de toute façon.
        */
        <motion.div
          variants={dialog}
          className="flex w-full max-w-md flex-col gap-2 rounded-2xl bg-zinc-900 p-4"
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-white hover:bg-white/10"
          >
            <IconPhoto size={20} className="text-white/70" />
            {t('stories.from_gallery')}
          </button>
          <button
            type="button"
            onClick={() => setCameraOuverte(true)}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-white hover:bg-white/10"
          >
            <IconCamera size={20} className="text-white/70" />
            {t('stories.from_camera')}
          </button>
          <button
            type="button"
            onClick={() => setSource({ kind: 'background', id: STORY_BACKGROUNDS[1].id })}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-white hover:bg-white/10"
          >
            <IconText size={20} className="text-white/70" />
            {t('stories.text_only')}
          </button>
        </motion.div>
      ) : (
        <>
          {/* ⚠️ Même cadre 9/16 que la visionneuse : ce qu'on compose ici doit être
              exactement ce qui sera affiché, positions des textes comprises. */}
          <div
            ref={frameRef}
            /*
              ⚠️ HAUTEUR EXPLICITE. `aspect-[9/16]` ne fabrique pas de dimension : il impose
              un rapport entre deux côtés dont au moins un doit être connu. Avec un simple
              `max-h`, le cadre mesurait 0 × 0 — l'image ne s'affichait pas et les textes,
              positionnés en proportion de sa hauteur, ne se rendaient pas du tout.
            */
            className="relative h-[58vh] aspect-[9/16] shrink-0 overflow-hidden rounded-xl bg-black"
          >
            {source.kind === 'media' ? (
              source.isVideo ? (
                <video src={source.url} autoPlay loop muted playsInline className="h-full w-full object-contain" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={source.url} alt="" className="h-full w-full object-contain" />
              )
            ) : (
              <div className="h-full w-full" style={{ background: backgroundCss(source.id) }} />
            )}

            {rendu && (
              <div
                onPointerDown={deplacer}
                className="absolute cursor-move select-none"
                style={{
                  left: 0,
                  top: 0,
                  transform:
                    `translate(calc(${style.normX * frame.w}px - 50%), ` +
                    `calc(${style.normY * frame.h}px - 50%))`,
                  maxWidth: '80%',
                  ...rendu.wrapper,
                }}
              >
                <span style={{ ...rendu.text, opacity: texte.trim() ? 1 : 0.5 }}>{apercuTexte}</span>
              </div>
            )}
          </div>

          {/* Réglages */}
          <div className="mt-3 flex w-full max-w-md flex-col gap-3">
            <input
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder={t('stories.text_placeholder')}
              maxLength={200}
              className="w-full rounded-xl bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {STORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setStyle((s) => ({ ...s, color: c }))}
                  className={`h-6 w-6 rounded-full ring-2 ${
                    style.color === c ? 'ring-white' : 'ring-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(['none', 'translucent', 'solid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStyle((s) => ({ ...s, bgMode: mode }))}
                  className={`rounded-lg px-2.5 py-1 text-xs ${
                    style.bgMode === mode ? 'bg-white text-zinc-900' : 'bg-zinc-800 text-white/80'
                  }`}
                >
                  {t(`stories.bg_${mode}`)}
                </button>
              ))}
              {([
                ['bold', 'B', 'font-bold'],
                ['italic', 'I', 'italic'],
                ['underline', 'U', 'underline'],
              ] as const).map(([cle, libelle, classe]) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => setStyle((s) => ({ ...s, [cle]: !s[cle] }))}
                  className={`h-7 w-7 rounded-lg text-xs ${classe} ${
                    style[cle] ? 'bg-white text-zinc-900' : 'bg-zinc-800 text-white/80'
                  }`}
                >
                  {libelle}
                </button>
              ))}
            </div>

            {source.kind === 'background' && (
              <div className="flex flex-wrap gap-1.5">
                {STORY_BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={b.id}
                    onClick={() => setSource({ kind: 'background', id: b.id })}
                    className={`h-7 w-7 rounded-lg ring-2 ${
                      source.id === b.id ? 'ring-white' : 'ring-transparent'
                    }`}
                    style={{ background: backgroundCss(b.id) }}
                  />
                ))}
              </div>
            )}

            {erreur && <p className="text-sm text-red-400">{erreur}</p>}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSource({ kind: 'none' })}
                disabled={envoi}
                className="rounded-xl px-3 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                {t('stories.change_source')}
              </button>
              <button
                type="button"
                onClick={publier}
                disabled={envoi}
                className="ml-auto flex items-center gap-2 rounded-xl bg-[#1E40AF] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {envoi && <IconSpinner size={16} className="animate-spin" />}
                {t('stories.publish')}
              </button>
            </div>
          </div>
        </>
      )}

      {cameraOuverte && (
        <CameraCapture onClose={() => setCameraOuverte(false)} onCapture={choisirFichier} />
      )}
    </motion.div>
  );
}
