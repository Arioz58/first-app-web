'use client';

import { AudioMessage } from '@/components/AudioMessage';
import { QuotedPreview } from '@/components/QuotedPreview';
import { LocationMap } from '@/components/LocationMap';

import { motion } from 'framer-motion';
import { bubble } from '@/lib/motion';
import { dejaVu, marquerVus } from '@/lib/seenMessages';

import {
  anchorFromEvent,
  FloatingMenu,
  MenuItem,
  type MenuAnchor,
} from '@/components/FloatingMenu';
import {
  IconBlock,
  IconCheck,
  IconCheckDouble,
  IconClock,
  IconCopy,
  IconDocument,
  IconEdit,
  IconForward,
  IconLocation,
  IconMore,
  IconReply,
  IconPin,
  IconStar,
  IconTrash,
} from '@/components/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  emojiCount,
  formatTime,
  QUICK_REACTIONS,
  systemText,
  type Message,
  type Row,
} from '@/lib/messages';
import { formatFileSize } from '@/lib/upload';
import { MessageText } from '@/components/MessageText';

/** Taille d'un message composé uniquement d'emojis — dégressive, comme sur mobile. */
const BIG_EMOJI = [0, 44, 38, 32];

export type BubbleActions = {
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onPin: (m: Message) => void;
  onStar: (m: Message) => void;
  onForward: (m: Message) => void;
  onJumpTo: (messageId: string) => void;
  onOpenMedia: (message: Message) => void;
};

