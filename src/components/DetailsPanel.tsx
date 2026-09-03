'use client';

import {
  IconBell,
  IconBellOff,
  IconBlock,
  IconClose,
  IconLocation,
  IconPhone,
  IconPin,
  IconReport,
  IconStar,
  IconUnblock,
  IconVideo,
} from '@/components/icons';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
  favoriteConversation,
  isMuted,
  MUTE_OPTIONS,
  muteConversation,
  type Conversation,
} from '@/lib/conversations';
import {
  blockUser,
  EPHEMERAL_OPTIONS,
  fetchMedia,
  fetchMediaCounts,
  fetchPins,
  fetchStarred,
  fetchUserProfile,
  REPORT_CATEGORIES,
  reportUser,
  setEphemeral,
  unblockUser,
  type ConvMeta,
  type MediaCounts,
  type Message,
  type ReportCategory,
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
  onJumpTo,
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
  /** Saut vers un message épinglé ou favori — le fil sait charger une fenêtre autour. */
  onJumpTo: (messageId: string) => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [counts, setCounts] = useState<MediaCounts | null>(null);
  const [gallery, setGallery] = useState<Message[]>([]);
  const [muteOpen, setMuteOpen] = useState(false);
  const [ephemeralOpen, setEphemeralOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [starred, setStarred] = useState<Message[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

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
    void fetchPins(meta.id).then(setPins).catch(() => setPins([]));
    void fetchStarred(meta.id).then(setStarred).catch(() => setStarred([]));
    if (!isGroup && other) {
      void fetchUserProfile(other.userId)
        .then((p) => {
          setProfile(p);
          // `relationStatus` porte le blocage : c'est lui qui décide du libellé de l'action.
          setBlocked(p.relationStatus === 'blocked');
        })
        .catch(() => setProfile(null));
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
          <IconClose size={18} />
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
                  <p className="mt-1 flex items-center justify-center gap-1 text-sm text-slate-400">
                    <IconLocation size={13} />
                    {profile.location.city}
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

        {/* Actions rapides, comme en tête du panneau mobile. */}
        {conversation && (
          <div className="flex justify-center gap-2 px-4 pb-4">
            <QuickAction
              icon={IconStar}
              iconClassName={conversation.favoritedAt ? 'fill-current text-[#1E40AF]' : ''}
              label="Favori"
              onClick={() =>
                void favoriteConversation(meta.id, !conversation.favoritedAt)
                  .then(onChanged)
                  .catch(() => {})
              }
            />
            <QuickAction
              icon={isMuted(conversation) ? IconBellOff : IconBell}
              label="Sourdine"
              onClick={() => {
                if (isMuted(conversation)) {
                  void muteConversation(meta.id, null).then(onChanged).catch(() => {});
                } else {
                  setMuteOpen(true);
                }
              }}
            />
            {/* ⚠️ Les appels sont désactivés : ils arrivent au Mois 4 (Agora). Un bouton
                grisé annonce la fonction sans mentir sur sa disponibilité. */}
            <QuickAction icon={IconPhone} label="Appel" disabled />
            <QuickAction icon={IconVideo} label="Vidéo" disabled />
          </div>
        )}

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

        {/* Épinglés — niveau conversation, visibles par tous les membres. */}
        {pins.length > 0 && (
          <Section title={`Épinglés · ${pins.length}`}>
            <ul className="px-2">
              {pins.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onJumpTo(m.id)}
                    className="w-full truncate rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <IconPin size={13} className="mr-1.5 inline align-[-2px]" />
                    {m.content || 'Pièce jointe'}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Favoris — PERSONNELS, contrairement aux épinglés. */}
        {starred.length > 0 && (
          <Section title={`Favoris · ${starred.length}`}>
            <ul className="px-2">
              {starred.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onJumpTo(m.id)}
                    className="w-full truncate rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <IconStar size={13} className="mr-1.5 inline fill-current align-[-2px]" />
                    {m.content || 'Pièce jointe'}
                  </button>
                </li>
              ))}
            </ul>
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
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {isMuted(conversation) ? (
                    <>
                      <IconBell size={15} />
                      Réactiver les notifications
                    </>
                  ) : (
                    <>
                      <IconBellOff size={15} />
                      Mettre en sourdine…
                    </>
                  )}
                </button>
              )}
            </div>
          )}
          <div className="px-4">
            {ephemeralOpen ? (
              EPHEMERAL_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setEphemeralOpen(false);
                    void setEphemeral(meta.id, o.value).catch(() => {});
                  }}
                  className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {o.label}
                </button>
              ))
            ) : (
              <button
                onClick={() => setEphemeralOpen(true)}
                className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                ⏱ Messages éphémères
                <span className="ml-2 text-xs text-slate-400">
                  {meta.ephemeralDuration
                    ? `${Math.round(meta.ephemeralDuration / 86400)} j`
                    : 'désactivés'}
                </span>
              </button>
            )}
          </div>
        </Section>

        {/* Gestion — conversation directe seulement : bloquer un groupe n'a pas de sens. */}
        {!isGroup && other && (
          <Section title="Gestion">
            <div className="px-4">
              {reportOpen ? (
                REPORT_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setReportOpen(false);
                      void reportUser(other.userId, c.key as ReportCategory)
                        .then(() => window.alert('Signalement envoyé.'))
                        .catch((e) => window.alert(e.message))
                        .finally(() => setBusy(false));
                    }}
                    className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {c.label}
                  </button>
                ))
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      // ⚠️ Confirmation obligatoire : bloquer SUPPRIME l'amitié et annule les
                      // demandes en attente côté serveur. Ce n'est pas un simple masquage,
                      // et l'action ne se défait pas d'un clic.
                      if (
                        !blocked &&
                        !window.confirm(
                          `Bloquer ${profile?.name ?? 'ce contact'} ?\n\nVotre amitié sera supprimée et cette personne ne pourra plus vous contacter.`,
                        )
                      )
                        return;
                      setBusy(true);
                      const call = blocked
                        ? unblockUser(other.userId)
                        : blockUser(other.userId);
                      void call
                        .then(() => {
                          setBlocked(!blocked);
                          onChanged();
                        })
                        .catch((e) => window.alert(e.message))
                        .finally(() => setBusy(false));
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    {blocked ? <IconUnblock size={15} /> : <IconBlock size={15} />}
                    {blocked ? 'Débloquer' : 'Bloquer'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setReportOpen(true)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <IconReport size={15} />
                    Signaler
                  </button>
                </>
              )}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function QuickAction({
  icon: Icon,
  iconClassName,
  label,
  onClick,
  disabled,
}: {
  /** ⚠️ Le COMPOSANT d'icône, pas une chaîne : c'est un SVG, il se rend, il ne s'écrit pas. */
  icon: typeof IconStar;
  /** Remplissage/teinte quand l'icône marque un état actif (favori posé, par exemple). */
  iconClassName?: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Disponible prochainement' : label}
      className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-slate-200 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Icon size={18} className={iconClassName} />
      {label}
    </button>
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
