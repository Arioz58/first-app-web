'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { IconTrash } from '@/components/icons';
import { snappy } from '@/lib/motion';
import { useTranslation } from 'react-i18next';

/**
 * Enregistrement d'un message vocal dans le navigateur.
 *
 * ⚠️ Le FORMAT dépend du navigateur : Chrome et Firefox produisent du WebM/Opus, Safari du
 * MP4/AAC. On négocie donc le type au lieu d'en imposer un — et surtout, on l'envoie tel
 * quel au serveur, qui range selon le MIME. Forcer `audio/webm` ferait échouer l'upload sur
 * Safari, et le fichier serait illisible sur mobile.
 *
 * ⚠️ Écart avec le mobile, à connaître : l'app native enregistre en m4a, lisible partout.
 * Un vocal enregistré depuis Chrome arrive en WebM — lisible par les navigateurs et par
 * Android, mais PAS par le lecteur natif d'iOS. À trancher au Mois 5 : transcodage serveur,
 * ou restreindre l'enregistrement web aux formats communs.
 */

/** Types tentés dans l'ordre : le premier accepté par le navigateur gagne. */
const CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/**
 * Commande exposée au composeur.
 *
 * ⚠️ L'envoi est déclenché de l'EXTÉRIEUR parce que le bouton d'envoi n'appartient plus à
 * l'enregistreur : c'est le bouton du composeur, qui morphe du micro vers l'avion sans jamais
 * être démonté. Un enregistreur qui dessinerait le sien casserait cette continuité — l'ancien
 * bouton disparaissait et un second apparaissait à côté.
 */
export type VoiceHandle = { envoyer: () => void };

export const VoiceRecorder = forwardRef<
  VoiceHandle,
  {
    /** Reçoit le fichier et sa durée. L'envoi lui-même reste à l'appelant. */
    onSend: (file: File, durationMs: number) => void;
    onCancel: () => void;
    /**
     * Micro indisponible ou refusé.
     *
     * ⚠️ Remonté au parent au lieu d'être affiché ici : sans micro il n'y a pas
     * d'enregistrement, donc pas d'état « en train d'enregistrer » à tenir. Garder la barre
     * à l'écran pour y loger un message laissait le bouton d'envoi promettre un vocal qui
     * n'existait pas.
     */
    onError: (message: string) => void;
  }