/** Fenêtre de modification, alignée sur le serveur (15 min). */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Une ligne du fil : bulle de texte, album, média, ou message supprimé.
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
  pinned,
  starred,
  canModerate,
  highlighted,
  status,
  actions,
}: {
  row: Row;
  meId: string | null;
  isGroup?: boolean;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
  pinned: boolean;
  starred: boolean;
  canModerate: boolean;
  highlighted: boolean;
  /** État d'acheminement — présent sur ses propres messages seulement. */
  status?: 'sent' | 'delivered' | 'read';
  actions: BubbleActions;
}) {
  const { t } = useTranslation();
  // ⚠️ Tous les hooks AVANT la sortie anticipée des messages système : leur ordre doit être
  // identique à chaque rendu.
  /** Point d'ancrage du menu (`null` = fermé) — voir `FloatingMenu`. */
  const [menuAt, setMenuAt] = useState<MenuAnchor | null>(null);

  const [canEdit, setCanEdit] = useState(false);
  const item = row.messages[0];
  const isMe = item.sender?.id === meId;
  const album = row.messages.length > 1 ? row.messages : null;

  /**
   * Ce message vient-il d'ARRIVER, ou était-il déjà là ?
   *
   * ⚠️ Décidé UNE FOIS au montage (initialiseur paresseux) et non à chaque rendu : la valeur
   * doit rester stable pour toute la vie de la bulle, sinon un simple re-rendu — une réaction
   * posée, un accusé de lecture — rejouerait l'animation d'entrée.
   *
   * ⚠️ Après `item` mais AVANT le retour anticipé du bandeau système : l'ordre des hooks doit
   * être identique à chaque rendu, et l'initialiseur a besoin de l'identifiant du message.
   */
  const [neuf] = useState(() => {
    const jamaisVu = !dejaVu(item.id);
    marquerVus([item.id]);
    return jamaisVu;
  });

  // Bandeau système : son contenu est une clé i18n en JSON, non traduite sur le web.
  /**
   * Bandeau système : centré, sans bulle ni avatar — il n'appartient à personne.
   *
   * ⚠️ Rendu APRÈS tous les hooks, comme la bulle ordinaire : une sortie anticipée placée
   * plus haut changerait le nombre de hooks selon le type de message.
   */
  if (item.type === 'system') {
    const label = systemText(item.content, t);
    // Clé inconnue ou contenu illisible : on n'affiche rien plutôt qu'un bandeau vide.
    if (!label) return null;
    return (
      <div className="my-2 flex justify-center px-6">
        <span className="rounded-full bg-white/85 px-3.5 py-1.5 text-center text-xs text-slate-600 shadow-sm dark:bg-zinc-800/85 dark:text-zinc-300">
          {label}
        </span>
      </div>
    );
  }

  const myReaction = item.reactions?.find((r) => r.userId === meId)?.emoji;
  /**
   * « Modifier » est-il encore possible ?
   *
   * ⚠️ Évalué à l'OUVERTURE du menu, jamais pendant le rendu : `Date.now()` est impur (React
   * 19 l'interdit), et surtout la fenêtre de 15 min expire pendant que la bulle est affichée
   * — une valeur figée au premier rendu serait fausse quelques minutes plus tard.
   *
   * Le serveur reste seul juge : masquer l'entrée est un confort, pas une règle.
   */
  const canEditNow = () =>
    isMe &&
    (item.type ?? 'text') === 'text' &&
    !item.mediaUrl &&
    Date.now() - new Date(item.createdAt).getTime() < EDIT_WINDOW_MS;

  const emojis = !item.mediaUrl && !item.replyTo && !album ? emojiCount(item.content) : 0;
  const big = emojis >= 1 && emojis <= 3;

  return (
    <motion.div
      id={`msg-${item.id}`}
      /**
       * ⚠️ `initial={false}` sur un message DÉJÀ VU : sans cela, chaque page d'historique
       * rapatriée rejouerait trente animations d'entrée d'un coup, alors qu'on remonte
       * justement pour lire.
       */
      initial={neuf ? 'hidden' : false}
      animate="show"
      variants={bubble(isMe)}
      className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'} ${
        firstOfGroup ? 'mt-3' : 'mt-0.5'
      } ${highlighted ? 'rounded-xl bg-yellow-200/40 py-1 transition-colors' : ''}`}
      /**
       * ⚠️ Le clic droit ouvre le menu du message. Sur un message SUPPRIMÉ, on laisse celui
       * du navigateur : il n'y a aucune action à proposer, et l'intercepter pour ne rien
       * montrer donnerait l'impression d'un bug.
       */
      onContextMenu={(e) => {
        if (item.deletedAt) return;
        e.preventDefault();
        e.stopPropagation();
        setCanEdit(canEditNow());
        setMenuAt({ x: e.clientX, y: e.clientY });
      }}
    >
      {!isMe && isGroup && firstOfGroup && (
        <p className="mb-1 pl-1 text-xs font-medium text-slate-400">{item.sender?.name}</p>
      )}

      {(item.forwarded || pinned || starred) && (
        <p className="mb-0.5 flex gap-2 pl-1 text-xs text-slate-400">
          {item.forwarded && (
            <span className="flex items-center gap-1 italic">
              <IconForward size={12} />
              {t('thread.forwarded')}
            </span>
          )}
          {pinned && <IconPin size={12} aria-label={t('thread.pinned')} />}
          {starred && <IconStar size={12} className="fill-current" aria-label={t('details.favorite')} />}
        </p>
      )}

      <div className={`flex items-end gap-1 ${isMe ? 'flex-row-reverse' : ''}`}>
        {item.deletedAt ? (
          <div className="flex items-center gap-1.5 rounded-2xl bg-slate-200 px-4 py-2.5 text-sm italic text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
            <IconBlock size={14} />
            {t('thread.deleted')}
          </div>
        ) : big ? (
          <p style={{ fontSize: BIG_EMOJI[emojis] }} className="px-1 leading-tight">
            {item.content}
          </p>
        ) : (
          /*
            ⚠️ 37.5rem = 600 px, porté de 32rem (512 px) le 13/09.

            Élargir la COLONNE du fil à 1100 px n'avait rien changé aux bulles : `80%` d'un
            conteneur de 1100 px valant 880, le `min` retenait toujours 512. Les bulles
            étaient donc seulement ÉCARTÉES, avec du vide au milieu — d'où « qu'est-ce qui
            change alors ? ».

            ⚠️ Et pas davantage : à la taille de police du fil, 600 px font environ 80
            caractères par ligne, soit la limite haute de ce qui se lit sans effort (la plage
            confortable est 45-75). Au-delà, l'œil peine à retrouver le début de la ligne
            suivante — une bulle plus large serait moins lisible, pas plus « bureau ».
          */
          <div
            className={`max-w-[min(37.5rem,80%)] rounded-2xl px-3.5 py-2 shadow-sm ${
              isMe
                ? 'bg-[#1E40AF] text-white'
                : 'bg-white text-slate-900 dark:bg-zinc-800 dark:text-zinc-100'
            } ${!lastOfGroup ? (isMe ? 'rounded-br-md' : 'rounded-bl-md') : ''}`}
          >
            {/* ⚠️ Même composant qu'au-dessus du champ de saisie : deux aperçus distincts
                finiraient par résumer le même message de deux façons. */}
            {item.replyTo && (
              <QuotedPreview
                quote={item.replyTo}
                meId={meId}
                onColored={isMe}
                onClick={() => actions.onJumpTo(item.replyTo!.id)}
              />
            )}

            <MediaContent
              row={row}
              album={album}
              onOpen={actions.onOpenMedia}
              isMe={isMe}
            />

            {item.linkPreview && (
              <a
                href={item.linkPreview.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`mb-1 block overflow-hidden rounded-lg ${
                  isMe ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'
                }`}
              >
                {item.linkPreview.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.linkPreview.image} alt="" className="h-32 w-full object-cover" />
                )}
                <span className="block px-2 py-1.5">
                  {/* Le DOMAINE d'abord : titre et image viennent du site et peuvent annoncer
                      n'importe quoi, le domaine est le seul repère vérifiable. */}
                  <span className={`block text-xs ${isMe ? 'text-white/70' : 'text-slate-500'}`}>
                    {item.linkPreview.siteName ?? new URL(item.linkPreview.url).hostname}
                  </span>
                  {item.linkPreview.title && (
                    <span className="block text-sm font-semibold">{item.linkPreview.title}</span>
                  )}
                </span>
              </a>
            )}

            {item.content && <MessageText content={item.content} isMe={isMe} />}

            <p className={`mt-0.5 text-right text-[11px] ${isMe ? 'text-white/70' : 'text-slate-400'}`}>
              {item.editedAt && <span className="mr-1 italic">{t('thread.edited')}</span>}
              {formatTime(item.createdAt)}
              {/* Une coche = envoyé, deux = remis, deux bleues = lu. Même échelle que le
                  mobile, pour qu'un même message se lise pareil des deux côtés. */}
              {/* Horloge tant que le serveur n'a pas répondu — l'envoi est en cours. */}
              {item.pendingLocal && (
                <IconClock size={13} className="ml-1 inline align-[-2px]" aria-label={t('thread.sending')} />
              )}
              {status && !item.pendingLocal && (
                <span
                  className={`ml-1 inline-block align-[-2px] ${status === 'read' ? 'text-sky-300' : ''}`}
                  title={t(status === 'read' ? 'thread.read' : status === 'delivered' ? 'thread.delivered' : 'thread.sent')}
                >
                  {status === 'sent' ? <IconCheck size={13} /> : <IconCheckDouble size={13} />}
                </span>
              )}
            </p>
          </div>
        )}

        {/* Actions au survol — pas de menu contextuel sur un message supprimé. */}
        {!item.deletedAt && (
          <div className="opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={(e) => {
                setCanEdit(canEditNow());
                setMenuAt(anchorFromEvent(e));
              }}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-zinc-700"
              aria-label={t('list.actions')}
            >
              <IconMore size={15} />
            </button>

            <FloatingMenu anchor={menuAt} onClose={() => setMenuAt(null)} width={210}>
              {/* ⚠️ Réactions rapides EN TÊTE du menu, comme sur mobile : c'est l'action la
                  plus fréquente, et la reléguer sous six entrées de texte la rendrait plus
                  lente qu'un double-clic. Ce sont des EMOJIS et non des icônes — la réaction
                  est une donnée envoyée au serveur, pas de l'habillage. */}
              <div className="flex justify-between border-b border-slate-100 px-2 py-1.5 dark:border-zinc-700">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      actions.onReact(item, e);
                      setMenuAt(null);
                    }}
                    className={`rounded-full px-1 text-lg hover:bg-slate-100 dark:hover:bg-zinc-700 ${
                      myReaction === e ? 'bg-blue-100 dark:bg-blue-900/40' : ''
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <MenuItem
                icon={IconReply}
                label={t('chat.reply')}
                onClick={() => {
                  actions.onReply(item);
                  setMenuAt(null);
                }}
              />
              {item.content && (
                <MenuItem
                  icon={IconCopy}
                  label={t('chat.copy')}
                  onClick={() => {
                    void navigator.clipboard.writeText(item.content ?? '');
                    setMenuAt(null);
                  }}
                />
              )}
              <MenuItem
                icon={IconForward}
                label={t('chat.forward')}
                onClick={() => {
                  actions.onForward(item);
                  setMenuAt(null);
                }}
              />
              {canEdit && (
                <MenuItem
                  icon={IconEdit}
                  label={t('chat.edit')}
                  onClick={() => {
                    actions.onEdit(item);
                    setMenuAt(null);
                  }}
                />
              )}
              <MenuItem
                icon={IconPin}
                label={t(pinned ? 'chat.unpin' : 'chat.pin')}
                onClick={() => {
                  actions.onPin(item);
                  setMenuAt(null);
                }}
              />
              <MenuItem
                icon={IconStar}
                label={t(starred ? 'chat.unstar' : 'chat.star')}
                onClick={() => {
                  actions.onStar(item);
                  setMenuAt(null);
                }}
              />
              {(isMe || canModerate) && (
                <MenuItem
                  danger
                  icon={IconTrash}
                  label={t('chat.delete')}
                  onClick={() => {
                    actions.onDelete(item);
                    setMenuAt(null);
                  }}
                />
              )}
            </FloatingMenu>
          </div>
        )}
      </div>

      {/* Réactions groupées par emoji, sous la bulle. */}
      {!!item.reactions?.length && (
        <button
          onClick={() => myReaction && actions.onReact(item, myReaction)}
          className="-mt-1 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          title={myReaction ? t('thread.remove_reaction') : undefined}
        >
          {Array.from(new Set(item.reactions.map((r) => r.emoji))).map((e) => {
            const n = item.reactions!.filter((r) => r.emoji === e).length;
            return (
              <span key={e}>
                {e}
                {n > 1 && <span className="ml-0.5 text-slate-500">{n}</span>}
              </span>
            );
          })}
        </button>
      )}
    </motion.div>
  );
}

