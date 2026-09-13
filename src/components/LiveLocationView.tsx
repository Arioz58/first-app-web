'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { IconClose } from '@/components/icons';
import { backdrop, dialog } from '@/lib/motion';
import { isStale, type LiveLocation } from '@/lib/liveLocation';

/**
 * Carte des positions partagées EN DIRECT dans une conversation.
 *
 * ⚠️ LECTURE seulement : le web ne partage pas sa propre position (voir `lib/liveLocation`).
 *
 * ⚠️ Les tuiles ne sont chargées qu'à l'ouverture de cette fenêtre, jamais dans le fil. Même
 * règle que pour une position ponctuelle : c'est le lecteur qui décide d'aller voir la carte,
 * et donc d'être connu du fournisseur de tuiles.
 */

/** Temps écoulé depuis un relevé, en minutes ou en heures — jamais en secondes : une position
 *  figée se compte en durées longues, et un décompte qui s'égrène donnerait une fausse urgence. */
const ecoule = (iso: string): string => {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
};

/** Zoom retenu quand une seule personne partage — cadrer une seule position n'a pas de sens. */
const SOLO_ZOOM = 15;

export function LiveLocationView({
  shares,
  onClose,
}: {
  shares: LiveLocation[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  /**
   * ⚠️ Les partages sont lus par une REF dans l'effet de carte : ils changent à chaque relevé
   * reçu, et les mettre en dépendance reconstruirait la carte entière toutes les quelques
   * secondes — la vue de l'utilisateur sauterait à chaque fois.
   */
  const sharesRef = useRef(shares);
  // ⚠️ Écrite dans un EFFET et non pendant le rendu (`react-hooks/refs`) : React 19 interdit
  // de toucher à `current` au rendu. L'interval qui redessine la lit toujours à jour.
  useEffect(() => {
    sharesRef.current = shares;
  }, [shares]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !hostRef.current) return;

      const map = L.map(hostRef.current, { zoomControl: true });
      const layer = L.layerGroup().addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      /**
       * Repose les marqueurs à chaque relevé.
       *
       * ⚠️ La VUE n'est ajustée qu'au premier passage : la recadrer à chaque relevé
       * arracherait la carte des mains de quelqu'un en train de la déplacer.
       */
      let framed = false;
      const draw = () => {
        const current = sharesRef.current;
        layer.clearLayers();
        if (!current.length) return;

        current.forEach((s) => {
          const vieux = isStale(s);
          L.circleMarker([s.latitude, s.longitude], {
            radius: 9,
            weight: 3,
            color: '#ffffff',
            // ⚠️ Estompé au-delà de deux minutes : une position qui ne bouge plus doit se
            // voir. Réseau coupé, batterie vide ou application fermée donnent ce symptôme.
            fillColor: vieux ? '#94a3b8' : '#1E40AF',
            fillOpacity: 1,
          })
            .bindTooltip(
              // ⚠️ Le temps écoulé est CALCULÉ et passé au libellé (« Position figée · 4 min »)
              // plutôt que retiré de la phrase : savoir qu'une position est figée sert peu si
              // l'on ignore depuis quand — deux minutes n'ont pas le sens d'une heure.
              vieux
                ? `${s.user.name} · ${t('live.stale', { time: ecoule(s.updatedAt) })}`
                : s.user.name,
              { permanent: true, direction: 'top', offset: [0, -10] },
            )
            .addTo(layer);
        });

        if (framed) return;
        framed = true;
        if (current.length === 1) {
          map.setView([current[0].latitude, current[0].longitude], SOLO_ZOOM);
        } else {
          map.fitBounds(
            L.latLngBounds(current.map((s) => [s.latitude, s.longitude] as [number, number])),
            { padding: [48, 48] },
          );
        }
      };

      draw();
      // Redessiné à chaque relevé reçu, sans reconstruire la carte.
      const timer = setInterval(draw, 1000);

      cleanup = () => {
        clearInterval(timer);
        map.remove();
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [t]);

  return (
    <AnimatePresence>
      <motion.div
        variants={backdrop}
        initial="hidden"
        animate="show"
        exit="exit"
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      >
        <motion.div
          variants={dialog}
          onClick={(e) => e.stopPropagation()}
          className="flex h-[32rem] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        >
          <header className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
              {t('live.title')}
            </h2>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <IconClose size={18} />
            </button>
          </header>
          <div ref={hostRef} className="min-h-0 flex-1" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
