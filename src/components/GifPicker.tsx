'use client';

import { motion } from 'framer-motion';
import { popover } from '@/lib/motion';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiRequest } from '@/lib/api';
import { IconClose, IconSpinner } from './icons';

/**
 * Sélecteur de GIFs — pendant web de `components/GiphyPicker.tsx` (mobile).
 *
 * ⚠️ Passe par NOTRE serveur (`GET /giphy`), jamais par `api.giphy.com` : la clé d'API reste
 * côté backend. Le mobile l'embarquait dans son bundle, ce que le proxy permet justement de
 * corriger — ne pas réintroduire d'appel direct ici.
 *
 * ⚠️ Le GIF est envoyé par son URL Giphy, SANS passer par S3 — exactement comme le mobile
 * (`onGifSelect`). Le re-téléverser changerait l'URL sans rien apporter, et surtout les deux
 * clients doivent produire des messages identiques : c'est la même conversation.
 */

type Gif = { id: string; preview: string; original: string };

/**
 * ⚠️ Aucune prop `open` : le parent MONTE et DÉMONTE ce composant. Le garder monté avec un
 * drapeau obligeait à remettre la recherche à zéro dans un effet — ce que React 19 interdit
 * (`set-state-in-effect`), et qui n'était qu'un contournement : démonter réinitialise l'état
 * par construction, et repart donc sur les tendances à la réouverture.
 */
export default function GifPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (url: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚠️ Le compteur écarte les réponses hors délai : en tapant vite, une recherche lancée plus
   * tôt peut répondre après une plus récente et réafficher d'anciens résultats.
   */
  const runRef = useRef(0);

  const load = useCallback(
    async (q: string) => {
      const run = ++runRef.current;
      setLoading(true);
      setError(null);
      try {
        const { gifs: found } = await apiRequest<{ gifs: Gif[] }>(
          `/giphy${q ? `?q=${encodeURIComponent(q)}` : ''}`,
        );
        if (run !== runRef.current) return;
        setGifs(found);
      } catch {
        if (run !== runRef.current) return;
        setGifs([]);
        setError(t('gif.unavailable'));
      } finally {
        if (run === runRef.current) setLoading(false);
      }
    },
    [t],
  );

  // Tendances au montage, puis recherche débouncée — même cadence que le mobile (350 ms).
  useEffect(() => {
    const q = query.trim();
    const timer = setTimeout(() => void load(q), q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Voile transparent : ferme au clic à côté sans assombrir la conversation, le
          sélecteur étant ancré au composeur et non centré comme une boîte de dialogue. */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      {/*
        ⚠️ `transformOrigin` en bas à gauche : le sélecteur SORT du bouton GIF, qui se trouve
        sous son coin gauche. Sans cette origine il grandirait depuis son centre, et rien ne
        relierait le panneau au bouton qu'on vient de cliquer.
      */}
      <motion.div
        variants={popover}
        initial="hidden"
        animate="show"
        style={{ transformOrigin: 'bottom left' }}
        className="absolute bottom-full left-4 z-40 mb-2 flex h-96 w-[22rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-zinc-800">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('gif.search')}
            className="flex-1 rounded-full bg-slate-100 px-3 py-1.5 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
            aria-label={t('common.close')}
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading && !gifs.length ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <IconSpinner size={22} className="animate-spin" />
            </div>
          ) : error ? (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
              {error}
            </p>
          ) : !gifs.length ? (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
              {t('gif.empty')}
            </p>
          ) : (
            /* Deux colonnes : les aperçus Giphy ont des proportions très variables, une
               grille plus dense les écraserait. */
            <div className="grid grid-cols-2 gap-2">
              {gifs.map((gif) => (
                <button
                  key={gif.id}
                  type="button"
                  onClick={() => {
                    onSelect(gif.original);
                    onClose();
                  }}
                  className="overflow-hidden rounded-lg bg-slate-100 transition hover:opacity-80 dark:bg-zinc-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={gif.preview}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
