import { apiRequest } from './api';

/**
 * Adresse lisible d'un point — résolue par NOTRE serveur.
 *
 * ⚠️ Le navigateur n'a pas de géocodage inverse natif, contrairement au téléphone qui le fait
 * hors ligne avec les services de l'OS. Interroger un service tiers directement depuis la page
 * lui livrerait la position exacte de l'utilisateur et son adresse IP : le serveur s'en charge,
 * comme pour les GIF et les aperçus de liens.
 *
 * ⚠️ Un échec ne remonte pas : l'adresse est un confort, les coordonnées suffisent à situer le
 * point. L'appelant reçoit `null` et le message part sans.
 */
export const reverseGeocode = async (lat: number, lon: number): Promise<string | null> => {
  const lang = (navigator.language || 'fr').slice(0, 5);
  const { address } = await apiRequest<{ address: string | null }>(
    `/geocode/reverse?lat=${lat}&lon=${lon}&lang=${encodeURIComponent(lang)}`,
  );
  return address;
};