/** Pièce jointe : album, image, vidéo, audio ou document. */
function MediaContent({
  row,
  album,
  onOpen,
  isMe,
}: {
  row: Row;
  album: Message[] | null;
  /**
   * ⚠️ Reçoit le MESSAGE et non son URL : la visionneuse doit retrouver ce média parmi tous
   * ceux de la conversation, ce qu'une URL seule ne permet pas de faire de façon fiable.
   */
  onOpen: (message: Message) => void;
  isMe: boolean;
}) {
  const { t } = useTranslation();
  const item = row.messages[0];
  /**
   * Carte d'une position, dépliée à la demande.
   *
   * ⚠️ Faux par défaut et RÉINITIALISÉ à chaque message (l'état vit dans le composant de la
   * ligne) : c'est le destinataire qui décide, à chaque fois, de charger des tuiles.
   */
  const [showMap, setShowMap] = useState(false);

  /**
   * Position partagée.
   *
   * ⚠️ Traitée AVANT la sortie sur `mediaUrl` : un message de position n'a pas de pièce
   * jointe, ses coordonnées sont dans ses propres colonnes. C'est pour cela qu'il ne
   * s'affichait pas du tout — la fonction sortait avant de l'avoir regardé, sans rien
   * signaler.
   */
  if (item.type === 'location' && item.latitude != null && item.longitude != null) {
    const { latitude: lat, longitude: lon } = item;
    /**
     * ⚠️ PAS de carte embarquée, volontairement. Une tuile de carte est chargée depuis un
     * service tiers : l'afficher révélerait à ce service l'adresse IP du DESTINATAIRE et les
     * coordonnées qu'il consulte. C'est exactement le raisonnement qui a fait résoudre les
     * aperçus de liens côté SERVEUR (`src/lib/unfurl.ts`). Le lien, lui, n'est suivi que si
     * l'on clique — et c'est alors un choix.
     */
    return (
      <span className="mb-1 block">
        {/*
          ⚠️ La carte n'est chargée QUE si le destinataire la demande : elle n'est pas affichée
          d'office. Voir `LocationMap` — une tuile chargée sans son accord livrerait son
          adresse IP et le lieu consulté au fournisseur de cartes.
        */}
        {showMap && <LocationMap lat={lat} lon={lon} />}

        <a
          href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${
            isMe ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'
          }`}
        >
          <IconLocation size={22} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {/* `content` porte l'adresse lisible, calculée par l'app qui a partagé. */}
              {item.content || t('thread.shared_location')}
            </span>
            <span className="block text-xs opacity-70">
              {lat.toFixed(5)}, {lon.toFixed(5)} · {t('thread.open_in_maps')}
            </span>
          </span>
        </a>

        {!showMap && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMap(true);
            }}
            className={`mt-1 w-full rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              isMe ? 'bg-white/15 hover:bg-white/25' : 'bg-black/5 hover:bg-black/10 dark:bg-white/10'
            }`}
          >
            {t('thread.show_map')}
          </button>
        )}
      </span>
    );
  }

  if (!item.mediaUrl) return null;

  if (album) {
    return (
      <div className="mb-1 grid grid-cols-2 gap-1">
        {album.slice(0, 4).map((m, i) => (
          <button
            key={m.id}
            onClick={() => onOpen(m)}
            className="relative"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.mediaUrl ?? ''}
              alt=""
              className="h-32 w-full rounded-lg object-cover"
            />
            {/* « +N » sur la dernière tuile quand l'album déborde. */}
            {i === 3 && album.length > 4 && (
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-lg font-semibold text-white">
                +{album.length - 4}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  if (item.mediaType === 'image' || item.mediaType === 'gif') {
    return (
      <button onClick={() => onOpen(item)} className="mb-1 block">
        {/*
          ⚠️ PLUS DE `layoutId` (20/09, demande du client) : la photo grandissait depuis sa
          place dans le fil jusqu'au plein écran. Elle s'affiche désormais directement, seul
          le fond noir de la visionneuse arrivant en fondu. Les tuiles d'album suivent, sinon
          la moitié des photos s'ouvrirait d'une façon et l'autre moitié d'une autre.
          → Le procédé reste en place ailleurs : les STORIES s'ouvrent toujours depuis leur
            pastille, et l'indicateur de la barre de navigation glisse d'une icône à l'autre.
        */}
        {/*
          ⚠️ LA LARGEUR EST CONTRAINTE, PAS SEULEMENT LA HAUTEUR (11/09, remarque du client :
          « le format de la photo est visible mais beaucoup en longueur »).

          Seule `max-h-80` était posée : une photo prise au téléphone (9:16) voyait sa hauteur
          ramenée à 320 px, donc sa largeur à 180 — une bande étroite et haute. Une photo
          large, elle, s'étalait sans limite. En fixant la largeur et en plafonnant la hauteur,
          les deux formats occupent une place comparable, comme sur WhatsApp.

          ⚠️ CADRE AGRANDI le 13/09 : 20rem × 30rem (320 × 480) → 25rem × 36rem (400 × 576).
          C'est ici que se jouait vraiment le « sur PC on dirait un téléphone » : une photo
          verticale s'affichait à ~270 × 480, un timbre-poste au milieu de 1100 px de large.

          ⚠️ LES DEUX VALEURS doivent bouger ENSEMBLE. Une photo verticale est limitée par sa
          HAUTEUR : n'élargir que le cadre ne l'aurait pas agrandie d'un pixel. C'est le
          piège exact du correctif du 11/09, où seule la hauteur était contrainte.

          ⚠️ RECADRAGE (20/09, demande du client, qui REVIENT SUR le choix du 13/09).
          J'avais retenu `object-contain` : garder les proportions plutôt que couper un sujet
          sans prévenir. Le client a redemandé après l'élargissement du cadre, en décrivant
          WhatsApp — « la bulle est plus large mais plus petite, et l'image un peu plus zoomée ».

          ⚠️ LA LARGEUR EST FIXE (`w-[25rem]`) ET NON `min(25rem,100%)`, et c'est LÀ qu'était
          le défaut — pas dans `object-contain`. MESURÉ dans un navigateur, sur la structure
          réelle (rangée flex → bulle → image), parce que deux bancs d'essai simplifiés
          donnaient deux résultats contraires :

              min(25rem,100%) + contain ......... 324 × 576   (l'état d'avant)
              min(25rem,100%) + cover ........... 297 × 528   (PIRE : plus étroit encore)
              25rem + max-w-full + cover ........ 400 × 528   ✅

          La bulle est un ÉLÉMENT FLEX : sa largeur vient de son contenu, donc un `100%` à
          l'intérieur se résout contre une largeur INDÉFINIE et la largeur retombe à « auto ».
          CSS la recalcule alors depuis la hauteur plafonnée (CSS 2.1 §10.4) — d'où les 324 px,
          et d'où les 297 quand on ajoute un `min-width` porté par la même expression, qui
          s'effondre pour la même raison. Une largeur FIXE n'est jamais recalculée : la boîte
          reste à 400 et `object-cover` remplit en rognant.

          ⚠️ `max-w-full` reste indispensable pour l'écran étroit — vérifié aussi : la boîte
          descend alors à la largeur disponible (374 px à 390 de fenêtre) sans déborder.

          ⚠️ Hauteur plafonnée à 33rem (528) et non 36rem (576) : 400 × 528 donne un rapport
          proche de 3:4. Une photo 9:16 passe de 324 × 576 à 400 × 528 — plus large, plus
          courte, plus zoomée, les trois mots du client. Une photo PAYSAGE n'est pas touchée
          (16:9 mesuré à 400 × 225, aucun rognage) : rien n'est rogné sans nécessité.

          ⚠️ Le MOBILE n'est pas concerné : `MessageMedia` y pose déjà un carré de 244 avec
          `contentFit="cover"`. Il recadrait depuis toujours — l'écart était propre au web.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.mediaUrl}
          alt=""
          className="h-auto w-[25rem] max-w-full max-h-[33rem] rounded-lg object-cover"
        />
      </button>
    );
  }

  if (item.mediaType === 'video') {
    return (
      <button onClick={() => onOpen(item)} className="mb-1 block">
        {/* ⚠️ Sans `controls` : la vidéo est une VIGNETTE ici, elle se lit dans la
            visionneuse. Des contrôles sur la bulle captureraient le clic et l'on ne pourrait
            plus l'ouvrir en grand ni passer aux médias suivants. */}
        {/* Même cadre que les photos, recadrage compris : une vidéo verticale souffrait du
            même défaut, et deux règles différentes se verraient dans un fil qui mélange les
            deux. */}
        <video
          src={item.mediaUrl}
          className="h-auto w-[25rem] max-w-full max-h-[33rem] rounded-lg object-cover"
        />
      </button>
    );
  }

  if (item.mediaType === 'audio') {
    return <AudioMessage src={item.mediaUrl} durationMs={item.durationMs} mine={isMe} />;
  }

  return (
    <a
      href={item.mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`mb-1 flex items-center gap-2 rounded-lg px-2 py-2 ${
        isMe ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      <IconDocument size={20} className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {item.fileName ?? t('thread.document')}
        </span>
        <span className="block text-xs opacity-70">{formatFileSize(item.fileSize)}</span>
      </span>
    </a>
  );
}
