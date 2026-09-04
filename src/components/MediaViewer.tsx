'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBack, IconClose } from '@/components/icons';
import { fetchMedia, type Message } from '@/lib/messages';

/**
 * Visionneuse plein écran, parcourant TOUS les médias de la conversation.
 *
 * ⚠️ Pas seulement ceux de l'album ou du message cliqué : c'est ce qu'on attend d'une
 * visionneuse de messagerie — on ouvre une photo, puis on parcourt les autres sans revenir au
 * fil. Les médias viennent de `/media?category=media` (images ET vidéos), la même source que
 * les compteurs du panneau de détails.
 *
 * ⚠️ Le média cliqué peut être ANCIEN, donc absent des 30 derniers. On remonte page par page
 * jusqu'à le trouver, plafonné : une conversation peut en compter des milliers, et personne
 * n'attendra qu'on les charge tous pour voir une photo.
 */

/** Pages remontées au plus pour retrouver le média cliqué (30 par page). */
const MAX_LOOKUP_PAGES = 10;

const isVideo = (m: Message) => m.mediaType === 'video';

export function MediaViewer({
  conversationId,
  initial,
  onClose,
}: {
  conversationId: string;
  /** Le message sur lequel on a cliqué. Affiché immédiatement, avant tout chargement. */
  initial: Message;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  /**
   * ⚠️ La liste démarre avec le SEUL média cliqué : l'image doit apparaître au clic, pas
   * après un aller-retour réseau. Les autres viennent ensuite s'insérer autour.
   */
  const [items, setItems] = useState<Message[]>([initial]);
  const [index, setIndex] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);
  const stripRef = useRef<HTMLDivElement>(null);

  // Chargement initial : on remonte jusqu'à retrouver le média cliqué.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all: Message[] = [];
      let next: string | undefined;
      for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
        const batch = await fetchMedia(conversationId, 'media', next).catch(() => [] as Message[]);
        if (cancelled) return;
        all.push(...batch);
        next = batch[batch.length - 1]?.id;
        // Page incomplète = plus rien à remonter.
        if (batch.length < 30) {
          if (!cancelled) setExhausted(true);
          break;
        }
        if (all.some((m) => m.id === initial.id)) break;
      }
      if (cancelled || !all.length) return;
      const found = all.findIndex((m) => m.id === initial.id);
      /**
       * ⚠️ Média introuvable dans ce qu'on a remonté (très ancien) : on le place EN TÊTE au
       * lieu de l'abandonner. Le parcours part alors de lui vers les plus récents, ce qui
       * est moins complet mais jamais faux.
       */
      setItems(found === -1 ? [initial, ...all] : all);
      setIndex(found === -1 ? 0 : found);
      setCursor(next ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, initial]);

  /** Charge la page suivante quand on approche de la fin (donc du plus ancien). */
  const loadMore = useCallback(() => {
    if (loadingRef.current || exhausted || !cursor) return;
    loadingRef.current = true;
    void fetchMedia(conversationId, 'media', cursor)
      .then((batch) => {
        if (batch.length < 30) setExhausted(true);
        if (!batch.length) return;
        setItems((prev) => [...prev, ...batch.filter((m) => !prev.some((p) => p.id === m.id))]);
        setCursor(batch[batch.length - 1]?.id ?? null);
      })
      .catch(() => setExhausted(true))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [conversationId, cursor, exhausted]);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = Math.min(Math.max(i + delta, 0), items.length - 1);
        // Deux médias avant la fin : on précharge la suite pour que la flèche reste vivante.
        if (next >= items.length - 2) loadMore();
        return next;
      });
    },
    [items.length, loadMore],
  );

  // Flèches et Échap : une visionneuse plein écran se pilote au clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // La vignette active reste visible dans la bande, qui peut être longue.
  useEffect(() => {
    stripRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [index]);

  const current = items[index];
  if (!current) return null;

  return (
    <div
      // ⚠️ Le fond ferme, pas le contenu : `stopPropagation` sur tout ce qui est cliquable.
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm text-white/60">
          {index + 1} / {items.length}
          {!exhausted && ' +'}
        </span>
        <button onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 hover:bg-white/10">
          <IconClose size={22} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {index > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={t('gallery.previous')}
            className="absolute left-4 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          >
            <IconBack size={22} />
          </button>
        )}

        {isVideo(current) ? (
          <video
            key={current.id}
            src={current.mediaUrl ?? ''}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={current.mediaUrl ?? ''}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain"
          />
        )}

        {index < items.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t('gallery.next')}
            className="absolute right-4 z-10 rotate-180 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
          >
            <IconBack size={22} />
          </button>
        )}
      </div>

      {/* Bande de miniatures. Un seul média : elle n'apprendrait rien. */}
      {items.length > 1 && (
        <div
          ref={stripRef}
          onClick={(e) => e.stopPropagation()}
          className="flex gap-2 overflow-x-auto px-4 py-3"
        >
          {items.map((m, i) => (
            <button
              key={m.id}
              data-active={i === index}
              onClick={() => {
                setIndex(i);
                if (i >= items.length - 2) loadMore();
              }}
              className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 ${
                i === index ? 'ring-white' : 'ring-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {/* ⚠️ Une vidéo est affichée par sa PREMIÈRE IMAGE (`<video>` sans contrôles) :
                  le serveur ne fournit pas de miniature, et une tuile noire ne dirait rien. */}
              {isVideo(m) ? (
                <video src={m.mediaUrl ?? ''} className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.mediaUrl ?? ''} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
