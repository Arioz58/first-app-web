/**
 * Vocabulaire d'icônes de l'app web — un seul endroit qui nomme les concepts.
 *
 * Les composants importent `IconPin`, jamais `Pin` de lucide directement. Deux raisons :
 * changer de bibliothèque ne touche alors que ce fichier, et surtout une même idée garde le
 * même dessin partout (l'épingle de la liste des conversations est celle de la bulle et celle
 * du panneau de détails). C'est exactement ce que les emojis ne garantissaient pas : « 📌 »
 * n'a pas le même dessin sur macOS, Windows et Android.
 *
 * ⚠️ Les icônes lucide sont des SVG à trait, comme les Ionicons du mobile — elles héritent de
 * `currentColor` et de la taille de police. On ne fixe donc PAS de couleur ici : c'est la
 * classe Tailwind du parent qui décide, y compris en mode sombre.
 *
 * ⚠️ Ne pas y ajouter les EMOJIS DE RÉACTION (`QUICK_REACTIONS`) : ce sont des données
 * envoyées au serveur et stockées en base, pas de l'habillage. Une icône ne s'y substitue pas.
 */

export {
  // Conversation
  Pin as IconPin,
  PinOff as IconUnpin,
  Star as IconStar,
  Bell as IconBell,
  BellOff as IconBellOff,
  Archive as IconArchive,
  Search as IconSearch,
  Phone as IconPhone,
  Video as IconVideo,
  Users as IconUsers,
  MapPin as IconLocation,
  // Composeur
  Mic as IconMic,
  Paperclip as IconAttach,
  SendHorizontal as IconSend,
  Smile as IconEmoji,
  Plus as IconPlus,
  // ⚠️ `LoaderCircle` et non `Loader2` : ce dernier est un alias hérité, gardé pour la
  // compatibilité mais absent de la documentation courante.
  LoaderCircle as IconSpinner,
  // Statuts d'envoi — `CheckCheck` est la double coche des accusés, dessinée pour ça.
  Check as IconCheck,
  CheckCheck as IconCheckDouble,
  Clock as IconClock,
  // Actions
  X as IconClose,
  ArrowLeft as IconBack,
  ArrowUp as IconUp,
  ArrowDown as IconDown,
  CornerUpRight as IconForward,
  Ban as IconBlock,
  LockOpen as IconUnblock,
  Flag as IconReport,
  Trash2 as IconTrash,
  // Médias
  Image as IconPhoto,
  FileText as IconDocument,
  MessageSquare as IconChat,
} from 'lucide-react';
