'use client';

import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import {
  IconAudio,
  IconClose,
  IconDocument,
  IconGif,
  IconLocation,
  IconPhoto,
  IconTimer,
  IconVideo,
} from '@/components/icons';
import type { Quote } from '@/lib/messages';

/**
 * Bloc de citation.
 *
 * DEUX EMPLACEMENTS, UN SEUL COMPOSANT : dans la bulle (au-dessus du contenu) et au-dessus du
 * champ de saisie pendant la rédaction de la réponse. C'est la règle déjà posée sur mobile
 * (`components/QuotedMessage.tsx`) — les laisser diverger, c'est se retrouver avec deux
 * aperçus qui ne résument pas le même message de la même façon.
 *
 * ⚠️ Jusqu'au 13/09 le web n'affichait NI icône NI vignette : répondre à une photo montrait
 * « Pièce jointe », sans le moindre indice de laquelle. La donnée était pourtant déjà servie
 * par l'API (`MESSAGE_SELECT.replyTo` porte `mediaUrl`, `mediaType` et `fileName`) et le
 * mobile s'en servait déjà — il ne manquait que le rendu.
 */

type Summary = { Icon: ComponentType<{ size?: number; className?: string }> | null; label: string };

/** Au-delà, le nom de l'auteur cité est abrégé. */
const QUOTE_NAME_MAX = 8;

/**
 * Nom de l'auteur cité, abrégé.
 *
 * ⚠️ Troncature EXPLICITE et non laissée au CSS : la largeur du bloc dépend de la bulle, donc
 * de la longueur de la RÉPONSE — un même nom apparaissait entier ou coupé selon ce qu'on
 * venait d'écrire, ce qui rendait l'aperçu imprévisible. Une limite fixe donne le même rendu
 * partout, sur téléphone comme sur grand écran.
 *
 * ⚠️ Le caractère « … » et non trois points : c'est UN caractère, il ne se coupe donc jamais
 * en fin de ligne et occupe moins de place.
 */
export const shortQuoteName = (name: string): string =>
  name.length > QUOTE_NAME_MAX ? `${name.slice(0, QUOTE_NAME_MAX)}…` : name;

/**
 * Ce qu'on affiche d'un message cité qui n'a pas de texte.
 *
 * ⚠️ Mêmes libellés et même ordre de priorité que `quoteSummary` du mobile : un message
 * expiré l'emporte sur tout, puis le texte, puis le type de pièce jointe.
 */
export const quoteSummary = (q: Quote, t: (k: string) => string): Summary => {
  if (q.expired) return { Icon: IconTimer, label: t('chat.quote_expired') };
  if (q.content) return { Icon: null, label: q.content };
  switch (q.mediaType) {
    case 'image':
      return { Icon: IconPhoto, label: t('chat.quote_photo') };
    case 'video':
      return { Icon: IconVideo, label: t('chat.quote_video') };
    case 'gif':
      return { Icon: IconGif, label: 'GIF' };
    case 'audio':
      return { Icon: IconAudio, label: t('chat.quote_audio') };
    case 'document':
      // Le nom du fichier dit bien plus que le mot « Document ».
      return { Icon: IconDocument, label: q.fileName || t('chat.quote_document') };
    default:
      break;
  }
  if (q.type === 'location') return { Icon: IconLocation, label: t('chat.quote_location') };
  return { Icon: null, label: '' };
};

export function QuotedPreview({
  quote,
  meId,
  onColored,
  onClick,
  onDismiss,
}: {
  quote: Quote;
  meId?: string | null;
  /** Posé sur une bulle « moi », donc sur un aplat coloré. */
  onColored?: boolean;
  onClick?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const { Icon, label } = quoteSummary(quote, t);
  const author = quote.senderId === meId ? t('chat.quote_you') : shortQuoteName(quote.sender?.name ?? '');
  /**
   * ⚠️ Vignette pour les seules images et GIF. Une vidéo n'a pas d'affiche prête à servir (il
   * faudrait la décoder pour en extraire une frame), et un document n'a rien à montrer : son
   * icône et son nom de fichier sont plus parlants qu'un carré gris.
   */
  const thumb =
    quote.mediaUrl && (quote.mediaType === 'image' || quote.mediaType === 'gif')
      ? quote.mediaUrl
      : null;

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      /**
       * ⚠️ Fond SEMI-TRANSPARENT et non une couleur fixe : ce bloc se pose aussi bien sur une
       * bulle bleue que sur le fond clair du composeur, et une teinte en dur jurerait sur
       * l'un des deux.
       */
      className={`mb-1 flex w-full items-stretch overflow-hidden rounded-lg text-left ${
        onColored ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      {/* Barre latérale : le repère qui dit « ceci est une citation ». */}
      <span className={`w-[3px] shrink-0 ${onColored ? 'bg-white' : 'bg-[#1E40AF]'}`} />
      <span className="min-w-0 flex-1 px-2.5 py-1.5">
        <span
          className={`block truncate text-sm font-semibold ${
            onColored ? 'text-white' : 'text-[#1E40AF]'
          }`}
        >
          {author}
        </span>
        <span className="flex items-center gap-1">
          {Icon && (
            <Icon size={12} className={onColored ? 'text-white/80' : 'text-slate-400'} />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              onColored ? 'text-white/80' : 'text-slate-500 dark:text-zinc-400'
            } ${quote.expired ? 'italic' : ''}`}
          >
            {label}
          </span>
        </span>
      </span>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-10 w-10 shrink-0 object-cover" />
      )}
      {onDismiss && (
        <span
          role="button"
          tabIndex={0}
          aria-label={t('cancel')}
          onClick={(e) => {
            // ⚠️ Sans cela, fermer la citation déclencherait aussi le `onClick` du bloc.
            e.stopPropagation();
            onDismiss();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onDismiss();
          }}
          className="flex shrink-0 items-center px-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
        >
          <IconClose size={16} />
        </span>
      )}
    </Tag>
  );
}
