import type { ReactNode } from 'react';

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

  return <p className="whitespace-pre-wrap break-words">{nodes}</p>;
}
