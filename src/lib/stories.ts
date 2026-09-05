import { apiRequest } from './api';

/**
 * Stories — portage web de `lib/storyBackgrounds.ts` et `lib/storyText.ts` (mobile).
 *
 * ⚠️ Les valeurs stockées en base sont des IDENTIFIANTS DE PRESET (`background: 'sunset'`) et
 * des positions NORMALISÉES (`normX`/`normY` entre 0 et 1), jamais des pixels ni des
 * couleurs. C'est ce qui permet à une story créée sur un iPhone de s'afficher correctement
 * dans un navigateur de 2560 px de large. Les deux plateformes doivent donc résoudre les
 * MÊMES identifiants vers les MÊMES couleurs : toute divergence ici et la même story n'a pas
 * la même tête selon l'écran.
 */

export type StoryTextItem = {
  content: string;
  kind?: 'text' | 'sticker';
  normX: number;
  normY: number;
  scale: number;
  /** En RADIANS, comme sur mobile — converti en degrés seulement au moment du rendu CSS. */
  rotation: number;
  color: string;
  bgMode: 'none' | 'translucent' | 'solid';
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type Story = {
  id: string;
  userId: string;
  mediaUrl: string | null;
  background: string | null;
  texts: StoryTextItem[] | null;
  createdAt: string;
  expiresAt: string;
  viewed?: boolean;
  viewCount?: number;
};

export type StoryGroup = {
  user: { id: string; name: string; photoUrl: string | null };
  stories: Story[];
  hasUnviewed: boolean;
};

/**
 * Une vue de story.
 *
 * ⚠️ La personne est IMBRIQUÉE sous `viewer`, la ligne elle-même portant l'identifiant de la
 * vue et sa date. Aplatir ce type « pour simplifier » donnait des noms vides à l'écran, avec
 * un compteur pourtant juste — le genre d'écart qu'aucune vérification de type ne rattrape,
 * puisque les deux formes sont du JSON valide.
 */
export type StoryView = {
  id: string;
  createdAt: string;
  viewer: { id: string; name: string; photoUrl: string | null };
};

/**
 * ⚠️ Les stories sont réordonnées de la PLUS ANCIENNE à la plus récente.
 *
 * Le serveur les renvoie en `createdAt: 'desc'` — pratique pour construire la barre, faux
 * pour la lecture : on regarde une story comme on lit, dans l'ordre où elle a été publiée.
 * Le mobile applique déjà ce tri de son côté (`oldestFirst` dans `app/story/[id].tsx`), et
 * sans lui les deux clients racontent la même journée à l'envers l'un de l'autre.
 *
 * ⚠️ Tri STABLE plutôt que comparaison de dates seules : deux stories publiées dans la même
 * seconde ont le même `createdAt`, et un tri par date les laisserait dans un ordre arbitraire.
 * Le serveur ayant déjà trié en décroissant, inverser suffit et reste déterministe.
 */
const oldestFirst = <T extends { createdAt: string }>(stories: T[]): T[] => [...stories].reverse();

export const fetchStories = () =>
  apiRequest<StoryGroup[]>('/stories').then((groups) =>
    groups.map((g) => ({ ...g, stories: oldestFirst(g.stories) })),
  );

export const fetchMyStories = () => apiRequest<Story[]>('/stories/me').then(oldestFirst);
export const markStoryViewed = (storyId: string) =>
  apiRequest(`/stories/${storyId}/view`, { method: 'POST' });
export const fetchStoryViewers = (storyId: string) =>
  apiRequest<StoryView[]>(`/stories/${storyId}/views`);
export const deleteStory = (storyId: string) =>
  apiRequest(`/stories/${storyId}`, { method: 'DELETE' });

// --- Fonds (miroir exact de `lib/storyBackgrounds.ts`) ---

export const STORY_BACKGROUNDS: { id: string; colors: string[] }[] = [
  { id: 'noir', colors: ['#000000'] },
  { id: 'nexa', colors: ['#1E40AF'] },
  { id: 'sunset', colors: ['#FF5F6D', '#FFC371'] },
  { id: 'ocean', colors: ['#2193B0', '#6DD5ED'] },
  { id: 'purple', colors: ['#667EEA', '#764BA2'] },
  { id: 'night', colors: ['#0F2027', '#2C5364'] },
  { id: 'peach', colors: ['#ED4264', '#FFEDBC'] },
  { id: 'mint', colors: ['#11998E', '#38EF7D'] },
];

/**
 * Fond CSS d'un preset. Repli sur le premier preset, comme le mobile — une story dont le
 * fond aurait été retiré du catalogue doit rester lisible, pas disparaître.
 */
export const backgroundCss = (id?: string | null): string => {
  const colors = STORY_BACKGROUNDS.find((b) => b.id === id)?.colors ?? STORY_BACKGROUNDS[0].colors;
  // ⚠️ 135deg = diagonale haut-gauche → bas-droite, l'équivalent du dégradé mobile.
  return colors.length === 1 ? colors[0] : `linear-gradient(135deg, ${colors.join(', ')})`;
};

// --- Textes (miroir de `lib/storyText.ts`) ---

/** Noir ou blanc selon la luminance du fond, pour que le texte reste lisible. */
const pickContrast = (hex: string): string => {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#000000' : '#FFFFFF';
};

const SHADOW = '1px 1px 4px rgba(0,0,0,0.8)';

/**
 * Style CSS d'un texte de story.
 *
 * ⚠️ `fontSize` est exprimé en proportion de la HAUTEUR du cadre, pas en pixels fixes : le
 * mobile pose 22 px sur un écran d'environ 800 px de haut. En dur, le même texte serait
 * minuscule dans une visionneuse de navigateur et déborderait sur un petit écran.
 */
export const textStyle = (
  item: StoryTextItem,
  frameHeight: number,
): { wrapper: React.CSSProperties; text: React.CSSProperties } => {
  const MOBILE_FONT = 22;
  const MOBILE_FRAME = 800;
  const size = (MOBILE_FONT / MOBILE_FRAME) * frameHeight;

  const bubble: React.CSSProperties = {
    padding: `${size * 0.36}px ${size * 0.64}px`,
    borderRadius: size * 0.45,
  };

  if (item.kind === 'sticker') {
    // Un sticker est un emoji nu : ni bulle, ni ombre, ni couleur.
    return { wrapper: {}, text: { fontSize: size * 2.2, lineHeight: 1.1 } };
  }

  const commun: React.CSSProperties = {
    fontSize: size,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? 'italic' : 'normal',
    textDecoration: item.underline ? 'underline' : 'none',
    textAlign: 'center',
    lineHeight: 1.25,
    whiteSpace: 'pre-wrap',
  };

  if (item.bgMode === 'solid') {
    return {
      wrapper: { ...bubble, background: item.color },
      text: { ...commun, color: pickContrast(item.color) },
    };
  }
  if (item.bgMode === 'none') {
    return { wrapper: bubble, text: { ...commun, color: item.color, textShadow: SHADOW } };
  }
  return {
    wrapper: { ...bubble, background: 'rgba(0,0,0,0.45)' },
    text: { ...commun, color: item.color, textShadow: SHADOW },
  };
};

/**
 * Palette de l'éditeur — reprise telle quelle de `lib/storyText.ts` (mobile).
 *
 * ⚠️ Ce sont des couleurs PERSISTÉES avec la story : proposer une palette différente d'un
 * client à l'autre ne casserait rien, mais une story composée sur le web ne serait plus
 * modifiable à l'identique sur le téléphone.
 */
export const STORY_COLORS = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00',
  '#34C759', '#00C7BE', '#0A84FF', '#5856D6', '#AF52DE',
  '#FF2D55', '#A2845E',
];

/** Publie une story. `mediaUrl` OU `background` — le serveur refuse les deux absents. */
export const createStory = (body: {
  mediaUrl?: string;
  background?: string;
  texts?: StoryTextItem[];
}) => apiRequest<Story>('/stories', { method: 'POST', body });

/** Une story est-elle une vidéo ? Déduit de l'extension, `.mp4` étant garanti par l'upload. */
export const isVideoStory = (story: Story): boolean => /\.(mp4|mov)($|\?)/i.test(story.mediaUrl ?? '');

/** Âge affiché : minutes en deçà d'une heure, heures ensuite — comme le mobile. */
export const storyAge = (iso: string): string => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
};
