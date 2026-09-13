'use client';

import { useEffect, useRef } from 'react';

import { IconLocation } from '@/components/icons';

/**
 * Vignette de carte d'un point reçu — chargée UNIQUEMENT sur demande.
 *
 * ⚠️ C'est tout l'objet de ce composant : les tuiles ne partent pas d'elles-mêmes. Une carte
 * affichée d'office dans la bulle livrerait au fournisseur l'adresse IP du DESTINATAIRE et les
 * coordonnées qu'il consulte, alors qu'il n'a rien demandé — même raisonnement que pour les
 * aperçus de liens, résolus côté serveur pour cette raison exacte. Ici, il clique : c'est un
 * choix, et il peut s'en tenir aux coordonnées.
 */
export function LocationMap({ lat, lon }: { lat: number; lon: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    void (async () => {
      // ⚠️ Chargé dynamiquement : Leaflet touche à `window` dès son évaluation, et un import
      // au niveau module casserait le rendu serveur de Next.
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !hostRef.current) return;

      const map = L.map(hostRef.current, {
        /**
         * ⚠️ TOUTE interaction est coupée, et `scrollWheelZoom` en premier : une carte posée
         * au milieu d'un fil de discussion qui capture la molette empêcherait de faire défiler
         * la conversation dès que le curseur la survole. C'est une vignette, pas une carte
         * qu'on explore — pour cela il y a le lien vers l'application de cartes.
         */
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomControl: false,
        attributionControl: true,
      });
      map.setView([lat, lon], 16);

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        // Attribution obligatoire : la contrepartie de tuiles gratuites et sans clé.
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      cleanup = () => map.remove();
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [lat, lon]);

  return (
    <span className="relative block h-40 w-full overflow-hidden rounded-lg">
      <span ref={hostRef} className="block h-full w-full" />
      {/*
        ⚠️ Repère en CSS plutôt qu'un marqueur Leaflet : ses icônes par défaut sont des images
        dont le chemin casse avec un bundler, et la carte étant figée sur le point, un repère
        centré est exactement équivalent.
        ⚠️ `z-[1000]` : Leaflet empile ses couches jusqu'à 800, un élément sans valeur explicite
        passerait derrière les tuiles.
      */}
      <span className="pointer-events-none absolute left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-full">
        <IconLocation size={26} className="text-[#1E40AF] drop-shadow" />
      </span>
    </span>
  );
}
