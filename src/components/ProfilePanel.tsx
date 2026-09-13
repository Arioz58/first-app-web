'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { backdrop, dialog, panel } from '@/lib/motion';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';

import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Avatar } from '@/components/Avatar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { updateMe } from '@/lib/messages';
import { uploadFile } from '@/lib/upload';
import {
  IconBack,
  IconBlock,
  IconCamera,
  IconEdit,
  IconQr,
  IconChevron,
  IconLock,
  IconBell,
  IconDark,
  IconLeave,
  IconLight,
  IconSystem,
} from '@/components/icons';
import { logout } from '@/lib/auth';
import {
  notificationState,
  requestNotifications,
  type NotificationState,
} from '@/lib/webNotifications';
import { fetchBlocked, unblockUser } from '@/lib/messages';
import { PrivacyPanel } from '@/components/PrivacyPanel';
import { type Me } from '@/lib/messages';
import { disconnectSocket } from '@/lib/socket';
import { setThemePref, THEME_OPTIONS, useThemePref, type ThemePref } from '@/lib/theme';

const THEME_ICON: Record<ThemePref, typeof IconLight> = {
  light: IconLight,
  dark: IconDark,
  system: IconSystem,
};

/**
 * « Vous » — pendant web de l'onglet Profil du mobile.
 *
 * ⚠️ Il RECOUVRE la colonne de la liste au lieu d'ouvrir un écran à part : la conversation
 * ouverte reste visible à droite, et revenir à la liste ne la ferme pas. Un onglet comme sur
 * mobile n'a pas de sens ici, où les deux colonnes coexistent.
 *
 * ⚠️ L'édition du nom, de la photo et de la bio était réservée au mobile (« l'appareil qui
 * porte l'appareil photo »). Livrée ici le 13/09 à la demande du client : ne pas pouvoir
 * changer sa photo depuis son ordinateur passe pour un manque, pas pour un choix — et le
 * navigateur sait parfaitement lire un fichier local.
 */
