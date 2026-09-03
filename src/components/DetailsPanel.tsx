'use client';

import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { isMuted, MUTE_OPTIONS, muteConversation, type Conversation } from '@/lib/conversations';
import {
  fetchMedia,
  fetchMediaCounts,
  fetchUserProfile,
  type ConvMeta,
  type MediaCounts,
  type Message,
  type UserProfile,
} from '@/lib/messages';

/**
 * Panneau de détails, en troisième colonne — façon WhatsApp Web.
 *
 * ⚠️ Une colonne du layout et non une fenêtre superposée : le fil reste lisible à côté,
 * c'est tout l'intérêt d'un grand écran. Sur écran étroit il prend toute la place, la
 * superposition n'ayant alors plus d'inconvénient.
 *
 * ⚠️ Le profil est GATED côté serveur : un champ absent est un refus de confidentialité, pas
 * une donnée manquante. On n'affiche donc rien à sa place — surtout pas « non renseigné »,
 * qui laisserait croire que la personne ne l'a pas rempli.
 */
export function DetailsPanel({
  open,
  meta,
  conversation,
  meId,
  onClose,
  onOpenMedia,
  onChanged,
}: {
  open: boolean;
  meta: ConvMeta | null;
  /** Réglages personnels (sourdine…), venant de la liste. */
  conversation: Conversation | null;
  meId: string | null;
  onClose: () => void;
  onOpenMedia: (url: string, kind: 'image' | 'video') => void;
  /** Prévient la liste qu'un réglage a changé, pour qu'elle se rafraîchisse. */
  onChanged: () => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [counts, setCounts] = useState<MediaCounts | null>(null);
  const [gallery, setGallery] = useState<Message[]>([]);
  const [muteOpen, setMuteOpen] = useState(false);

  const other = meta?.members.find((m) => m.userId !== meId);
  const isGroup = meta?.type === 'group';

  useEffect(() => {
    if (!open || !meta) return;
    queueMicrotask(() => {
      setProfile(null);
      setGallery([]);
      setMuteOpen(false);
    });

    void fetchMediaCounts(meta.id).then(setCounts).catch(() => setCounts(null));
    // Aperçu de la galerie : les images récentes, pour donner à voir sans ouvrir un écran.
    void fetchMedia(meta.id, 'images')
      .then((m) => setGallery(m.slice(0, 6)))
      .catch(() => setGallery([]));
    if (!isGroup && other) {
      void fetchUserProfile(other.userId).then(setProfile).catch(() => setProfile(null));
    }
  }, [open, meta, isGroup, other]);

  if (!open || !meta) return null;

  const title = isGroup ? meta.name ?? '' : other?.user.name ?? '';
  const photo = isGroup ? meta.photoUrl : other?.user.photoUrl;

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-slate-200 bg-white md:w-[340px] dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          aria-label="Fermer"
        >
          ✕
        </button>
        <p className="font-semibold text-slate-900 dark:text-zinc-100">
          {isGroup ? 'Infos du groupe' : 'Infos du contact'}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-6 py-6">
          <Avatar name={title} photoUrl={photo} size={96} group={isGroup} />
          <h2 className="mt-3 text-center text-xl font-semibold text-slate-900 dark:text-zinc-100">
            {title}
          </h2>

          {isGroup ? (
            <p className="mt-1 text-sm text-slate-400">{meta.members.length} membres</p>
          ) : (
            profile && (
              <>
                {profile.bio && (
                  <p className="mt-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                    {profile.bio}
                  </p>
                )}
                {profile.phone && (
                  <p className="mt-1 text-sm text-slate-400">{profile.phone}</p>
                )}
                {profile.location && (
                  <p className="mt-1 text-sm text-slate-400">
                    📍 {profile.location.city}
                    {profile.location.country ? `, ${profile.location.country}` : ''}
                  </p>
                )}
                {profile.mutualFriendsCount > 0 && (
                  <p className="mt-1 text-sm text-slate-400">
                    {profile.mutualFriendsCount} ami
                    {profile.mutualFriendsCount > 1 ? 's' : ''} en commun
                  </p>
                )}
              </>
            )
          )}
        </div>

        {/* Médias */}
        {counts && (
          <Section title="Médias, liens et documents">
            {gallery.length > 0 && (
              <div className="mb-2 grid grid-cols-3 gap-1 px-4">
                {gallery.map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      onOpenMedia(m.mediaUrl!, m.mediaType === 'video' ? 'video' : 'image')
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.mediaUrl ?? ''}
                      alt=""
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 px-4 text-xs text-slate-500 dark:text-zinc-400">
              {(
                [
                  ['Photos', counts.images],
                  ['Vidéos', counts.videos],
                  ['Documents', counts.documents],
                  ['Vocaux', counts.audio],
                  ['Liens', counts.links],
                ] as const
              )
                .filter(([, n]) => n > 0)
                .map(([label, n]) => (
                  <span
                    key={label}
                    className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-zinc-800"
                  >
                    {label} · {n}
                  </span>
                ))}
              {Object.values(counts).every((n) => !n) && (
                <span className="text-slate-400">Aucun média échangé.</span>
              )}
            </div>
          </Section>
        )}

        {/* Membres d'un groupe */}
        {isGroup && (
          <Section title={`Membres · ${meta.members.length}`}>
            <ul className="px-2">
              {meta.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 px-2 py-2">
                  <Avatar name={m.user.name} photoUrl={m.user.photoUrl} size={36} />
                  <span className="flex-1 truncate text-sm text-slate-900 dark:text-zinc-100">
                    {m.userId === meId ? 'Vous' : m.user.name}
                  </span>
                  {m.role !== 'member' && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-[#1E40AF] dark:bg-blue-900/30">
                      {m.role === 'admin' ? 'admin' : 'modérateur'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Réglages personnels */}
        <Section title="Réglages">
          {conversation && (
            <div className="px-4">
              {muteOpen ? (
                MUTE_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    onClick={() => {
                      setMuteOpen(false);
                      void muteConversation(meta.id, o.value).then(onChanged).catch(() => {});
                    }}
                    className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {o.label}
                  </button>
                ))
              ) : (
                <button
                  onClick={() => {
                    if (isMuted(conversation)) {
                      void muteConversation(meta.id, null).then(onChanged).catch(() => {});
                    } else {
                      setMuteOpen(true);
                    }
                  }}
                  className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {isMuted(conversation)
                    ? '🔔 Réactiver les notifications'
                    : '🔕 Mettre en sourdine…'}
                </button>
              )}
            </div>
          )}
          {meta.ephemeralDuration ? (
            <p className="px-6 pt-1 text-xs text-slate-400">
              ⏱ Messages éphémères activés
            </p>
          ) : null}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-100 py-4 dark:border-zinc-800">
      <h3 className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}
