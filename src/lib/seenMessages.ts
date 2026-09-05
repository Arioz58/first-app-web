/**
 * Messages déjà affichés au moins une fois, pour n'animer que les NOUVEAUX.
 *
 * ⚠️ Sans ce registre, chaque page d'historique rapatriée rejouerait trente animations
 * d'entrée d'un coup — un feu d'artifice au moindre défilement vers le haut, là où
 * l'utilisateur veut juste lire. Le mobile a exactement le même mécanisme (`seenIdsRef`).
 *
 * ⚠️ Volontairement HORS de React : c'est une mémoire d'affichage, pas un état. En faire un
 * état déclencherait un rendu à chaque message vu, pour une information dont l'interface n'a
 * besoin qu'une fois, au montage de la bulle.
 *
 * ⚠️ Le registre est vidé au changement de conversation : il grandirait sinon indéfiniment
 * au fil d'une longue session, et rien ne le relit une fois la conversation quittée.
 */
const vus = new Set<string>();

export const dejaVu = (id: string): boolean => vus.has(id);

/** Marque des messages comme déjà vus SANS les animer — l'historique rapatrié. */
export const marquerVus = (ids: string[]): void => {
  for (const id of ids) vus.add(id);
};

export const oublierVus = (): void => vus.clear();
