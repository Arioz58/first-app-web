'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Texte d'un message : liens cliquables et formatage `*gras*` / `_italique_` / `~barré~`.
 *
 * ⚠️ Les liens sont extraits AVANT le formatage. Une URL contient très souvent des
 * underscores (`…/mon_article_2024`), qui seraient sinon lus comme des marqueurs d'italique
 * et couperaient le lien en morceaux — chacun devenant incliquable. Même règle que le mobile.
 */

const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

const MARKS: { char: string; className: string }[] = [
  { char: '*', className: 'font-bold' },
  { char: '_', className: 'italic' },
  { char: '~', className: 'line-through' },
  { char: '`', className: 'font-mono text-[0.92em]' },
];

/**
 * Découpe un fragment selon les marqueurs de formatage.
 *
 * ⚠️ Le marqueur ne compte que s'il ENCADRE du texte sans espace adjacent : sans cette
 * garde, `snake_case_name` deviendrait italique et `3 * 4 * 5` gras.
 */
function parseMarks(text: string, key: string): ReactNode[] {
  for (const { char, className } of MARKS) {
    const esc = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}(?![\\s${esc}])([^${esc}\\n]*[^\\s${esc}])${esc}`);
    const m = re.exec(text);
    if (!m || m.index === undefined) continue;
    return [
      ...(m.index > 0 ? parseMarks(text.slice(0, m.index), `${key}b`) : []),
      <span key={`${key}m`} className={className}>
        {parseMarks(m[1], `${key}i`)}
      </span>,
      ...parseMarks(text.slice(m.index + m[0].length), `${key}a`),
    ];
  }
  return text ? [text] : [];
}

export function MessageText({ content, isMe }: { content: string; isMe: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  /**
   * ⚠️ MESURÉ et non deviné à partir de la longueur : une même chaîne occupe un nombre de
   * lignes différent selon la largeur de la bulle, la langue et la taille de police. Un seuil
   * en caractères replierait des messages courts sur écran large, et en laisserait passer de
   * très longs sur écran étroit.
   */
  const [overflows, setOverflows] = useState(false);
  /** Miroir lisible par l'observateur, qui est posé une fois pour toutes. */
  const expandedRef = useRef(false);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /**
     * ⚠️ Ré-mesuré à chaque changement de LARGEUR, contrairement au mobile qui mesure une
     * fois : sur le web la fenêtre se redimensionne, et un message qui tenait en huit lignes
     * en plein écran en occupe douze dans une fenêtre étroite.
     *
     * ⚠️ Jamais pendant que le message est DÉPLIÉ : le repli est alors levé, donc plus rien
     * ne déborde — on en conclurait qu'il n'y a pas de débordement et le bouton
     * disparaîtrait sous le doigt.
     */
    const measure = () => {
      if (expandedRef.current) return;
      // Tolérance d'un pixel : les hauteurs de ligne fractionnaires font parfois dépasser
      // `scrollHeight` d'une poussière sans qu'aucune ligne ne soit réellement coupée.
      setOverflows(el.scrollHeight - el.clientHeight > 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of content.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) nodes.push(...parseMarks(content.slice(last, start), `t${i}`));
    const url = m[0];
    nodes.push(
      <a
        key={`u${i}`}
        href={url.startsWith('www.') ? `https://${url}` : url}
        target="_blank"
        // ⚠️ `noopener noreferrer` : sans lui, la page ouverte peut manipuler celle-ci via
        // `window.opener`, et le référent divulguerait l'URL de la conversation.
        rel="noopener noreferrer"
        // Empêche l'ouverture du menu de la bulle en cliquant sur le lien.
        onClick={(e) => e.stopPropagation()}
        className={`underline ${isMe ? 'text-white' : 'text-[#1E40AF] dark:text-blue-400'}`}
      >
        {url}
      </a>,
    );
    last = start + url.length;
    i++;
  }
  if (last < content.length) nodes.push(...parseMarks(content.slice(last), `t${i}`));

  /**
   * ⚠️ Le repli est posé DÈS LE DÉPART, pas seulement une fois le débordement constaté.
   * C'est ce qui rend la mesure possible : `scrollHeight > clientHeight` ne veut dire quelque
   * chose que sur un élément déjà borné. En attendant d'avoir détecté le débordement pour
   * replier, on mesurait un paragraphe libre — jamais en dépassement, donc jamais replié.
   *
   * Sur un message court, le repli à huit lignes ne change rien : il en occupe une.
   */
  const clamped = !expanded;

  return (
    <>
      <p
        ref={ref}
        /**
         * ⚠️ `line-clamp-8` en toutes lettres : Tailwind lit les classes dans le SOURCE, une
         * classe construite à l'exécution ne serait jamais générée. Le 8 doit rester aligné
         * sur `CLAMP_LINES` de `components/MessageText.tsx` côté mobile.
         */
        className={`whitespace-pre-wrap break-words ${clamped ? 'line-clamp-8' : ''}`}
      >
        {nodes}
      </p>
      {overflows && (
        <button
          // ⚠️ `stopPropagation` : sans lui, déplier le message ouvrirait aussi le menu de la
          // bulle, qui écoute le clic sur toute sa surface.
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className={`mt-0.5 text-sm font-semibold ${
            isMe ? 'text-white/90 hover:text-white' : 'text-[#1E40AF] dark:text-blue-400'
          }`}
        >
          {expanded ? 'Voir moins' : 'Voir plus'}
        </button>
      )}
    </>
  );
}