export function ProfilePanel({
  /** ⚠️ Fourni par la liste, qui l'a déjà chargé pour sa vignette — pas de seconde requête. */
  me,
  onClose,
  onUpdated,
}: {
  me: Me | null;
  onClose: () => void;
  /**
   * ⚠️ Le profil appartient au PARENT (la liste l'a chargé pour sa vignette). Après une
   * modification, c'est lui qu'il faut mettre à jour : garder une copie locale ici ferait
   * diverger la vignette de la colonne et la carte de ce panneau.
   */
  onUpdated: (me: Me) => void;
}) {
  const { t, i18n } = useTranslation();
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  /**
   * ⚠️ Initialisée par une fonction et non lue au rendu : `Notification.permission` n'existe
   * pas côté serveur, et l'y lire ferait diverger le rendu serveur du rendu navigateur
   * (erreur d'hydratation).
   */
  const [notifState, setNotifState] = useState<NotificationState>(() =>
    typeof window === 'undefined' ? 'unsupported' : notificationState(),
  );
  /** Modale d'édition du nom et de la bio (les deux ensemble, comme sur mobile). */
  const [editing, setEditing] = useState<{ name: string; bio: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** Confirmation avant de supprimer la photo : l'action est irréversible sans re-téléverser. */
  const [removePhotoOpen, setRemovePhotoOpen] = useState(false);
  /** QR de profil, encodé à l'ouverture seulement : rien à préparer tant qu'on ne l'ouvre pas. */
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [blocked, setBlocked] = useState<{ id: string; name: string; photoUrl: string | null }[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * ⚠️ Chargée DÈS L'OUVERTURE du profil, pas à l'entrée dans la sous-vue : c'est le compte
   * affiché à côté de l'entrée qui dit s'il y a quelqu'un à débloquer, avant d'aller voir.
   *
   * ⚠️ Chaîne de promesses : les `setState` vivent dans un `.then`, donc après le rendu —
   * React 19 refuse le `setState` synchrone dans un effet.
   */
  const loadBlocked = useCallback(() => fetchBlocked().then(setBlocked).catch(() => {}), []);
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked]);

  useEffect(() => {
    if (!qrOpen || !me) return;
    /**
     * ⚠️ Le lien est construit AU FORMAT que produit le mobile
     * (`Linking.createURL('/user/<id>')` → `nexa://user/<id>`). Le scanner de l'app est
     * tolérant — il extrait `user/<id>` par expression régulière — mais s'en écarter ferait
     * dépendre ce QR d'un détail du scanner plutôt que du format convenu.
     */
    void QRCode.toDataURL(`nexa://user/${me.id}`, {
      width: 320,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setQrData)
      .catch(() => setQrData(''));
  }, [qrOpen, me]);

  const pref = useThemePref();
  const router = useRouter();

  /**
   * ⚠️ Sous-vue plutôt qu'une section dépliante : la liste peut être longue, et la mêler aux
   * réglages ferait glisser le bouton de déconnexion loin sous elle. Même schéma que la
   * galerie de médias du panneau de détails.
   */
  if (privacyOpen) return <PrivacyPanel onClose={() => setPrivacyOpen(false)} />;

  if (blockedOpen) {
    return (
      <motion.div
        variants={panel}
        initial="hidden"
        animate="show"
        className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
          <button
            onClick={() => setBlockedOpen(false)}
            aria-label={t('profile.back')}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <IconBack size={20} />
          </button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
            {t('profile.blocked')}
          </h1>
        </header>

        <p className="px-4 py-3 text-sm text-slate-400">
          {t('profile.blocked_hint')}
        </p>

        <div className="flex-1 overflow-y-auto">
          {blocked.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">
              {t('profile.blocked_none')}
            </p>
          ) : (
            <ul>
              {blocked.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={u.name} photoUrl={u.photoUrl} size={40} />
                  <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-zinc-100">
                    {u.name}
                  </span>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setBusy(u.id);
                      void unblockUser(u.id)
                        .then(loadBlocked)
                        .catch(() => {})
                        .finally(() => setBusy(null));
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#1E40AF] hover:bg-slate-100 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-zinc-800"
                  >
                    {t('moderation.unblock')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={panel}
      initial="hidden"
      animate="show"
      className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-900"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-zinc-800">
        <button
          onClick={onClose}
          aria-label={t('list.back_to_chats')}
          className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
        >
          <IconBack size={20} />
        </button>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">{t('list.you')}</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center px-6 py-8">
          {/* Squelette tant que la requête n'a pas répondu, pour que la mise en page ne saute pas. */}
          {me ? (
            <>
              {/* ⚠️ Un `<input type="file">` CACHÉ, déclenché par le bouton : le champ natif
                  ne se style pas, et son apparence diffère d'un navigateur à l'autre. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // ⚠️ Remis à zéro : sans cela, rechoisir LE MÊME fichier ne déclenche
                  // aucun événement et l'utilisateur croit que le clic n'a rien fait.
                  e.target.value = '';
                  if (!file) return;
                  setSaving(true);
                  void uploadFile(file)
                    .then((photoUrl) => updateMe({ photoUrl }))
                    .then(onUpdated)
                    .catch((err) => window.alert(err.message))
                    .finally(() => setSaving(false));
                }}
              />

              <button
                disabled={saving}
                onClick={() => fileRef.current?.click()}
                title={t('profile.change_photo')}
                className="relative rounded-full disabled:opacity-50"
              >
                <Avatar name={me.name} photoUrl={me.photoUrl} size={96} />
                <span className="absolute bottom-0 right-0 rounded-full bg-[#1E40AF] p-1.5 text-white shadow">
                  <IconCamera size={14} />
                </span>
              </button>

              {me.photoUrl && (
                <button
                  disabled={saving}
                  onClick={() => setRemovePhotoOpen(true)}
                  className="mt-2 text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                >
                  {t('profile.remove_photo')}
                </button>
              )}

              <button
                onClick={() => setEditing({ name: me.name, bio: me.profile?.bio ?? '' })}
                className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-zinc-800"
                title={t('profile.edit_profile')}
              >
                <h2 className="text-xl font-semibold text-slate-900 dark:text-zinc-100">
                  {me.name}
                </h2>
                <IconEdit size={14} className="text-slate-400" />
              </button>

              {/* ⚠️ Cliquable même quand la bio est vide, et vers la MÊME boîte que le
                  crayon : sans cela, l'invitation « ajouter une bio » n'ouvrait rien et il
                  fallait deviner qu'il faut passer par le nom. */}
              <button
                onClick={() => setEditing({ name: me.name, bio: me.profile?.bio ?? '' })}
                className="mt-2 max-w-full rounded-lg px-2 py-0.5 text-center text-sm hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                {me.profile?.bio ? (
                  <span className="text-slate-500 dark:text-zinc-400">{me.profile.bio}</span>
                ) : (
                  <span className="italic text-slate-400">{t('profile.add_bio_hint')}</span>
                )}
              </button>
              <p className="mt-1 text-sm text-slate-400">{me.phone}</p>

              {/* ⚠️ Sous l'identité et non dans les réglages : ce code EST le profil, c'est ce
                  qu'on montre à quelqu'un en face pour se faire ajouter. */}
              <button
                onClick={() => setQrOpen(true)}
                className="mt-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[#1E40AF] hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <IconQr size={16} />
                {t('profile.qr_title')}
              </button>
            </>
          ) : (
            <>
              <div className="h-24 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-zinc-800" />
              <div className="mt-4 h-5 w-32 animate-pulse rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="mt-2 h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-zinc-800" />
            </>
          )}
        </div>

        <section className="border-t border-slate-100 px-4 py-4 dark:border-zinc-800">
          <h3 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('profile.appearance')}
          </h3>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((o) => {
              const Icon = THEME_ICON[o.value];
              const on = pref === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setThemePref(o.value)}
                  aria-pressed={on}
                  className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-3 text-xs transition ${
                    on
                      ? 'border-[#1E40AF] bg-blue-50 font-semibold text-[#1E40AF] dark:bg-blue-900/30'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icon size={18} />
                  {t(`profile.${o.value}`)}
                </button>
              );
            })}
          </div>
          <p className="px-2 pt-2 text-xs text-slate-400">
            {t('profile.system_hint')}
          </p>

          {/* ⚠️ La langue est un réglage de COMPTE au même titre que l'apparence, et le
              sélecteur vit ici pour la même raison : c'est le seul écran de préférences du
              web. Changer de langue réécrit le cookie et bascule l'interface sans recharger. */}
          <h3 className="px-2 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('profile.language')}
          </h3>
          <div className="flex gap-2">
            {LANGUAGES.map((l) => {
              const on = i18n.language === l.code;
              return (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code as Language)}
                  aria-pressed={on}
                  className={`flex-1 rounded-xl border py-2.5 text-sm transition ${
                    on
                      ? 'border-[#1E40AF] bg-blue-50 font-semibold text-[#1E40AF] dark:bg-blue-900/30'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="border-t border-slate-100 px-4 py-4 dark:border-zinc-800">
          {/* ⚠️ Bloquer était possible depuis les détails d'une conversation, débloquer non :
              une fois quelqu'un bloqué, plus rien sur le web ne permettait de revenir en
              arrière. */}
          <button
            onClick={() => setPrivacyOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <IconLock size={18} className="text-slate-500" />
            <span className="flex-1 text-slate-900 dark:text-zinc-100">
              {t('privacy_settings.title')}
            </span>
            <IconChevron size={16} className="text-slate-400" />
          </button>
          {/*
            Notifications du navigateur.

            ⚠️ La demande DOIT partir d'un clic : les navigateurs refusent une demande
            spontanée au chargement, et Firefox la rejette sans rien afficher — un refus
            qu'on prendrait à tort pour un « non » de la personne.

            ⚠️ Une fois refusée, la permission ne peut plus être redemandée par la page :
            seul l'utilisateur peut revenir dessus dans les réglages du navigateur. On le dit
            plutôt que de laisser un bouton qui ne ferait plus rien.
          */}
          {notifState !== 'unsupported' && (
            <button
              disabled={notifState !== 'default'}
              onClick={() => {
                void requestNotifications().then(setNotifState);
              }}
              className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <IconBell size={16} />
              {t('notifications.title')}
              <span className="ml-auto text-xs text-slate-400">
                {t(`notifications.state_${notifState}`)}
              </span>
            </button>
          )}
          {notifState === 'denied' && (
            <p className="mb-2 px-2 text-xs text-slate-400">{t('notifications.denied_hint')}</p>
          )}
          {notifState === 'granted' && (
            <p className="mb-2 px-2 text-xs text-slate-400">{t('notifications.granted_hint')}</p>
          )}

          <button
            onClick={() => setBlockedOpen(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <IconBlock size={16} />
            {t('profile.blocked')}
            <span className="ml-auto flex items-center gap-1 text-slate-400">
              {blocked.length > 0 && blocked.length}
              <IconChevron size={16} />
            </span>
          </button>

          <button
            onClick={() => {
              /**
               * ⚠️ Le socket porte le jeton dans son handshake : le laisser ouvert
               * maintiendrait la connexion au nom du compte qu'on vient de quitter.
               * Il est donc fermé AVANT d'effacer la session.
               */
              disconnectSocket();
              logout();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <IconLeave size={16} />
            {t('common.logout')}
          </button>
        </section>
      </div>

      {/*
        ÉDITION DU NOM ET DE LA BIO — les deux dans la MÊME boîte, comme sur mobile : ce sont
        les deux champs libres du profil, et les séparer obligerait à ouvrir deux fois.

        ⚠️ Les limites (40 et 140) sont celles du mobile. Elles valent surtout pour la bio :
        au-delà, elle déborde partout où elle s'affiche.
      */}
      {/* ⚠️ Mêmes variantes que les autres boîtes de l'app (`ConfirmDialog`, `ChoiceDialog`) :
          une modale qui apparaît sèchement au milieu de fenêtres qui, elles, s'animent, se
          remarque immédiatement comme une pièce rapportée. */}
      <AnimatePresence>
      {editing && (
        <motion.div
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="exit"
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
          onClick={() => setEditing(null)}
        >
          <motion.div
            variants={dialog}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
          >
            <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-zinc-100">
              {t('profile.edit_profile')}
            </h3>

            <input
              autoFocus
              value={editing.name}
              maxLength={40}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={t('profile.your_name')}
              className="mb-3 w-full rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />

            <textarea
              value={editing.bio}
              maxLength={140}
              rows={3}
              onChange={(e) => setEditing({ ...editing, bio: e.target.value })}
              placeholder={t('profile.bio_placeholder')}
              className="w-full resize-none rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none dark:bg-zinc-800 dark:text-zinc-100"
            />
            <p className="mt-1 text-right text-xs text-slate-400">{editing.bio.length}/140</p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                {t('cancel')}
              </button>
              <button
                /* ⚠️ Un nom VIDE est refusé : il s'affiche partout (liste, bulles, groupes) et
                   un blanc y serait illisible. La bio, elle, peut être vidée. */
                disabled={saving || !editing.name.trim()}
                onClick={() => {
                  setSaving(true);
                  void updateMe({ name: editing.name.trim(), bio: editing.bio.trim() })
                    .then((updated) => {
                      onUpdated(updated);
                      setEditing(null);
                    })
                    .catch((err) => window.alert(err.message))
                    .finally(() => setSaving(false));
                }}
                className="rounded-lg bg-[#1E40AF] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {t('details.save')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
        {qrOpen && (
          <motion.div
            variants={backdrop}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={() => setQrOpen(false)}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
          >
            <motion.div
              variants={dialog}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            >
              <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">
                {t('profile.qr_title')}
              </h3>
              {/*
                ⚠️ Fond BLANC en dur autour du code, même en thème sombre : un QR se lit par le
                contraste entre ses modules et leur fond. Inversé, beaucoup de lecteurs ne le
                décodent tout simplement pas. Même règle que `components/QrCode.tsx` sur mobile.
              */}
              <div className="mt-4 rounded-xl bg-white p-3">
                {qrData ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrData} alt="" className="h-52 w-52" />
                ) : (
                  <div className="h-52 w-52 animate-pulse rounded bg-slate-100" />
                )}
              </div>
              <p className="mt-3 text-center text-sm text-slate-500 dark:text-zinc-400">
                {t('profile.qr_hint')}
              </p>
              <button
                onClick={() => setQrOpen(false)}
                className="mt-4 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                {t('common.close')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suppression de la photo : demandée plutôt qu'exécutée. Il faut re-téléverser pour
          revenir en arrière — ce n'est pas un réglage qu'on bascule. */}
      <ConfirmDialog
        open={removePhotoOpen}
        title={t('profile.remove_photo')}
        message={t('profile.remove_photo_confirm')}
        confirmLabel={t('profile.remove_photo')}
        danger
        busy={saving}
        onConfirm={() => {
          setSaving(true);
          // ⚠️ `null` et non une chaîne vide : c'est ce que le serveur attend pour EFFACER la
          // photo et revenir à l'initiale sur pastille.
          void updateMe({ photoUrl: null })
            .then(onUpdated)
            .catch((err) => window.alert(err.message))
            .finally(() => {
              setSaving(false);
              setRemovePhotoOpen(false);
            });
        }}
        onClose={() => setRemovePhotoOpen(false)}
      />
    </motion.div>
  );
}
