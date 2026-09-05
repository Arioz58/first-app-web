/**
 * Service worker minimal — il ne sert QU'AUX NOTIFICATIONS.
 *
 * ⚠️ Aucun gestionnaire `fetch`, volontairement : dès qu'un service worker intercepte les
 * requêtes, il devient responsable du cache de toute l'application, et une version périmée
 * servie depuis ce cache est le défaut le plus pénible à diagnostiquer. Ici il ne fait que
 * porter les notifications et réagir au clic.
 *
 * ⚠️ Passer par le service worker plutôt que par `new Notification()` : ce constructeur
 * n'existe pas sur Chrome Android (il lève une exception), et surtout lui seul permet au
 * clic de RETROUVER l'onglet déjà ouvert au lieu d'en ouvrir un second.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      /**
       * ⚠️ On réutilise une fenêtre EXISTANTE. Ouvrir systématiquement un nouvel onglet
       * laisserait deux instances de la messagerie côte à côte, chacune avec son socket.
       */
      for (const fenetre of fenetres) {
        if ('focus' in fenetre) {
          await fenetre.focus();
          if ('navigate' in fenetre) await fenetre.navigate(url).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
