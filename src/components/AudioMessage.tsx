'use client';

import { motion } from 'framer-motion';
import { MorphIcon } from 'morphicons/react';
import { Pause as PauseNode, Play as PlayNode } from 'lucide';
import { useCallback, useEffect, useRef, useState } from 'react';

import { damped, snappy } from '@/lib/motion';

/**
 * Lecteur de message vocal — remplace le `<audio controls>` natif.
 *
 * ⚠️ Le lecteur du navigateur ne se style pas : son apparence est celle du système, différente
 * sur Chrome, Safari et Firefox, et sans rapport avec le reste de l'interface. Il occupait
 * aussi une largeur fixe qui débordait des bulles étroites.
 *
 * ⚠️ Le bouton lecture/pause MORPHE au lieu d'échanger deux icônes : c'est la même commande
 * qui change d'état, le cas où un morphing dit quelque chose. `reducedMotion="user"` parce que
 * la bibliothèque ignore `prefers-reduced-motion` par défaut.
 */

/** Vitesses proposées, comme sur mobile. */
const VITESSES = [1, 1.5, 2] as const;

const mmss = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
};

export function AudioMessage({
  src,
  durationMs,
  mine,
}: {
  src: string;
  /** Durée annoncée par l'expéditeur — affichée AVANT tout chargement du fichier. */
  durationMs?: number | null;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [joue, setJoue] = useState(false);
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState((durationMs ?? 0) / 1000);
  const [vitesse, setVitesse] = useState<number>(1);

  /**
   * ⚠️ Les écouteurs sont posés sur l'élément et non pilotés par des props React : `play()` et
   * `pause()` peuvent aussi venir du système (touches média, autre onglet), et un état déduit
   * des seuls clics finirait par mentir sur ce qui se passe réellement.
   */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setPosition(a.currentTime);
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setDuree(a.duration);
    };
    const onPlay = () => setJoue(true);
    const onPause = () => setJoue(false);
    const onEnd = () => {
      setJoue(false);
      setPosition(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const basculer = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }, []);

  const changerVitesse = useCallback(() => {
    const a = audioRef.current;
    setVitesse((v) => {
      const suivante = VITESSES[(VITESSES.indexOf(v as 1) + 1) % VITESSES.length];
      if (a) a.playbackRate = suivante;
      return suivante;
    });
  }, []);

  /** Déplacement dans le vocal en cliquant la piste. */
  const chercher = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  }, []);

  const avancement = duree > 0 ? Math.min(1, position / duree) : 0;
  const teinte = mine ? 'bg-white' : 'bg-[#1E40AF] dark:bg-blue-400';

  return (
    <div
      className={`mb-1 flex w-64 max-w-full items-center gap-3 rounded-xl px-3 py-2.5 ${
        mine ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <motion.button
        type="button"
        onClick={basculer}
        whileTap={{ scale: 0.88 }}
        transition={snappy}
        aria-label={joue ? 'Pause' : 'Play'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          mine ? 'bg-white/25 text-white' : 'bg-[#1E40AF] text-white'
        }`}
      >
        {/*
          ⚠️ `fill` + `strokeWidth={0}` : les icônes lucide sont des CONTOURS, et un triangle
          de lecture creux ne se lit pas à 17 px — la commande la plus universelle qui soit
          s'attend à être pleine. Le trait est mis à zéro plutôt que laissé à sa valeur par
          défaut, qui rajoutait un liseré d'un pixel tout autour de la forme déjà remplie.
        */}
        <MorphIcon
          icon={joue ? PauseNode : PlayNode}
          size={17}
          fill="currentColor"
          strokeWidth={0}
          reducedMotion="user"
        />
      </motion.button>

      <div className="min-w-0 flex-1">
        {/*
          ⚠️ Piste cliquable sur toute sa hauteur (`py-2` invisible) : une barre de 4 px se
          vise mal à la souris et pas du tout au doigt.
        */}
        <div onClick={chercher} className="cursor-pointer py-2">
          <div className={`h-1 w-full rounded-full ${mine ? 'bg-white/30' : 'bg-black/10 dark:bg-white/20'}`}>
            <motion.div
              className={`h-full rounded-full ${teinte}`}
              style={{ width: `${avancement * 100}%` }}
              transition={damped}
            />
          </div>
        </div>
        <div className={`flex items-center justify-between text-[11px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>
          {/* ⚠️ On affiche le temps ÉCOULÉ pendant la lecture, la DURÉE totale au repos : le
              premier renseigne où l'on en est, le second combien de temps ça prend. */}
          <span className="font-mono">{mmss(joue || position > 0 ? position : duree)}</span>
          <button
            type="button"
            onClick={changerVitesse}
            className={`rounded px-1.5 py-0.5 font-semibold ${
              mine ? 'hover:bg-white/20' : 'hover:bg-black/10 dark:hover:bg-white/10'
            }`}
          >
            {vitesse}×
          </button>
        </div>
      </div>
    </div>
  );
}
