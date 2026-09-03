import { apiRequest } from './api';
import type { ConvMember } from './messages';

/**
 * Modération et gestion des groupes — portage de `app/group/[id].tsx` du mobile.
 *
 * ⚠️ Les règles ci-dessous sont un MIROIR de celles du serveur (`messages.service.ts`), pas
 * la sécurité elle-même : le backend revérifie tout et refuse par une erreur. Elles servent à
 * ne pas proposer un bouton qui échouera — un contrôle grisé ou absent vaut mieux qu'un 403
 * après le clic. Si l'une des deux change, l'autre doit suivre.
 */

export type Role = 'admin' | 'moderator' | 'member';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  moderator: 'Modérateur',
  member: 'Membre',
};

/** Ajouter ou retirer des membres : admin ET modérateur. */
export const canManageMembers = (myRole?: Role) =>
  myRole === 'admin' || myRole === 'moderator';

/** Renommer, changer la photo/description, régler « qui peut envoyer », changer un rôle : admin seul. */
export const isGroupAdmin = (myRole?: Role) => myRole === 'admin';

/**
 * Puis-je retirer CE membre ?
 *
 * ⚠️ Un modérateur retire tout le monde SAUF un admin — y compris un autre modérateur, ce que
 * le serveur autorise explicitement (seul `target.role === 'admin'` est protégé).
 * ⚠️ Jamais soi-même : le serveur renvoie « Utilisez leave_group pour quitter ». Se retirer
 * de la liste des membres et quitter le groupe sont deux opérations distinctes côté serveur.
 */
export const canRemoveMember = (myRole: Role | undefined, target: ConvMember, meId: string | null) => {
  if (target.userId === meId) return false;
  if (myRole === 'admin') return true;
  return myRole === 'moderator' && target.role !== 'admin';
};

// --- Appels ---

/** Éditer le groupe (admin). Les champs absents ne sont pas écrits. */
export const updateGroup = (
  id: string,
  data: { name?: string; photoUrl?: string | null; description?: string | null },
) => apiRequest(`/conversations/${id}`, { method: 'PATCH', body: data });

/** Changer le rôle d'un membre (admin). Émet un bandeau système côté serveur. */
export const setMemberRole = (id: string, userId: string, role: Role) =>
  apiRequest(`/conversations/${id}/members/${userId}/role`, {
    method: 'PATCH',
    body: { role },
  });

/** Expulser un membre (admin, ou modérateur si la cible n'est pas admin). */
export const removeMember = (id: string, userId: string) =>
  apiRequest(`/conversations/${id}/members/${userId}`, { method: 'DELETE' });

/** Ajouter des membres (admin ou modérateur). Les déjà-membres sont ignorés par le serveur. */
export const addMembers = (id: string, memberIds: string[]) =>
  apiRequest(`/conversations/${id}/members`, { method: 'POST', body: { memberIds } });

/** « Qui peut envoyer des messages » (admin). */
export const setWhoCanSend = (id: string, whoCanSend: 'all' | 'admins') =>
  apiRequest(`/conversations/${id}/settings`, { method: 'PATCH', body: { whoCanSend } });

/**
 * Quitter le groupe.
 *
 * ⚠️ Le serveur promeut le prochain admin si le dernier s'en va — on n'a donc rien à vérifier
 * avant, et surtout rien à empêcher : bloquer le départ du dernier admin laisserait des gens
 * prisonniers de leur propre groupe.
 */
export const leaveGroup = (id: string) =>
  apiRequest(`/conversations/${id}/leave`, { method: 'POST' });
