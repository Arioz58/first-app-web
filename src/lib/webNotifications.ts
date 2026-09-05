/**
 * Notifications du navigateur.
 *
 * ⚠️ POURQUOI c'est nécessaire, au-delà du confort : le serveur n'envoie de notification
 * push qu'aux utilisateurs HORS LIGNE (`isUserOnline`), et « en ligne » veut dire « au moins
 * un socket ouvert ». Un onglet web laissé ouvert — même en arrière-plan, même sur un autre
 * bureau — suffit donc à rendre quelqu'un « en ligne » et à PRIVER SON TÉLÉPHONE de ses
 * notifications. Sans ce module, ouvrir le client web revenait à se rendre silencieux.
 *
 * ⚠️ Ce n'est PAS du Web Push : rien n'est envoyé par le serveur, tout part du socket déjà
 * ouvert par l'onglet. Conséquence assumée — onglet fermé, pas de notification web ; c'est
 * alors le téléphone qui reprend son rôle, puisque plus aucun socket ne le fait passer pour
 * en ligne. C'est le modèle de WhatsApp Web. Un vrai Web Push (VAPID + abonnements stockés)
 * n'apporterait que le cas « navigateur ouvert mais onglet fermé ».
 */

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

const supported = () =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator;

export const notificationState = (): NotificationState => {
  if (!supported()) return 'unsupported';
  return Notification.permission as NotificationState;
};

/**
 * Enregistre le service worker.
 *
 * ⚠️ À la RACINE (`/sw.js`) : la portée d'un service worker est celle de son répertoire, et
 * placé ailleurs il ne verrait pas les fenêtres de l'application au moment du clic.
 */
export const registerNotificationWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
};

/**
 * Demande la permission.
 *
 * ⚠️ À appeler depuis un GESTE de l'utilisateur (un clic) : les navigateurs refusent
 * désormais une demande spontanée au chargement, et Firefox la rejette sans rien afficher —
 * un refus qu'on prendrait à tort pour un « non » de la personne.
 */
export const requestNotifications = async (): Promise<NotificationState> => {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'granted') await registerNotificationWorker();
  return permission as NotificationState;
};

/**
 * Affiche une notification.
 *
 * ⚠️ `tag` = l'identifiant de la conversation : dix messages d'affilée REMPLACENT la même
 * notification au lieu d'empiler dix bulles. C'est le comportement d'une messagerie ; sans
 * `tag`, revenir après une heure d'absence noierait le bureau.
 */
export const notify = async ({
  title,
  body,
  icon,
  conversationId,
}: {
  title: string;
  body: string;
  icon?: string | null;
  conversationId: string;
}): Promise<void> => {
  if (notificationState() !== 'granted') return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  await registration
    .showNotification(title, {
      body,
      icon: icon ?? undefined,
      tag: conversationId,
      // ⚠️ Sans `renotify`, un `tag` déjà affiché est remplacé EN SILENCE : le message
      // suivant n'émettrait plus ni son ni vibration, et passerait inaperçu.
      renotify: true,
      data: { url: `/chat/${conversationId}` },
    } as NotificationOptions)
    .catch(() => {});
};
