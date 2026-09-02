'use client';

import { useEffect, useRef, useState } from 'react';

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

export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  /** Reçoit le fichier et sa durée. L'envoi lui-même reste à l'appelant. */
  onSend: (file: File, durationMs: number) => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  /** Distingue l'annulation de l'envoi : `onstop` est appelé dans les deux cas. */
  const cancelledRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    /**
     * ⚠️ Un micro déjà refusé fait échouer `getUserMedia` IMMÉDIATEMENT, donc `setError`
     * partirait de façon synchrone dans l'effet — rendu en cascade, interdit par React 19.
     * Le `queueMicrotask` garantit que l'état est posé après le commit.
     */
    const fail = (msg: string) => queueMicrotask(() => setError(msg));

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
        fail("Micro indisponible. Autorisez l'accès dans votre navigateur.");
      }
    })();

    return () => {
      // Démontage brutal (navigation) : on coupe tout sans envoyer.
      cancelledRef.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onSend, onCancel]);

  // Chronomètre.
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stop = (cancel: boolean) => {
    cancelledRef.current = cancel;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (cancel) onCancel();
  };

  if (error) {
    return (
      <div className="flex flex-1 items-center gap-3 px-2">
        <p className="flex-1 text-sm text-red-500">{error}</p>
        <button onClick={onCancel} className="text-sm text-slate-500">
          Fermer
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-3 px-2">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
      <span className="font-mono text-sm text-slate-600 dark:text-zinc-300">{fmt(seconds)}</span>
      <span className="flex-1 text-sm text-slate-400">Enregistrement…</span>
      <button
        onClick={() => stop(true)}
        className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
      >
        Annuler
      </button>
      <button
        onClick={() => stop(false)}
        className="rounded-full bg-[#1E40AF] px-4 py-1.5 text-sm font-semibold text-white"
      >
        Envoyer
      </button>
    </div>
  );
}
