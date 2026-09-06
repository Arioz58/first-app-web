import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ⚠️ L'indicateur de développement de Next.js se pose EN BAS À GAUCHE par défaut, exactement
   * là où vit désormais l'avatar de profil dans la barre de navigation. Il le recouvre et
   * intercepte les clics — constaté au test, où le survol du profil était impossible.
   *
   * ⚠️ N'a d'effet qu'en DÉVELOPPEMENT : cet indicateur n'existe pas dans un build de
   * production. Le déplacer ne change donc rien pour les utilisateurs, seulement pour nous.
   */
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
