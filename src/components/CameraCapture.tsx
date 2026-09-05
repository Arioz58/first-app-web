'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconCamera, IconClose, IconSend, IconSpinner } from './icons';

/**
 * Prise de photo par la webcam — pendant web de `components/StoryCamera.tsx` (mobile).
 *
 * ⚠️ `navigator.mediaDevices` n'existe QUE dans un contexte sécurisé : HTTPS, ou
 * `localhost`. En HTTP simple l'objet est `undefined` — pas une permission refusée, une API
 * absente. Le développement local marche donc, mais une mise en ligne en HTTP rendrait cette
 * entrée du menu inerte. On le dit à l'écran plutôt que d'échouer en silence.
 *
 * ⚠️ Les pistes doivent être ARRÊTÉES au démontage. Sans cela la webcam reste allumée, témoin
 * lumineux compris, après la fermeture — ce que l'utilisateur lit, à juste titre, comme une
 * application qui continue de le filmer.
 */

type Phase = { kind: 'loading' } | { kind: 'live' } | { kind: 'shot'; url: string; file: File } | { kind: 'error'; message: string };

export default function CameraCapture({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /**
   * Ouverture du flux. Relancée au changement d'objectif — il faut alors refermer le flux
   * précédent, deux flux simultanés étant refusés par la plupart des appareils.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPhase({ kind: 'error', message: t('camera.insecure') });
        return;
      }
      stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        // Fermeture pendant l'ouverture : le flux vient d'arriver mais plus personne ne
        // l'attend. Sans cet arrêt, la webcam resterait allumée sans aucune fenêtre visible.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase({ kind: 'live' });

        // Le bouton de bascule n'a de sens qu'avec plusieurs caméras — cas du téléphone,
        // pas de l'ordinateur de bureau.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
        }
      } catch (error) {
        if (cancelled) return;
        const name = (error as DOMException)?.name;
        setPhase({
          kind: 'error',
          message:
            name === 'NotAllowedError'
              ? t('camera.denied')
              : name === 'NotFoundError'
                ? t('camera.none')
                : t('camera.failed'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facing, stop, t]);

  // Arrêt définitif au démontage — le seul endroit qui garantit l'extinction de la webcam.
  useEffect(() => stop, [stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    /**
     * ⚠️ `phase === 'live'` dit que le flux est ARRIVÉ, pas que la première image est
     * décodée : `videoWidth` vaut encore 0 pendant ce court intervalle, et déclencher là
     * produisait un canevas vide, donc une photo noire envoyée sans que rien ne le signale.
     */
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    /**
     * ⚠️ Le miroir de la caméra frontale s'applique à l'aperçu ET à la photo.
     *
     * Première version : aperçu en miroir, photo non — au motif qu'un texte filmé doit rester
     * lisible. Mauvais arbitrage. L'image basculait au moment du déclenchement, ce qui est
     * déroutant à chaque prise, alors que l'argument du texte ne concerne en pratique que la
     * caméra arrière — laquelle n'est jamais en miroir, ni ici ni à l'aperçu. Ce qu'on a vu
     * doit être ce qu'on obtient.
     */
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // JPEG : le serveur le signe, tous les navigateurs le décodent.
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setPhase({ kind: 'shot', url: URL.createObjectURL(blob), file });
        stop();
      },
      'image/jpeg',
      0.9,
    );
  }, [facing, stop]);

  // L'URL d'objet est révoquée dès qu'on quitte l'aperçu, sinon le blob reste en mémoire.
  const retake = useCallback(() => {
    setPhase((p) => {
      if (p.kind === 'shot') URL.revokeObjectURL(p.url);
      return { kind: 'loading' };
    });
    // Relance manuelle du flux : `facing` n'a pas changé, l'effet ne rejouerait pas seul.
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase({ kind: 'live' });
      } catch {
        setPhase({ kind: 'error', message: t('camera.failed') });
      }
    })();
  }, [facing, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-white">{t('camera.title')}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800"
            aria-label={t('common.close')}
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full bg-black">
          {phase.kind === 'shot' ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={phase.url} alt="" className="h-full w-full object-contain" />
          ) : phase.kind === 'error' ? (
            <p className="flex h-full items-center justify-center px-8 text-center text-sm text-zinc-400">
              {phase.message}
            </p>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-contain"
                style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
              />
              {phase.kind === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
                  <IconSpinner size={24} className="animate-spin" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 px-4 py-4">
          {phase.kind === 'shot' ? (
            <>
              <button
                type="button"
                onClick={retake}
                className="rounded-full px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t('camera.retake')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onCapture(phase.file);
                  onClose();
                }}
                className="flex items-center gap-2 rounded-full bg-[#1E40AF] px-5 py-2 text-sm font-medium text-white"
              >
                <IconSend size={16} />
                {t('thread.send')}
              </button>
            </>
          ) : (
            <>
              {canSwitch && (
                <button
                  type="button"
                  onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
                  className="rounded-full px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {t('camera.switch')}
                </button>
              )}
              <button
                type="button"
                onClick={shoot}
                disabled={phase.kind !== 'live'}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-zinc-900 disabled:opacity-40"
                aria-label={t('camera.shoot')}
              >
                <IconCamera size={22} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
