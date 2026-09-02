'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { hasSession, sendCode, verifyCode } from '@/lib/auth';
import { QrLogin } from '@/components/QrLogin';

/** Longueur du code OTP — alignée sur le mobile (6 champs individuels). */
const CODE_LENGTH = 6;
/** Attente avant de pouvoir redemander un code, comme sur mobile. */
const RESEND_COOLDOWN = 45;

export default function LoginPage() {
  const router = useRouter();
  /**
   * QR en principal, numéro en REPLI — décision du 2 sept.
   *
   * ⚠️ Le repli n'est pas décoratif : sans téléphone sous la main (déchargé, appareil photo
   * cassé), le QR seul enfermerait dehors quelqu'un qui a pourtant un compte valide.
   */
  const [mode, setMode] = useState<'qr' | 'phone'>('qr');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Déjà connecté : on ne montre pas un écran de connexion à quelqu'un qui a une session.
  useEffect(() => {
    if (hasSession()) router.replace('/');
  }, [router]);

  // Compte à rebours du renvoi.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await sendCode(phone.trim());
      setStep('code');
      setCooldown(RESEND_COOLDOWN);
      // Le champ suivant prend le focus : sur un écran de saisie en deux temps, obliger à
      // cliquer pour continuer casse le rythme.
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyCode(phone.trim(), code.trim(), name.trim() || undefined);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code invalide');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-xl dark:bg-zinc-900">
        <h1 className="text-3xl font-bold text-[#1E40AF] dark:text-blue-400">Nexa</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
          {mode === 'qr'
            ? 'Scannez ce code avec votre téléphone.'
            : step === 'phone'
              ? 'Entrez votre numéro pour recevoir un code.'
              : `Code envoyé au ${phone}.`}
        </p>

        {mode === 'qr' ? (
          <div className="mt-6">
            <QrLogin onConnected={() => router.replace('/chat')} />
            <button
              type="button"
              onClick={() => setMode('phone')}
              className="mt-6 w-full text-center text-sm text-slate-500 hover:underline dark:text-zinc-400"
            >
              Se connecter avec mon numéro
            </button>
          </div>
        ) : (
        <>

        {step === 'phone' ? (
          <form onSubmit={submitPhone} className="mt-6 space-y-3">
            <input
              type="tel"
              inputMode="tel"
              autoFocus
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+33 6 12 34 56 78"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#1E40AF] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Prénom (si nouveau compte)"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-[#1E40AF] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={busy || !phone.trim()}
              className="w-full rounded-xl bg-[#1E40AF] py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Envoi…' : 'Recevoir un code'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="mt-6 space-y-3">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              maxLength={CODE_LENGTH}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-[#1E40AF] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={busy || code.length < CODE_LENGTH}
              className="w-full rounded-xl bg-[#1E40AF] py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Vérification…' : 'Se connecter'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setCode('');
                  setError('');
                }}
                className="text-slate-500 hover:underline dark:text-zinc-400"
              >
                Changer de numéro
              </button>
              <button
                type="button"
                disabled={cooldown > 0}
                onClick={() => {
                  sendCode(phone.trim()).catch(() => {});
                  setCooldown(RESEND_COOLDOWN);
                }}
                className="text-[#1E40AF] disabled:text-slate-400 hover:underline dark:text-blue-400"
              >
                {cooldown > 0 ? `Renvoyer (${cooldown}s)` : 'Renvoyer le code'}
              </button>
            </div>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <button
          type="button"
          onClick={() => {
            setMode('qr');
            setStep('phone');
            setError('');
          }}
          className="mt-6 w-full text-center text-sm text-slate-500 hover:underline dark:text-zinc-400"
        >
          Revenir au code QR
        </button>
        </>
        )}
      </div>
    </main>
  );
}
