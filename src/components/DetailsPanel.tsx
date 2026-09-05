'use client';

import { ChoiceDialog } from '@/components/ChoiceDialog';

import {
  IconAddMember,
  IconAdmin,
  IconBell,
  IconBellOff,
  IconBlock,
  IconChevron,
  IconCamera,
  IconCheck,
  IconClose,
  IconEdit,
  IconLeave,
  IconLocation,
  IconModerator,
  IconMore,
  IconPhone,
  IconPin,
  IconRemoveMember,
  IconReport,
  IconSpinner,
  IconStar,
  IconTimer,
  IconUnblock,
  IconVideo,
} from '@/components/icons';
import { AddMembersDialog } from '@/components/AddMembersDialog';
import { useTranslation } from 'react-i18next';
import { MediaGalleryView } from '@/components/MediaGalleryView';
import {
  anchorFromEvent,
  FloatingMenu,
  MenuItem,
  openOnRightClick,
  type MenuAnchor,
} from '@/components/FloatingMenu';
import {
  canManageMembers,
  canRemoveMember,
  isGroupAdmin,
  leaveGroup,
  removeMember,
  setMemberRole,
  setWhoCanSend,
  updateGroup,
  type Role,
} from '@/lib/groups';
import { uploadFile } from '@/lib/upload';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import {
  favoriteConversation,
  isMuted,
  muteOptions,
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
  fetchBlocked,
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
  onMetaChanged,
  onOpenProfile,
  onJumpTo,
}: {
  open: boolean;
  meta: ConvMeta | null;
  /** Réglages personnels (sourdine…), venant de la liste. */
  conversation: Conversation | null;
  meId: string | null;
  onClose: () => void;
  onOpenMedia: (message: Message) => void;
  /** Prévient la liste qu'un réglage a changé, pour qu'elle se rafraîchisse. */
  onChanged: () => void;
  /**
   * Recharge les métadonnées de la conversation (membres, rôles, nom, réglages du groupe).
   *
   * ⚠️ Distinct de `onChanged`, qui ne rafraîchit que les réglages PERSONNELS de la liste
   * (épinglage, sourdine…). La modération touche des données PARTAGÉES : après avoir promu
   * ou expulsé quelqu'un, c'est `meta` qu'il faut relire, sinon le panneau continuerait
   * d'afficher l'ancienne composition.
   */
  onMetaChanged: () => void;
  /**
   * Ouvre le profil de quelqu'un.
   *
   * ⚠️ Remonté à l'écran de chat plutôt que rendu ici : la fenêtre est en `fixed`, mais la
   * porter dans ce panneau la ferait disparaître avec lui — or fermer les détails pour
   * consulter un membre serait exactement le contraire de ce qu'on veut.
   */
  onOpenProfile: (userId: string) => void;
  /** Saut vers un message épinglé ou favori — le fil sait charger une fenêtre autour. */
  onJumpTo: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [counts, setCounts] = useState<MediaCounts | null>(null);
  const [gallery, setGallery] = useState<Message[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [ephemeralOpen, setEphemeralOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [starred, setStarred] = useState<Message[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  // --- Modération de groupe ---
  const [addOpen, setAddOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  /**
   * Membre dont le menu d'actions est ouvert, et OÙ le poser.
   *
   * ⚠️ Les deux ensemble dans un seul état : ouvrir le menu d'un autre membre doit remplacer
   * la cible ET le point d'ancrage d'un coup. Séparés, une frame les montrerait désaccordés
   * — le menu du nouveau membre à l'ancienne position.
   */
  const [memberMenu, setMemberMenu] = useState<{ userId: string; at: MenuAnchor } | null>(null);
  /** Édition du nom + description : `null` = pas en cours. */
  const [edit, setEdit] = useState<{ name: string; description: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const router = useRouter();

  const other = meta?.members.find((m) => m.userId !== meId);
  const isGroup = meta?.type === 'group';
  /** Total toutes catégories : ce qui décide d'afficher le lien vers la galerie. */
  const totalMedia = counts
    ? counts.images + counts.videos + counts.documents + counts.audio + counts.gifs + counts.links
    : 0;
  const myRole = meta?.myRole as Role | undefined;
  const admin = isGroup && isGroupAdmin(myRole);
  const canManage = isGroup && canManageMembers(myRole);

  useEffect(() => {
    if (!open || !meta) return;
    queueMicrotask(() => {
      setProfile(null);
      setGallery([]);
      setMuteOpen(false);
      setMemberMenu(null);
      // Le panneau revient toujours sur les infos : rouvrir une conversation ne doit pas
      // atterrir dans la galerie de la précédente.
      setGalleryOpen(false);
      setEdit(null);
      setWhoOpen(false);
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
        .then(setProfile)
        .catch(() => setProfile(null));
      /**
       * ⚠️ Le blocage vient de `/blocks`, PAS de `relationStatus`.
       *
       * Le code testait `relationStatus === 'blocked'`, une valeur que le serveur ne renvoie
       * JAMAIS : `getRelationStatus` ne produit que `self`, `friends`, `request_sent`,
       * `request_received` et `none`. Le test était donc toujours faux et l'action affichait
       * « Bloquer » même sur quelqu'un qu'on venait de bloquer.
       *
       * ⚠️ Le profil ne peut pas servir de source : bloquée, la personne renvoie 404 —
       * précisément pour ne rien révéler. Seule la liste de MES blocages fait foi.
       */
      void fetchBlocked()
        .then((list) => setBlocked(list.some((u) => u.id === other.userId)))
        .catch(() => {});
    }
  }, [open, meta, isGroup, other]);

  if (!open || !meta) return null;

  const title = isGroup ? meta.name ?? '' : other?.user.name ?? '';
  const photo = isGroup ? meta.photoUrl : other?.user.photoUrl;

  /**
   * ⚠️ La galerie REMPLACE le contenu du panneau, elle ne s'ajoute pas dessous : c'est la
   * suite de « Médias, liens et documents », avec sa propre flèche de retour. L'empiler dans
   * une fenêtre par-dessus ferait perdre le fil, visible à gauche.
   */
  if (galleryOpen && counts) {
    return (
      <aside className="flex w-full shrink-0 flex-col border-l border-slate-200 bg-white md:w-[340px] dark:border-zinc-800 dark:bg-zinc-900">
        <MediaGalleryView
          conversationId={meta.id}
          counts={counts}
          onBack={() => setGalleryOpen(false)}
          onOpenMedia={onOpenMedia}
        />
      </aside>
    );
  }

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-slate-200 bg-white md:w-[340px] dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          aria-label={t('common.close')}
        >
          <IconClose size={18} />
        </button>
        <p className="font-semibold text-slate-900 dark:text-zinc-100">
          {t(isGroup ? 'details.group_info' : 'details.contact_info')}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-6 py-6">
          <div className="relative">
            <Avatar name={title} photoUrl={photo} size={96} group={isGroup} />
            {admin && (
              <>
                <input
                  id="group-photo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // ⚠️ Vidé tout de suite : sans ça, rechoisir LE MÊME fichier ne
                    // déclencherait pas `change` et le clic paraîtrait sans effet.
                    e.target.value = '';
                    if (!file) return;
                    setPhotoBusy(true);
                    void uploadFile(file)
                      .then((url) => updateGroup(meta.id, { photoUrl: url }))
                      .then(onMetaChanged)
                      .catch((err) => window.alert(err.message))
                      .finally(() => setPhotoBusy(false));
                  }}
                />
                <label
                  htmlFor="group-photo"
                  title={t('details.change_photo')}
                  className="absolute bottom-0 right-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[#1E40AF] text-white shadow-md"
                >
                  {photoBusy ? (
                    <IconSpinner size={15} className="animate-spin" />
                  ) : (
                    <IconCamera size={15} />
                  )}
                </label>
              </>
            )}
          </div>

          {edit ? (
            /* ⚠️ Nom ET description dans une seule édition, validée d'un coup : ce sont deux
               champs du même PATCH, et les valider séparément ferait deux bandeaux système
               là où l'utilisateur n'a fait qu'une modification. */
            <div className="mt-3 w-full">
              <input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                placeholder={t('details.group_name')}
                className="w-full rounded-xl bg-slate-100 px-3 py-2 text-center text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
              />
              <textarea
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                placeholder={t('details.description')}
                rows={2}
                className="mt-2 w-full resize-none rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
              />
              <div className="mt-2 flex justify-center gap-2">
                <button
                  onClick={() => setEdit(null)}
                  className="px-3 py-1.5 text-sm text-slate-500"
                >
                  {t('cancel')}
                </button>
                <button
                  disabled={busy || !edit.name.trim()}
                  onClick={() => {
                    setBusy(true);
                    void updateGroup(meta.id, {
                      name: edit.name.trim(),
                      // Vider la description l'EFFACE : `null` est un choix, pas une absence.
                      description: edit.description.trim() || null,
                    })
                      .then(() => {
                        setEdit(null);
                        onMetaChanged();
                        // Le nom apparaît aussi dans la liste des conversations.
                        onChanged();
                      })
                      .catch((e) => window.alert(e.message))
                      .finally(() => setBusy(false));
                  }}
                  className="flex items-center gap-1 rounded-xl bg-[#1E40AF] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  <IconCheck size={14} />
                  {t('details.save')}
                </button>
              </div>
            </div>
          ) : (
            <h2 className="mt-3 flex items-center gap-2 text-center text-xl font-semibold text-slate-900 dark:text-zinc-100">
              {title}
              {admin && (
                <button
                  onClick={() =>
                    setEdit({ name: meta.name ?? '', description: meta.description ?? '' })
                  }
                  aria-label={t('details.edit_name')}
                  className="text-slate-400 hover:text-[#1E40AF]"
                >
                  <IconEdit size={15} />
                </button>
              )}
            </h2>
          )}

          {isGroup ? (
            !edit && (
              <>
                {meta.description && (
                  <p className="mt-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                    {meta.description}
                  </p>
                )}
                <p className="mt-1 text-sm text-slate-400">
                  {meta.members.length} membres
                  {myRole && myRole !== 'member' ? ` · ${t('details.you_are_role', { role: t(`roles.${myRole}_low`) })}` : ''}
                </p>
              </>
            )
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
              label={t('details.favorite')}
              soonLabel={t('details.soon')}
              onClick={() =>
                void favoriteConversation(meta.id, !conversation.favoritedAt)
                  .then(onChanged)
                  .catch(() => {})
              }
            />
            <QuickAction
              icon={isMuted(conversation) ? IconBellOff : IconBell}
              label={t('details.mute_short')}
              soonLabel={t('details.soon')}
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
            <QuickAction icon={IconPhone} label={t('details.call')} soonLabel={t('details.soon')} disabled />
            <QuickAction icon={IconVideo} label={t('details.video')} soonLabel={t('details.soon')} disabled />
          </div>
        )}

        {/* Médias : un APERÇU, et un lien vers la galerie complète.
            ⚠️ Les compteurs par catégorie ont quitté cette section : ils ne servaient qu'à
            annoncer un contenu qu'on ne pouvait pas ouvrir. Ils sont désormais les onglets
            de la galerie, où ils filtrent réellement. */}
        {counts && (
          <Section title={t('details.media_section')}>
            {gallery.length > 0 && (
              <div className="mb-2 grid grid-cols-3 gap-1 px-4">
                {gallery.map((m) => (
                  <button key={m.id} onClick={() => onOpenMedia(m)}>
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
            <div className="px-4">
              {totalMedia > 0 ? (
                <button
                  onClick={() => setGalleryOpen(true)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-left text-sm text-[#1E40AF] hover:bg-slate-100 dark:text-blue-400 dark:hover:bg-zinc-800"
                >
                  {t('details.see_all_media')}
                  <span className="flex items-center gap-1 text-slate-400">
                    {totalMedia}
                    <IconChevron size={16} />
                  </span>
                </button>
              ) : (
                <p className="px-2 py-2 text-sm text-slate-400">{t('details.no_media')}</p>
              )}
            </div>
          </Section>
        )}

        {/* Épinglés — niveau conversation, visibles par tous les membres. */}
        {pins.length > 0 && (
          <Section title={t('details.pinned_n', { count: String(pins.length) })}>
            <ul className="px-2">
              {pins.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onJumpTo(m.id)}
                    className="w-full truncate rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <IconPin size={13} className="mr-1.5 inline align-[-2px]" />
                    {m.content || t('details.attachment')}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Favoris — PERSONNELS, contrairement aux épinglés. */}
        {starred.length > 0 && (
          <Section title={t('details.starred_n', { count: String(starred.length) })}>
            <ul className="px-2">
              {starred.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => onJumpTo(m.id)}
                    className="w-full truncate rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <IconStar size={13} className="mr-1.5 inline fill-current align-[-2px]" />
                    {m.content || t('details.attachment')}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Membres d'un groupe */}
        {isGroup && (
          <Section title={t('details.members_count', { count: String(meta.members.length) })}>
            {canManage && (
              <button
                onClick={() => setAddOpen(true)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[#1E40AF] hover:bg-slate-50 dark:hover:bg-zinc-800"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
                  <IconAddMember size={16} />
                </span>
                Ajouter des membres
              </button>
            )}
            <ul className="px-2">
              {/* ⚠️ Admins d'abord, puis modérateurs, puis les membres par ordre alphabétique :
                  qui décide est ce qu'on cherche en premier dans un groupe nombreux. */}
              {[...meta.members]
                .sort((a, b) => {
                  const rank = { admin: 0, moderator: 1, member: 2 } as Record<string, number>;
                  const d = (rank[a.role] ?? 2) - (rank[b.role] ?? 2);
                  return d !== 0 ? d : a.user.name.localeCompare(b.user.name);
                })
                .map((m) => {
                  const isMe = m.userId === meId;
                  const removable = canRemoveMember(myRole, m, meId);
                  // Un admin change les rôles ; jamais le sien (il se retirerait ses droits
                  // sans pouvoir les reprendre si personne d'autre n'est admin).
                  const roleChangeable = admin && !isMe;
                  const actionable = roleChangeable || removable;
                  const openMenu = (at: MenuAnchor) => setMemberMenu({ userId: m.userId, at });
                  return (
                    <li
                      key={m.userId}
                      // Clic droit sur la ligne entière — seulement s'il y a des actions.
                      onContextMenu={actionable ? openOnRightClick(openMenu) : undefined}
                      className="flex items-center gap-3 px-2 py-2"
                    >
                      {/* ⚠️ Seuls l'avatar et le nom ouvrent le profil, pas la ligne
                          entière : le bouton d'actions vit à droite, et un parent cliquable
                          capterait ses clics. Même règle que la liste d'amis.
                          ⚠️ Pas de profil sur SOI-MÊME : le serveur renverrait `isSelf` et
                          l'écran n'aurait rien à proposer. */}
                      <button
                        disabled={isMe}
                        onClick={() => onOpenProfile(m.userId)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                      >
                        <Avatar name={m.user.name} photoUrl={m.user.photoUrl} size={36} />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-zinc-100">
                          {isMe ? t('list.you') : m.user.name}
                        </span>
                      </button>
                      {m.role !== 'member' && (
                        <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-[#1E40AF] dark:bg-blue-900/30">
                          {m.role === 'admin' ? <IconAdmin size={11} /> : <IconModerator size={11} />}
                          {t(`roles.${m.role}`)}
                        </span>
                      )}
                      {actionable && (
                        <button
                          onClick={(e) => openMenu(anchorFromEvent(e))}
                          aria-label={t('details.actions_on', { name: m.user.name })}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
                        >
                          <IconMore size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
          </Section>
        )}

        {/* Réglages personnels */}
        <Section title={t('details.settings')}>
          {conversation && (
            <div className="px-4">
              {/* ⚠️ Le bouton reste TOUJOURS affiché : auparavant la liste des durées le
                  remplaçait sur place, si bien que le réglage disparaissait au profit d'une
                  liste sans titre, sans valeur courante et sans moyen d'en sortir. */}
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
                    {t('details.reactivate_notifs')}
                  </>
                ) : (
                  <>
                    <IconBellOff size={15} />
                    {t('details.mute_for')}
                  </>
                )}
              </button>
            </div>
          )}
          <div className="px-4">
            <button
              onClick={() => setEphemeralOpen(true)}
              className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <IconTimer size={15} className="mr-2 inline align-[-3px]" />
              {t('ephemeral.title')}
              <span className="ml-2 text-xs text-slate-400">
                {meta.ephemeralDuration
                  ? t('details.days_short', { count: String(Math.round(meta.ephemeralDuration / 86400)) })
                  : t('ephemeral.disabled_short')}
              </span>
            </button>
          </div>
        </Section>

        {/* Gestion du groupe : réglage partagé (admin) + sortie (tout le monde). */}
        {isGroup && (
          <Section title={t('details.group_management')}>
            <div className="px-4">
              {admin && (
                <button
                  onClick={() => setWhoOpen(true)}
                  className="block w-full rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <IconEdit size={15} className="mr-2 inline align-[-3px]" />
                  {t('details.who_can_send')}
                  <span className="ml-2 text-xs text-slate-400">
                    {t(meta.whoCanSend === 'admins' ? 'details.admins_short' : 'details.everyone_short')}
                  </span>
                </button>
              )}

              {/* ⚠️ Ouvert à TOUS, y compris au dernier admin : le serveur promeut le membre
                  suivant. Empêcher son départ laisserait quelqu'un prisonnier de son groupe. */}
              <button
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('details.leave_group_confirm'))) return;
                  setBusy(true);
                  void leaveGroup(meta.id)
                    .then(() => {
                      onClose();
                      // La conversation disparaît de la liste : c'est elle qui fait foi.
                      onChanged();
                      router.push('/chat');
                    })
                    .catch((e) => window.alert(e.message))
                    .finally(() => setBusy(false));
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <IconLeave size={15} />
                {t('details.leave_group')}
              </button>
            </div>
          </Section>
        )}

        {/* Gestion — conversation directe seulement : bloquer un groupe n'a pas de sens. */}
        {!isGroup && other && (
          <Section title={t('details.management')}>
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
                        .then(() => window.alert(t('details.report_sent')))
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
                          t('details.block_confirm_named', { name: profile?.name ?? t('details.this_contact') }),
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
                    {t(blocked ? 'moderation.unblock' : 'moderation.block')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setReportOpen(true)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <IconReport size={15} />
                    {t('moderation.report')}
                  </button>
                </>
              )}
            </div>
          </Section>
        )}
      </div>
      {/* ⚠️ UN SEUL menu pour toute la liste, monté hors du `<ul>` : un menu par ligne
          rouvrirait le problème d'origine (découpé par le conteneur qui défile), et n'en
          garderait pas moins un seul ouvert à la fois. */}
      {(() => {
        const m = meta.members.find((x) => x.userId === memberMenu?.userId);
        if (!m || !memberMenu) return null;
        const close = () => setMemberMenu(null);
        return (
          <FloatingMenu anchor={memberMenu.at} onClose={close} width={220}>
            <p className="truncate border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-400 dark:border-zinc-700">
              {m.user.name}
            </p>
            {admin &&
              m.userId !== meId &&
              (['admin', 'moderator', 'member'] as Role[])
                .filter((r) => r !== m.role)
                .map((r) => (
                  <MenuItem
                    key={r}
                    icon={r === 'admin' ? IconAdmin : r === 'moderator' ? IconModerator : undefined}
                    label={t('details.make_role', {
                      role: r === 'member' ? t('details.plain_member') : t(`roles.${r}_low`),
                    })}
                    onClick={() => {
                      close();
                      setBusy(true);
                      void setMemberRole(meta.id, m.userId, r)
                        .then(onMetaChanged)
                        .catch((e) => window.alert(e.message))
                        .finally(() => setBusy(false));
                    }}
                  />
                ))}
            {canRemoveMember(myRole, m, meId) && (
              <MenuItem
                danger
                icon={IconRemoveMember}
                label={t('details.remove_member')}
                onClick={() => {
                  close();
                  if (!window.confirm(t('details.remove_member_confirm', { name: m.user.name })))
                    return;
                  setBusy(true);
                  void removeMember(meta.id, m.userId)
                    .then(onMetaChanged)
                    .catch((e) => window.alert(e.message))
                    .finally(() => setBusy(false));
                }}
              />
            )}
          </FloatingMenu>
        );
      })()}

      {/* Le dialogue est en `fixed inset-0`, donc positionné par rapport à la FENÊTRE : il
          couvre toute la page bien qu'il soit rendu ici, dans une colonne étroite. */}
      {isGroup && (
        <AddMembersDialog
          open={addOpen}
          conversationId={meta.id}
          existingIds={meta.members.map((m) => m.userId)}
          onClose={() => setAddOpen(false)}
          onAdded={onMetaChanged}
        />
      )}
    {/*
      Les trois réglages à choix multiple passent par la MÊME boîte de dialogue : ils posaient
      la même question et souffraient du même défaut — la liste remplaçait le bouton sur place.
    */}
    {conversation && (
      <ChoiceDialog
        open={muteOpen}
        title={t('details.mute_title')}
        options={muteOptions().map((o) => ({ label: t(o.labelKey), value: o.value }))}
        onSelect={(v) => void muteConversation(meta.id, v).then(onChanged).catch(() => {})}
        onClose={() => setMuteOpen(false)}
      />
    )}

    <ChoiceDialog
      open={ephemeralOpen}
      title={t('ephemeral.title')}
      options={EPHEMERAL_OPTIONS.map((o) => ({ label: t(o.labelKey), value: o.value }))}
      /* ⚠️ La durée en cours est cochée : sans repère, on ne sait pas sur quoi le réglage est
         posé et on le remet au hasard. */
      current={meta.ephemeralDuration ?? null}
      onSelect={(v) => void setEphemeral(meta.id, v).catch(() => {})}
      onClose={() => setEphemeralOpen(false)}
    />

    {isGroup && admin && (
      <ChoiceDialog
        open={whoOpen}
        title={t('details.who_can_send')}
        options={[
          { label: t('details.everyone'), value: 'all' as const },
          { label: t('details.admins_only'), value: 'admins' as const },
        ]}
        current={meta.whoCanSend === 'admins' ? ('admins' as const) : ('all' as const)}
        onSelect={(v: 'all' | 'admins') =>
          void setWhoCanSend(meta.id, v).then(onMetaChanged).catch((e) => window.alert(e.message))
        }
        onClose={() => setWhoOpen(false)}
      />
    )}

    </aside>
  );
}

function QuickAction({
  icon: Icon,
  iconClassName,
  label,
  soonLabel,
  onClick,
  disabled,
}: {
  /** ⚠️ Le COMPOSANT d'icône, pas une chaîne : c'est un SVG, il se rend, il ne s'écrit pas. */
  icon: typeof IconStar;
  /** Remplissage/teinte quand l'icône marque un état actif (favori posé, par exemple). */
  iconClassName?: string;
  /**
   * ⚠️ Passé par l'appelant plutôt que traduit ici : ce sous-composant n'appelle pas `t`, et
   * lui ajouter un hook pour une seule infobulle ne se justifie pas.
   */
  soonLabel: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? soonLabel : label}
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