>(function VoiceRecorder({ onSend, onCancel, onError }, ref) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  /**
   * Niveaux sonores RÉELS, relevés au micro (`AnalyserNode`), et non un décor animé.
   *
   * ⚠️ Une onde inventée serait un mensonge : elle bougerait pareil dans le silence et en
   * parlant, et donnerait à croire que l'enregistrement capte quelque chose alors qu'il peut
   * être muet — micro coupé au niveau du système, mauvaise entrée choisie. C'est précisément
   * ce qu'un retour visuel doit permettre de vérifier.
   */
  const [niveaux, setNiveaux] = useState<number[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  /** Distingue l'annulation de l'envoi : `onstop` est appelé dans les deux cas. */
  const cancelledRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    /**
     * ⚠️ Un micro déjà refusé fait échouer `getUserMedia` IMMÉDIATEMENT, donc l'état du
     * parent changerait de façon synchrone pendant l'effet — rendu en cascade, interdit par
     * React 19. Le `queueMicrotask` garantit que la remontée a lieu après le commit.
     */
    const fail = (msg: string) => queueMicrotask(() => onError(msg));

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = rec;
        chunksRef.current = [];
        startedAtRef.current = Date.now();

        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = () => {
          // ⚠️ Les pistes sont coupées ICI et non au démontage : sans cela, l'indicateur
          // « micro actif » du navigateur resterait allumé après l'envoi.
          stream?.getTracks().forEach((t) => t.stop());
          if (cancelledRef.current) return;

          const type = rec.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type });
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const duration = Date.now() - startedAtRef.current;
          // Moins d'une seconde : appui involontaire, on jette (comme le mobile).
          if (duration < 1000) {
            onCancel();
            return;
          }
          onSend(new File([blob], `vocal-${Date.now()}.${ext}`, { type }), duration);
        };
        rec.start();
      } catch {
        fail(t('voice.mic_denied'));
      }
    })();

    return () => {
      // Démontage brutal (navigation) : on coupe tout sans envoyer.
      cancelledRef.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // ⚠️ `t` dans les dépendances : le message d'erreur doit suivre un changement de langue,
    // et l'omettre figerait le texte dans celle du montage.
  }, [onSend, onCancel, onError, t]);

  // Chronomètre.
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Relève l'amplitude du micro ~20 fois par seconde.
   *
   * ⚠️ Fenêtre GLISSANTE de 40 barres : sur un vocal d'une minute, tout garder donnerait
   * mille barres d'un pixel, illisibles. On montre les deux dernières secondes, comme le fait
   * le mobile.
   *
   * ⚠️ Le contexte audio est fermé au démontage : laissé ouvert, il retient le micro et le
   * témoin d'enregistrement du navigateur reste allumé après l'envoi.
   */
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stoppe = false;

    void (async () => {
      try {
        const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stoppe) {
          flux.getTracks().forEach((p) => p.stop());
          return;
        }
        ctx = new AudioContext();
        const analyseur = ctx.createAnalyser();
        analyseur.fftSize = 512;
        ctx.createMediaStreamSource(flux).connect(analyseur);
        const tampon = new Uint8Array(analyseur.frequencyBinCount);
        let dernier = 0;

        const boucle = (maintenant: number) => {
          raf = requestAnimationFrame(boucle);
          if (maintenant - dernier < 50) return;
          dernier = maintenant;
          analyseur.getByteTimeDomainData(tampon);
          /**
           * ⚠️ Amplitude EFFICACE (RMS) et non le pic : un seul échantillon extrême ferait
           * bondir la barre sur un claquement, alors que la moyenne quadratique suit ce qu'on
           * entend réellement.
           */
          let somme = 0;
          for (let i = 0; i < tampon.length; i++) {
            const v = (tampon[i] - 128) / 128;
            somme += v * v;
          }
          const rms = Math.sqrt(somme / tampon.length);
          // ⚠️ Racine : la perception du volume n'est pas linéaire, et sans elle le tracé
          // paraît plat pour une voix normale.
          setNiveaux((n) => [...n.slice(-39), Math.min(1, Math.sqrt(rms) * 1.8)]);
          if (stoppe) cancelAnimationFrame(raf);
        };
        raf = requestAnimationFrame(boucle);
      } catch {
        // Micro indisponible : l'enregistrement lui-même signale déjà l'erreur.
      }
    })();

    return () => {
      stoppe = true;
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => {});
    };
  }, []);

  const stop = useCallback(
    (cancel: boolean) => {
      cancelledRef.current = cancel;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      if (cancel) onCancel();
    },
    [onCancel],
  );

  /** ⚠️ Ne dépend que de rappels stables : le composeur garde la même poignée pendant tout
      l'enregistrement, et son bouton d'envoi ne pointe jamais vers une version périmée. */
  useImperativeHandle(ref, () => ({ envoyer: () => stop(false) }), [stop]);

  return (
    /* ⚠️ `min-h-11` : la barre du composeur est alignée en bas (`items-end`), et une bande
       plus courte que le bouton d'envoi le ferait remonter au démarrage de l'enregistrement. */
    <div className="flex min-h-11 flex-1 items-center gap-3 px-2">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      <span className="font-mono text-sm text-slate-600 dark:text-zinc-300">{fmt(seconds)}</span>

      {/*
        Onde en direct. ⚠️ `items-center` avec des barres qui grandissent des DEUX côtés :
        une onde ancrée en bas se lit comme un graphique, pas comme du son.
      */}
      <div className="flex h-8 flex-1 items-center gap-[2px] overflow-hidden">
        {niveaux.length === 0 ? (
          <span className="text-sm text-slate-400">{t('voice.recording')}</span>
        ) : (
          niveaux.map((n, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-[#1E40AF] dark:bg-blue-400"
              /* ⚠️ Hauteur MINIMALE de 3 px : à zéro, la barre disparaît et l'onde se troue
                 dans les silences au lieu de s'aplatir. */
              style={{ height: Math.max(3, n * 30) }}
            />
          ))
        )}
      </div>

      {/* ⚠️ Une CORBEILLE plutôt que le mot « Annuler » : l'action est destructrice, et une
          icône rouge se distingue au premier coup d'œil du bouton d'envoi juste à côté. */}
      <motion.button
        onClick={() => stop(true)}
        whileTap={{ scale: 0.88 }}
        transition={snappy}
        aria-label={t('cancel')}
        className="flex h-9 w-9 items-center justify-center rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <IconTrash size={17} />
      </motion.button>
    </div>
  );
});
