'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconBack,
  IconDocument,
  IconMic,
  IconPhoto,
  IconSpinner,
  IconVideo,
} from '@/components/icons';
import { fetchMedia, type MediaCounts, type Message } from '@/lib/messages';
import { formatFileSize } from '@/lib/upload';

/**
 * Toutes les pièces jointes d'une conversation, par catégorie — pendant web de
 * `app/chat/media.tsx`.
 *
 * ⚠️ Rendue DANS le panneau de détails, avec une flèche de retour, plutôt que dans une
 * fenêtre par-dessus : elle est la suite de « Médias, liens et documents », pas un ailleurs.
 * Le fil reste visible à gauche, comme dans le reste du panneau.
 */

/**
 * ⚠️ Les clés viennent du serveur (`CATEGORY_WHERE`) et ne sont pas interchangeables :
 * `media` réunit images ET vidéos, `images` et `videos` les séparent. C'est `media` qu'on
 * ouvre par défaut, parce que c'est ce que l'on cherche le plus souvent.
 */
const CATEGORIES: { key: string; label: string; count: (c: MediaCounts) => number }[] = [
  { key: 'media', label: 'Médias', count: (c) => c.images + c.videos },
  { key: 'documents', label: 'Documents', count: (c) => c.documents },
  { key: 'audio', label: 'Vocaux', count: (c) => c.audio },
  { key: 'gifs', label: 'GIFs', count: (c) => c.gifs },
  { key: 'links', label: 'Liens', count: (c) => c.links },
];

/** Une grille pour ce qui se regarde, une liste pour ce qui se lit. */
const isGrid = (key: string) => key === 'media' || key === 'gifs';

const PAGE = 30;

export function MediaGalleryView({
  conversationId,
  counts,
  onBack,
  onOpenMedia,
}: {
  conversationId: string;
  counts: MediaCounts;
  onBack: () => void;
  onOpenMedia: (message: Message) => void;
}) {
  const [category, setCategory] = useState('media');
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);

  /**
   * ⚠️ Aucun `setState` SYNCHRONE ici : React 19 le refuse dans un effet. La remise à zéro
   * (chargement, épuisement, liste) appartient au clic sur une catégorie, qui est un
   * gestionnaire d'événement — et l'état initial couvre déjà le premier montage.
   */
  useEffect(() => {
    let cancelled = false;
    fetchMedia(conversationId, category)
      .then((batch) => {
        if (cancelled) return;
        setItems(batch);
        if (batch.length < PAGE) setExhausted(true);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, category]);

  const loadMore = useCallback(() => {
    const last = items[items.length - 1];
    if (loadingRef.current || exhausted || !last) return;
    loadingRef.current = true;
    fetchMedia(conversationId, category, last.id)
      .then((batch) => {
        if (batch.length < PAGE) setExhausted(true);
        // Dédoublonné : deux pages peuvent se chevaucher si un message est arrivé entre-temps.
        setItems((prev) => [...prev, ...batch.filter((m) => !prev.some((p) => p.id === m.id))]);
      })
      .catch(() => setExhausted(true))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [conversationId, category, items, exhausted]);

  /** Charge la suite quand on approche du bas — pas de bouton « voir plus » à viser. */
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMore();
  };

  const active = CATEGORIES.find((c) => c.key === category);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onBack}
          aria-label="Retour aux infos"
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <p className="font-semibold text-slate-900 dark:text-zinc-100">
          Médias, liens et documents
        </p>
      </header>

      {/* ⚠️ Chaque catégorie porte son COMPTE : c'est ce qui permet de savoir qu'il y a
          quelque chose à voir avant d'y aller. Les catégories vides sont écartées — un
          onglet qui ne mène à rien n'a pas à être proposé. */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3" style={{ flexGrow: 0 }}>
        {CATEGORIES.filter((c) => c.count(counts) > 0).map((c) => (
          <button
            key={c.key}
            onClick={() => {
              if (c.key === category) return;
              setCategory(c.key);
              // Vidé tout de suite : garder les éléments de la catégorie précédente pendant
              // le chargement afficherait des documents sous l'onglet « Vocaux ».
              setItems([]);
              setLoading(true);
              setExhausted(false);
            }}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${
              category === c.key
                ? 'bg-[#1E40AF] text-white'
                : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {c.label} · {c.count(counts)}
          </button>
        ))}
      </div>

      <div onScroll={onScroll} className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            Rien dans « {active?.label ?? category} ».
          </p>
        ) : isGrid(category) ? (
          <div className="grid grid-cols-3 gap-1">
            {items.map((m) => (
              <button key={m.id} onClick={() => onOpenMedia(m)} className="relative">
                {m.mediaType === 'video' ? (
                  <>
                    {/* Première image de la vidéo : le serveur ne fournit pas de vignette. */}
                    <video src={m.mediaUrl ?? ''} className="aspect-square w-full rounded-lg object-cover" />
                    <IconVideo
                      size={16}
                      className="absolute bottom-1 right-1 text-white drop-shadow"
                    />
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.mediaUrl ?? ''}
                    alt=""
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        ) : (
          <ul>
            {items.map((m) => (
              <li key={m.id}>
                <a
                  href={m.mediaUrl ?? firstUrlOf(m.content) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-1 py-2.5 hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-300">
                    {category === 'audio' ? (
                      <IconMic size={18} />
                    ) : category === 'links' ? (
                      <IconPhoto size={18} />
                    ) : (
                      <IconDocument size={18} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900 dark:text-zinc-100">
                      {labelOf(m, category)}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {new Date(m.createdAt).toLocaleDateString()}
                      {m.fileSize ? ` · ${formatFileSize(m.fileSize)}` : ''}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {!exhausted && items.length > 0 && (
          <p className="flex justify-center py-4 text-slate-400">
            <IconSpinner size={18} className="animate-spin" />
          </p>
        )}
      </div>
    </div>
  );
}

/** Première URL d'un texte — un message « lien » n'a pas de `mediaUrl`. */
const firstUrlOf = (text?: string | null): string | null =>
  text?.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i)?.[0] ?? null;

const labelOf = (m: Message, category: string): string => {
  if (category === 'links') return firstUrlOf(m.content) ?? m.content ?? 'Lien';
  if (category === 'audio') return 'Message vocal';
  return m.fileName ?? 'Document';
};
