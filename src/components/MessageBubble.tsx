import { emojiCount, formatTime, type Row } from '@/lib/messages';

/** Taille d'un message composé uniquement d'emojis — dégressive, comme sur mobile. */
const BIG_EMOJI = [0, 44, 38, 32];

/**
 * Une ligne du fil : bulle de texte, album de médias, ou bandeau système.
 *
 * ⚠️ Les règles d'affichage sont celles du mobile — regroupement des séries, nom en tête de
 * série en groupe, heure dans la bulle, emojis larges. Deux clients qui rendraient le même
 * fil différemment se remarqueraient tout de suite.
 */
export function MessageBubble({
  row,
  meId,
  isGroup,
  firstOfGroup,
  lastOfGroup,
}: {
  row: Row;
  meId: string | null;
  isGroup?: boolean;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
}) {
  const item = row.messages[0];
  const isMe = item.sender?.id === meId;
  const album = row.messages.length > 1 ? row.messages : null;

  // Bandeau système : centré, sans bulle. Son contenu est une clé i18n en JSON — non
  // traduite sur le web pour l'instant, donc on n'affiche rien plutôt qu'un objet brut.
  if (item.type === 'system') return null;

  if (item.deletedAt) {
    return (
      <Row isMe={isMe} tight={!firstOfGroup}>
        <div className="rounded-2xl bg-slate-200 px-4 py-2.5 text-sm italic text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
          🚫 Ce message a été supprimé
        </div>
      </Row>
    );
  }

  const emojis = !item.mediaUrl && !item.replyTo && !album ? emojiCount(item.content) : 0;
  const big = emojis >= 1 && emojis <= 3;

  return (
    <Row isMe={isMe} tight={!firstOfGroup}>
      {/* Nom de l'expéditeur : en groupe seulement, et en TÊTE de série. */}
      {!isMe && isGroup && firstOfGroup && (
        <p className="mb-1 pl-1 text-xs font-medium text-slate-400">{item.sender?.name}</p>
      )}

      {item.forwarded && (
        <p className="mb-0.5 pl-1 text-xs italic text-slate-400">↪ Transféré</p>
      )}

      {big ? (
        <p style={{ fontSize: BIG_EMOJI[emojis] }} className="px-1 leading-tight">
          {item.content}
        </p>
      ) : (
        <div
          className={`max-w-[min(32rem,80%)] rounded-2xl px-4 py-2.5 shadow-sm ${
            isMe
              ? 'bg-[#1E40AF] text-white'
              : 'bg-white text-slate-900 dark:bg-zinc-800 dark:text-zinc-100'
          } ${!lastOfGroup ? (isMe ? 'rounded-br-md' : 'rounded-bl-md') : ''}`}
        >
          {item.replyTo && (
            <div
              className={`mb-1.5 rounded-lg border-l-[3px] px-2 py-1 text-sm ${
                isMe ? 'border-white/70 bg-white/15' : 'border-[#1E40AF] bg-black/5 dark:bg-white/10'
              }`}
            >
              <p className={`font-semibold ${isMe ? 'text-white' : 'text-[#1E40AF]'}`}>
                {item.replyTo.sender?.name ?? ''}
              </p>
              <p className={`truncate ${isMe ? 'text-white/80' : 'text-slate-500'}`}>
                {item.replyTo.expired ? 'Message expiré' : item.replyTo.content ?? 'Pièce jointe'}
              </p>
            </div>
          )}

          {album ? (
            <div className="grid grid-cols-2 gap-1 pb-1">
              {album.slice(0, 4).map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={m.mediaUrl ?? ''}
                  alt=""
                  className="h-32 w-full rounded-lg object-cover"
                />
              ))}
            </div>
          ) : item.mediaUrl && (item.mediaType === 'image' || item.mediaType === 'gif') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.mediaUrl}
              alt=""
              className="mb-1 max-h-80 rounded-lg object-cover"
            />
          ) : item.mediaUrl ? (
            <a
              href={item.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block underline"
            >
              {item.fileName ?? 'Pièce jointe'}
            </a>
          ) : null}

          {item.content && <p className="whitespace-pre-wrap break-words">{item.content}</p>}

          <p
            className={`mt-0.5 text-right text-[11px] ${
              isMe ? 'text-white/70' : 'text-slate-400'
            }`}
          >
            {item.editedAt && <span className="mr-1 italic">modifié</span>}
            {formatTime(item.createdAt)}
          </p>
        </div>
      )}

      {/* Réactions : posées sous la bulle, groupées par emoji. */}
      {!!item.reactions?.length && (
        <div className="mt-[-6px] flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          {Array.from(new Set(item.reactions.map((r) => r.emoji))).map((e) => {
            const n = item.reactions!.filter((r) => r.emoji === e).length;
            return (
              <span key={e}>
                {e}
                {n > 1 && <span className="ml-0.5 text-slate-500">{n}</span>}
              </span>
            );
          })}
        </div>
      )}
    </Row>
  );
}

/** Conteneur d'une ligne : alignement selon l'auteur, écart resserré au sein d'une série. */
function Row({
  isMe,
  tight,
  children,
}: {
  isMe: boolean;
  tight: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${tight ? 'mt-0.5' : 'mt-3'}`}
    >
      {children}
    </div>
  );
}
