'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPhone } from '@/components/icons';
import { callKind, callText, formatCallDuration, isLiveCall, type CallInfo } from '@/lib/calls';
import { formatTime } from '@/lib/messages';

/**
 * Bulle d'un appel, côté web — LECTURE SEULE.
 *
 * Même code couleur que le mobile : VERTE tant que l'appel vit (avec son chronomètre une fois
 * décroché), ROUGE s'il a été manqué, neutre sinon. Mais on ne peut ni répondre ni rappeler
 * d'ici — les appels passent par le téléphone —, d'où l'indication à la place d'une action.
 *
 * ⚠️ Chronomètre calculé depuis `answeredAt` (heure du serveur), jamais incrémenté : une
 * bulle affichée au milieu de l'appel montre d'emblée la bonne durée.
 */
export function CallBubble({
  call,
  meId,
  createdAt,
}: {
  call: CallInfo;
  meId: string | null;
  createdAt: string;
}) {
  const { t } = useTranslation();
  const live = isLiveCall(call);
  const ongoing = call.status === 'accepted' && !!call.answeredAt;
  const kind = callKind(call, meId);
  const missed = kind === 'missed';
  const isMe = call.callerId === meId;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!ongoing || !call.answeredAt) return;
    const from = new Date(call.answeredAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - from) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ongoing, call.answeredAt]);

  const title = ongoing
    ? `${t('calls.audio_call')} · ${formatCallDuration(elapsed)}`
    : callText(call, meId, t);

  const tone = live
    ? 'bg-green-600 text-white'
    : missed
      ? 'bg-white text-red-600 dark:bg-zinc-800'
      : 'bg-white text-slate-900 dark:bg-zinc-800 dark:text-zinc-100';

  return (
    <div className={`my-1 flex px-4 ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex min-w-[200px] max-w-[80%] items-center gap-3 rounded-2xl px-3 py-2.5 shadow-sm ${tone}`}>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            live ? 'bg-white/20' : missed ? 'bg-red-50 dark:bg-red-950' : 'bg-slate-100 dark:bg-zinc-700'
          }`}
        >
          <IconPhone size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tabular-nums">{title}</p>
          <p className={`truncate text-xs ${live ? 'text-white/85' : 'text-slate-500 dark:text-zinc-400'}`}>
            {live ? `${t('calls.on_phone')} · ` : ''}
            {formatTime(createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
