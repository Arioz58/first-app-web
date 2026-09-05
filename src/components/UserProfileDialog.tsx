'use client';

import { motion } from 'framer-motion';
import { backdrop, dialog } from '@/lib/motion';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { IconClose, IconLocation } from '@/components/icons';
import { startDirectConversation } from '@/lib/conversations';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  refuseFriendRequest,
  removeFriend,
} from '@/lib/friends';
import { fetchMutualFriends, fetchUserProfile, type UserProfile } from '@/lib/messages';
import { sendFriendRequest } from '@/lib/contacts';

/**
 * Profil d'une autre personne — pendant web d'`app/user/[id].tsx`.
 *
 * ⚠️ Fenêtre CENTRÉE et non un panneau latéral : on l'ouvre depuis la colonne de gauche
 * (recherche par numéro, liste d'amis) ET depuis celle de droite (détails d'une
 * conversation). Un panneau aurait dû choisir un côté, et se serait retrouvé à recouvrir ce
 * depuis quoi on l'a ouvert dans la moitié des cas.
 *
 * ⚠️ Les champs sont GATED côté serveur : un champ absent est un REFUS de confidentialité,
 * pas une donnée manquante. On n'affiche donc rien à sa place — surtout pas « non
 * renseigné », qui laisserait croire que la personne ne l'a pas rempli.
 *
 * ⚠️ Les boutons suivent `canMessage` / `canFriendRequest` / `relationStatus`, tous fournis
 * par le serveur. Les deviner produirait des boutons qui échouent au clic : c'est le serveur
 * qui applique la matrice de confidentialité, et lui seul la connaît.
 */
export function UserProfileDialog({
  userId,
  onClose,
  onOpenConversation,
}: {
  userId: string;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mutual, setMutual] = useState<{ id: string; name: string; photoUrl: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchUserProfile(userId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        /**
         * ⚠️ Chargés seulement s'il y en a : l'endpoint répond 404 quand l'un des deux a
         * bloqué l'autre, et une requête inutile pour zéro ami commun est du bruit.
         */
        if (p.mutualFriendsCount > 0) {
          void fetchMutualFriends(userId)
            .then((l) => !cancelled && setMutual(l))
            .catch(() => {});
        }
      })
      // 404 = profil inaccessible (blocage). Le serveur ne dit pas lequel des deux, et
      // l'interface ne doit pas le déduire non plus.
      .catch(() => !cancelled && setProfile(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /** Rejoue le profil après une action : c'est lui qui porte le nouvel état de la relation. */
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    void action()
      .then(() => fetchUserProfile(userId).then(setProfile))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const message = () =>
    run(() =>
      startDirectConversation(userId).then((c) => {
        onOpenConversation(c.id);
        onClose();
      }),
    );

  const actions = () => {
    if (!profile || profile.isSelf) return null;
    const btn = (label: string, onClick: () => void, kind: 'primary' | 'plain' | 'danger') => (
      <button
        key={label}
        disabled={busy}
        onClick={onClick}
        className={`flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 ${
          kind === 'primary'
            ? 'bg-[#1E40AF] text-white'
            : kind === 'danger'
              ? 'border border-slate-200 text-red-500 dark:border-zinc-700'
              : 'border border-slate-200 text-slate-700 dark:border-zinc-700 dark:text-zinc-200'
        }`}
      >
        {label}
      </button>
    );

    const list = [];
    if (profile.canMessage) list.push(btn(t('phone.send_message'), message, 'primary'));
    if (profile.relationStatus === 'friends')
      list.push(
        btn(
          t('friends.remove'),
          () => {
            if (!window.confirm(t('friends.remove_confirm', { name: profile.name }))) return;
            run(() => removeFriend(userId));
          },
          'danger',
        ),
      );
    else if (profile.relationStatus === 'none' && profile.canFriendRequest)
      list.push(btn(t('phone.add_friend'), () => run(() => sendFriendRequest(userId)), 'plain'));
    else if (profile.relationStatus === 'request_sent' && profile.requestId)
      list.push(
        btn(
          t('profile_user.cancel_request'),
          () => run(() => cancelFriendRequest(profile.requestId!)),
          'plain',
        ),
      );
    else if (profile.relationStatus === 'request_received' && profile.requestId) {
      list.push(
        btn(
          t('friends.accept'),
          () => run(() => acceptFriendRequest(profile.requestId!)),
          'primary',
        ),
      );
      list.push(
        btn(
          t('friends.refuse'),
          () => run(() => refuseFriendRequest(profile.requestId!)),
          'danger',
        ),
      );
    }
    return list.length ? <div className="mt-4 flex gap-2">{list}</div> : null;
  };

  return (
    <motion.div
      onClick={onClose}
      variants={backdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        variants={dialog}
        className="flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-zinc-800">
          <p className="font-semibold text-slate-900 dark:text-zinc-100">
            {t('profile_user.title')}
          </p>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="h-24 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-zinc-800" />
              <div className="mt-4 h-5 w-32 animate-pulse rounded bg-slate-200 dark:bg-zinc-800" />
            </div>
          ) : !profile ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {t('profile_user.unavailable')}
            </p>
          ) : (
            <>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <Avatar name={profile.name} photoUrl={profile.photoUrl} size={96} />
                  {/* Vert = en ligne. Convention universelle, volontairement pas bleue. */}
                  {profile.online && (
                    <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-green-500 dark:border-zinc-900" />
                  )}
                </div>
                <h2 className="mt-3 text-center text-xl font-semibold text-slate-900 dark:text-zinc-100">
                  {profile.name}
                </h2>
                {!profile.online && profile.lastSeenAt && (
                  <p className="mt-0.5 text-sm text-slate-400">
                    {t('profile_user.last_seen', {
                      date: new Date(profile.lastSeenAt).toLocaleDateString(),
                    })}
                  </p>
                )}
                {profile.bio && (
                  <p className="mt-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                    {profile.bio}
                  </p>
                )}
                {profile.phone && <p className="mt-1 text-sm text-slate-400">{profile.phone}</p>}
                {profile.location && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-slate-400">
                    <IconLocation size={13} />
                    {profile.location.city}
                    {profile.location.country ? `, ${profile.location.country}` : ''}
                  </p>
                )}
                {/* ⚠️ Message affiché seulement si TOUT est masqué : sinon on soulignerait
                    une confidentialité qui n'a rien d'inhabituel. */}
                {!profile.bio && !profile.phone && !profile.location && !profile.isSelf && (
                  <p className="mt-2 text-center text-xs text-slate-400">
                    {t('profile_user.no_info')}
                  </p>
                )}
              </div>

              {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
              {actions()}

              {profile.mutualFriendsCount > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t(
                      profile.mutualFriendsCount === 1
                        ? 'profile_user.mutual_one'
                        : 'profile_user.mutual_other',
                      { count: String(profile.mutualFriendsCount) },
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {mutual.map((f) => (
                      <div key={f.id} className="w-16 text-center">
                        <Avatar name={f.name} photoUrl={f.photoUrl} size={44} />
                        <p className="mt-1 truncate text-xs text-slate-500 dark:text-zinc-400">
                          {f.name}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
