/**
 * Adresse du backend.
 *
 * ⚠️ Même principe que `lib/config.ts` du mobile, mais pilotée par une variable
 * d'environnement plutôt que par `__DEV__` : sur le web, le même build peut être servi
 * depuis plusieurs environnements, et une constante compilée en dur obligerait à rebuilder
 * pour changer de cible.
 *
 * ⚠️ `NEXT_PUBLIC_` est indispensable : sans ce préfixe la variable n'est pas exposée au
 * navigateur, et les appels partiraient vers `undefined`.
 */
export const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

/** Couleur de marque — identique au mobile (token `nexa`, bleu roi). */
export const NEXA = '#1E40AF';
