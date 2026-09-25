/**
 * Bulles d'appel — ce que le web en affiche.
 *
 * Les appels n'existent pas sur le web (pas d'Agora ici) : on ne peut ni répondre ni
 * rappeler depuis le navigateur. Mais un appel passé depuis le téléphone pose une bulle dans
 * la conversation (`type: 'call'`, voir `calls/callMessage.service.ts` côté serveur), et le
 * web doit la montrer comme le mobile — sans quoi il afficherait une bulle vide.
 *
 * ⚠️ Mêmes règles que `lib/callHistory.ts` côté mobile, et que `isMissedFor` côté serveur :
 * les trois doivent rester alignées, sinon un même appel serait « manqué » ici et
 * « refusé » là.
 */

/** L'appel brut joint à la bulle (`message.call`), non « mis en perspective » du lecteur. */
export type CallInfo = {
  id: string;
  type: string;
  status: string;
  callerId: string;
  receiverId: string;
  answeredAt: string | null;
  endedAt: string | null;
  duration: number | null;
  createdAt: string;
};

/**
 * Manqué, pour CE lecteur : il était appelé, et l'appel a sonné sans réponse (`missed`) ou
 * l'appelant a renoncé avant (`cancelled`). `declined` n'en est pas : refuser, c'est savoir.
 */
export const isMissedCall = (call: CallInfo, me: string | null) =>
  call.receiverId === me && (call.status === 'missed' || call.status === 'cancelled');

export const isLiveCall = (call: CallInfo) => call.status === 'pending' || call.status === 'accepted';

export type CallKind =
  | 'live'
  | 'missed'
  | 'no_answer'
  | 'cancelled'
  | 'declined'
  | 'outgoing'
  | 'incoming';

/**
 * ⚠️ « Décroché » se lit sur le STATUT `ended`, pas sur la durée : un appel décroché puis
 * raccroché dans la seconde dure 0 s, et `0` se lirait « sans réponse ».
 */
export const callKind = (call: CallInfo, me: string | null): CallKind => {
  const outgoing = call.callerId === me;
  if (isLiveCall(call)) return 'live';
  if (isMissedCall(call, me)) return 'missed';
  if (call.status === 'ended') return outgoing ? 'outgoing' : 'incoming';
  if (outgoing) return call.status === 'cancelled' ? 'cancelled' : 'no_answer';
  return 'declined';
};

/** « 2:05 » — un appel se lit en minutes, jamais en secondes brutes. */
export const formatCallDuration = (s: number) =>
  `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

/** Libellé d'un appel terminé ou en cours, avec sa durée quand il a abouti. */
export const callText = (call: CallInfo, me: string | null, t: (k: string) => string) => {
  const kind = callKind(call, me);
  const label = t(`calls.${kind}`);
  return kind === 'outgoing' || kind === 'incoming'
    ? `${label} · ${formatCallDuration(call.duration ?? 0)}`
    : label;
};
