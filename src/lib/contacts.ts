import { apiRequest } from './api';

/**
 * Recherche d'une personne par son NUMÉRO — pendant web de `components/AddContactSheet.tsx`.
 *
 * ⚠️ Chemin de niche, comme sur mobile : il sert quand la personne n'est pas dans le
 * répertoire. Le répertoire lui-même n'existe pas sur le web (pas d'accès au carnet
 * d'adresses depuis un navigateur), ce qui fait de cette recherche le seul moyen d'ajouter
 * quelqu'un qu'on ne connaît pas déjà.
 *
 * ⚠️ L'endpoint est RATE-LIMITÉ côté serveur (20 recherches par heure) : c'est une mesure
 * anti-énumération. Ne pas l'appeler à chaque frappe — d'où le délai côté composant.
 */

export type RelationStatus = 'self' | 'friends' | 'request_sent' | 'request_received' | 'none';

export type PhoneCard = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  relationStatus: RelationStatus;
};

export type PhoneSearchResult = { found: false } | { found: true; self: boolean; user: PhoneCard };

export const searchByPhone = (phone: string) =>
  apiRequest<PhoneSearchResult>('/users/search-by-phone', {
    method: 'POST',
    body: { phone },
  });

/** Envoyer une demande d'ami. Le serveur applique le réglage de confidentialité de la cible. */
export const sendFriendRequest = (toUserId: string) =>
  apiRequest('/friends/requests', { method: 'POST', body: { toUserId } });

// --- Recherches récentes ---

/**
 * ⚠️ En `localStorage` et non côté serveur : c'est un confort de saisie, pas une donnée du
 * compte. La stocker en base reviendrait à conserver un historique des numéros cherchés,
 * exactement ce que `POST /users/contacts/match` s'interdit de faire côté mobile.
 */
const KEY = 'nexa.recentPhoneSearches';
const MAX_RECENT = 5;

export type RecentSearch = { id: string; name: string; phone: string; photoUrl: string | null };

export const getRecentSearches = (): RecentSearch[] => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, MAX_RECENT) : [];
  } catch {
    // Stockage bloqué ou contenu illisible : on repart d'une liste vide.
    return [];
  }
};

export const addRecentSearch = (entry: RecentSearch): RecentSearch[] => {
  // Dédoublonné sur l'identifiant : chercher deux fois la même personne ne doit pas
  // l'inscrire deux fois, et la remonte en tête.
  const next = [entry, ...getRecentSearches().filter((r) => r.id !== entry.id)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // L'historique ne survivra pas au rechargement ; la recherche fonctionne quand même.
  }
  return next;
};

export const clearRecentSearches = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Rien à faire : la liste en mémoire est vidée par l'appelant.
  }
};
