'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IconClose, IconLocation, IconSpinner } from '@/components/icons';
import { backdrop, dialog } from '@/lib/motion';
import { reverseGeocode } from '@/lib/geocode';

/**
 * Choix d'un point sur une carte, avant envoi — pendant web de `components/LocationPicker.tsx`.
 *
 * ⚠️ La carte n'apparaît qu'À L'ENVOI, jamais à la réception. Charger des tuiles dans la bulle
 * d'un destinataire livrerait son adresse IP et les coordonnées qu'il consulte au fournisseur
 * de cartes, alors qu'il n'a rien demandé — c'est le raisonnement qui a fait résoudre les
 * aperçus de liens côté serveur. Ici, c'est l'expéditeur qui ouvre une carte de son plein gré.
 *
 * ⚠️ OpenStreetMap et non Google Maps : aucune clé d'API, donc rien à provisionner ni à
 * facturer. (Une clé Google restera nécessaire pour la carte ANDROID, où react-native-maps
 * l'exige — mais c'est un sujet distinct.)
 */

/** Zoom d'arrivée : assez proche pour distinguer une rue, assez large pour se repérer. */
const ZOOM = 16;

/** Repère de repli quand la position est refusée — Istanbul, le marché visé. */
const FALLBACK: [number, number] = [41.0082, 28.9784];

export function LocationPicker({
  open,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** `address` vaut `null` quand le géocodage n'a rien donné : le message part sans. */
  onSend: (lat: number, lon: number, address: string | null) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  /**
   * ⚠️ Leaflet est chargé DYNAMIQUEMENT, dans l'effet : il touche à `window` dès son
   * évaluation, et un import au niveau module casserait le rendu serveur de Next.
   */
  useEffect(() => {
    if (!open || !hostRef.current) return;
    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !hostRef.current) return;

      const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true });
      mapRef.current = map;
      map.setView(FALLBACK, ZOOM);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        // ⚠️ Attribution OBLIGATOIRE : c'est la contrepartie de tuiles gratuites et sans clé.
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      /**
       * ⚠️ Le géocodage est relancé à chaque repos de la carte, jamais pendant le geste :
       * `moveend` ne se déclenche qu'à l'arrêt. Interroger le service à chaque image
       * épuiserait sa limite d'usage en quelques secondes de déplacement.
       */
      const onMoved = () => {
        const c = map.getCenter();
        setCenter([c.lat, c.lng]);
        // ⚠️ L'ancienne adresse est effacée DÈS le déplacement : la garder afficherait le nom
        // d'une rue pour un point qu'on a déjà quitté. C'est un gestionnaire d'événement, pas
        // un effet — l'endroit légitime pour poser un état.
        setAddress(null);
      };
      map.on('moveend', onMoved);
      onMoved();

      // Position réelle si elle est accordée ; sinon on reste sur le repli, la carte est
      // déplaçable de toute façon.
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          if (!cancelled) map.setView([pos.coords.latitude, pos.coords.longitude], ZOOM);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 },
      );

      cleanup = () => {
        map.off('moveend', onMoved);
        map.remove();
        mapRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open]);

  /** Adresse du point visé, avec un délai : on ne géocode que ce sur quoi on s'arrête. */
  useEffect(() => {
    if (!center) return;
    const [lat, lon] = center;
    // ⚠️ `setLooking` est posé DANS le délai et non dans le corps de l'effet
    // (`react-hooks/set-state-in-effect`) : un état écrit synchroniquement au montage
    // déclenche un second rendu en cascade avant même la peinture.
    const timer = setTimeout(() => {
      setLooking(true);
      void reverseGeocode(lat, lon)
        .then((a) => setAddress(a))
        .catch(() => setAddress(null))
        .finally(() => setLooking(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [center]);

  return (
    <AnimatePresence>
      {open && (
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
                {t('location.send_title')}
              </h2>
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <IconClose size={18} />
              </button>
            </header>

            <div className="relative min-h-0 flex-1">
              <div ref={hostRef} className="h-full w-full" />

              {/*
                ⚠️ Le repère est FIXE au centre et c'est la carte qui bouge dessous — même
                choix que sur mobile : viser un marqueur au doigt (ou à la souris) est
                pénible, et l'on perd le point sous le curseur.
                ⚠️ `pointer-events-none` : sans cela, le repère intercepterait le glissement
                et la carte deviendrait immobile en son centre exact.
                ⚠️ Décalé vers le haut de sa demi-hauteur pour que sa POINTE tombe sur le
                centre réel, et non son milieu.
                ⚠️ `z-[1000]` INDISPENSABLE : Leaflet empile ses propres couches avec des
                z-index élevés (tuiles 200, marqueurs 600, contrôles 800). Sans valeur
                explicite, le repère passe DERRIÈRE la carte et reste invisible — il était
                bien positionné, simplement recouvert.
              */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-full">
                <IconLocation size={32} className="text-[#1E40AF] drop-shadow" />
              </div>
            </div>

            <footer className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-zinc-800">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-zinc-400">
                {looking ? (
                  <span className="flex items-center gap-1.5">
                    <IconSpinner size={13} className="animate-spin" />
                    {t('location.searching')}
                  </span>
                ) : (
                  address ??
                  (center ? `${center[0].toFixed(5)}, ${center[1].toFixed(5)}` : '')
                )}
              </span>
              <button
                disabled={!center}
                onClick={() => {
                  if (!center) return;
                  onSend(center[0], center[1], address);
                  onClose();
                }}
                className="shrink-0 rounded-xl bg-[#1E40AF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('location.send_action')}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
