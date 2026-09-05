'use client';

import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/Avatar';
import { IconSpinner } from '@/components/icons';
import { formatListDate, type Conversation, type Friend } from '@/lib/conversations';
import { conversationName, conversationPhoto } from '@/lib/conversations';
import { type MessageHit } from '@/lib/messages';

/**
 * Résultats de recherche groupés — pendant web de la recherche de l'onglet Discussion.
 *
 * Trois sections, dans cet ordre : Discussions (noms, filtrés en local), Messages (contenu,
 * cherché par le serveur), Contacts (mes amis).
 *
 * ⚠️ L'ordre n'est pas décoratif : on cherche le plus souvent une conversation par son nom,
 * et c'est le résultat le moins coûteux à obtenir. Les messages viennent ensuite parce
 * qu'ils supposent de savoir ce qui a été dit, les contacts en dernier parce qu'ouvrir une
 * conversation avec quelqu'un est une action, pas une navigation.
 */

/** Met en évidence la portion trouvée, pour que le résultat se lise d'un coup d'œil. */
function Highlight({ text, term }: { text: string; term: string }) {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-[#1E40AF] dark:text-blue-400">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length)}
    </>
  );
}

/**
 * Extrait lisible autour de la portion trouvée.
 *
 * ⚠️ Un message peut faire plusieurs paragraphes et le mot cherché se trouver à la fin :
 * afficher le DÉBUT du message ne montrerait pas ce qu'on cherche, et le résultat
 * paraîtrait faux. On recentre donc l'extrait sur la correspondance.
 */
const excerpt = (content: string, term: string): string => {
  const flat = content.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (at <= 40) return flat.slice(0, 120);
  return `…${flat.slice(at - 30, at + 90)}`;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pb-2">
      <h2 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SearchResults({
  term,
  busy,
  conversations,
  hits,
  contacts,
  meId,
  onOpenConversation,
  onOpenMessage,
  onOpenContact,
}: {
  term: string;
  busy: boolean;
  conversations: Conversation[];
  hits: MessageHit[];
  contacts: Friend[];
  meId: string | null;
  onOpenConversation: (conversationId: string) => void;
  onOpenMessage: (conversationId: string, messageId: string) => void;
  onOpenContact: (userId: string) => void;
}) {
  const { t } = useTranslation();

  /**
   * Nom et photo d'un résultat de message.
   *
   * ⚠️ En conversation directe, l'autre participant — jamais `members[0]`, qui peut être moi
   * (même règle que `otherMember`, et même bug déjà rencontré dans la feuille de transfert).
   */
  const hitIdentity = (hit: MessageHit) => {
    const conv = hit.conversation;
    if (conv.type === 'group') return { name: conv.name ?? '', photoUrl: conv.photoUrl };
    const other = conv.members.find((m) => m.userId !== meId)?.user;
    return { name: other?.name ?? '', photoUrl: other?.photoUrl ?? null };
  };

  const empty = !conversations.length && !hits.length && !contacts.length;

  return (
    <div className="pb-4">
      {conversations.length > 0 && (
        <Section title={t('search.section_chats')}>
          <ul>
            {conversations.map((c) => {
              const name = conversationName(c, meId);
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenConversation(c.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
                  >
                    <Avatar name={name} photoUrl={conversationPhoto(c, meId)} size={40} />
                    <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-zinc-100">
                      <Highlight text={name} term={term} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {hits.length > 0 && (
        <Section title={t('search.section_messages')}>
          <ul>
            {hits.map((hit) => {
              const { name, photoUrl } = hitIdentity(hit);
              return (
                <li key={hit.id}>
                  <button
                    onClick={() => onOpenMessage(hit.conversationId, hit.id)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
                  >
                    <Avatar name={name} photoUrl={photoUrl} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-zinc-100">
                          {name}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {formatListDate(hit.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-slate-500 dark:text-zinc-400">
                        <Highlight text={excerpt(hit.content ?? '', term)} term={term} />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {contacts.length > 0 && (
        <Section title={t('search.section_contacts')}>
          <ul>
            {contacts.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => onOpenContact(f.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  <Avatar name={f.name} photoUrl={f.photoUrl} size={40} />
                  <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-zinc-100">
                    <Highlight text={f.name} term={term} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ⚠️ « Aucun résultat » seulement une fois la recherche TERMINÉE : l'afficher pendant
          la frappe ferait clignoter un démenti à chaque lettre. */}
      {empty &&
        (busy ? (
          <div className="flex justify-center py-10 text-slate-400">
            <IconSpinner size={20} className="animate-spin" />
          </div>
        ) : (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{t('common.no_results')}</p>
        ))}
    </div>
  );
}
