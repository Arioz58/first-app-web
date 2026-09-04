'use client';

import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createWebSession, waitForApproval } from '@/lib/webSession';
import type { AuthUser } from '@/lib/auth';

/**
 * Marge avant expiration à laquelle on renouvelle le QR.
 *
 * ⚠️ On renouvelle AVANT l'échéance, pas après : un QR périmé scanné entre-temps afficherait
 * une erreur au téléphone alors que l'écran semblait valide.
 */
const RENEW_MARGIN_MS = 5000;

/** Connexion par QR : le mobile scanne, le navigateur reçoit ses jetons par socket. */
export function QrLogin({ onConnected }: { onConnected: (user: AuthUser) => void }) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** Compte à rebours affiché — sinon un QR qui se renouvelle paraît clignoter sans raison. */
  const [seconds, setSeconds] = useState(0);

  const stopRef = useRef<(() => void) | null>(null);
  const renewRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⚠️ Le rappel est gardé dans une ref, écrite depuis un EFFET et non pendant le rendu
   * (React 19 l'interdit) : `start` est mémoïsé sans dépendance — il ne doit pas se recréer,
   * sinon chaque rendu relancerait une demande de QR — et lirait donc un rappel figé.
   */
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
    // ⚠️ `t` inclus : le message d'erreur doit suivre un changement de langue.
  }, [onConnected, t]);

  /**
   * ⚠️ La fonction se rappelle elle-même pour le renouvellement : elle passe donc par une
   * ref, un `useCallback` ne pouvant pas se référencer avant d'être déclaré.
   */
  const startRef = useRef<() => void>(() => {});

  const start = useCallback(() => {
    void (async () => {
      try {
        // ⚠️ On coupe l'attente PRÉCÉDENTE avant d'en ouvrir une autre : sans cela, chaque
        // renouvellement laisserait un socket écouter un jeton mort.
        stopRef.current?.();
        setError('');

        const session = await createWebSession();
        // Le QR ne contient que le jeton : rien d'autre n'a besoin d'y être, et un contenu
        // plus riche donnerait de l'information à qui photographie l'écran.
        setDataUrl(
          await QRCode.toDataURL(session.token, {
            width: 320,
            margin: 1,
            color: { dark: '#0f172a', light: '#ffffff' },
          }),
        );

        const remaining = new Date(session.expiresAt).getTime() - Date.now();
        setSeconds(Math.max(0, Math.round(remaining / 1000)));

        stopRef.current = waitForApproval(session.token, (user) =>
          onConnectedRef.current(user),
        );

        if (renewRef.current) clearTimeout(renewRef.current);
        renewRef.current = setTimeout(
          () => startRef.current(),
          Math.max(5000, remaining - RENEW_MARGIN_MS),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : t('login.qr_failed'));
      }
    })();
    // ⚠️ `t` inclus : le message d'erreur doit suivre un changement de langue.
  }, [t]);

  useEffect(() => {
    startRef.current = start;
    start();
    return () => {
      stopRef.current?.();
      if (renewRef.current) clearTimeout(renewRef.current);
    };
  }, [start]);

  // Compte à rebours purement visuel.
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:ring-zinc-700">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- image générée en data URL
          <img src={dataUrl} alt={t('login.qr_title')} width={240} height={240} />
        ) : (
          <div className="h-[240px] w-[240px] animate-pulse rounded-xl bg-slate-100" />
        )}
      </div>

      <ol className="mt-6 space-y-1.5 text-sm text-slate-500 dark:text-zinc-400">
        <li>1. Ouvrez Nexa sur votre téléphone</li>
        <li>2. Allez dans Vous → Nexa Web</li>
        <li>3. Scannez ce code</li>
      </ol>

      {seconds > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          Ce code expire dans {seconds}s — il se renouvelle tout seul.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
