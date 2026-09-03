# Nexa Web

Client web de la messagerie Nexa (Next.js), troisième repo du projet aux côtés de
`first-app` (mobile Expo) et `first-app-backend`.

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis renseigner l'URL du backend
npm run dev
```

## Configuration

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL du backend. En local `http://localhost:3000`, en production l'URL Railway. |

⚠️ Le préfixe `NEXT_PUBLIC_` est obligatoire : sans lui la variable n'atteint pas le
navigateur et les appels partent vers `undefined`.

## Ce qu'il faut savoir avant de toucher au code

- **Le backend est partagé avec le mobile**, à l'identique : mêmes endpoints, même contrat
  d'authentification (JWT en en-tête `Authorization`, rafraîchissement sur 401). Toute
  évolution d'API doit rester compatible avec les deux clients.
- **Les jetons vivent dans `localStorage`**, pas dans un cookie `httpOnly` — écart assumé
  avec le mobile (qui utilise le trousseau chiffré) et documenté dans `src/lib/storage.ts`.
  ⚠️ Ils sont donc lisibles par tout script de la page : ce qui protège, c'est l'absence de
  XSS. Trois mesures au Mois 5 : CSP stricte, CORS restreint côté backend, et révocation du
  refresh token à la déconnexion (il dure 7 jours et rien ne l'invalide aujourd'hui).
- **L'aiguillage connecté / non connecté se fait côté client**, jamais dans un middleware :
  le serveur ne voit pas `localStorage`.
- `src/lib/api.ts` ne lance **qu'un seul** rafraîchissement à la fois, même quand plusieurs
  requêtes reçoivent un 401 simultanément — le serveur invalide l'ancien jeton à chaque
  usage, et des refresh concurrents déconnecteraient l'utilisateur.
- **Les icônes viennent de `lucide-react`, via `src/components/icons.ts`** — jamais d'emoji
  comme icône d'interface, et jamais d'import direct de lucide dans un composant. Le fichier
  central nomme les concepts (`IconPin`, `IconCheckDouble`…) : une même idée garde le même
  dessin partout, et changer de bibliothèque ne touche qu'un fichier. ⚠️ Un emoji n'est pas
  une icône : son dessin appartient au système d'exploitation, donc « 📌 » n'a pas la même
  allure sur macOS, Windows et Android, et ne s'accorde avec rien autour.
  ⚠️ **Exception : `QUICK_REACTIONS`** (`src/lib/messages.ts`) et l'affichage des réactions
  restent des emojis — ce sont des **données** envoyées au serveur et stockées en base, pas
  de l'habillage. Une icône ne s'y substitue pas.

## État des fonctionnalités

| | Web | Note |
|---|---|---|
| Connexion | QR (principal) + OTP (repli) | le mobile approuve la session |
| Liste des conversations | ✅ | temps réel, filtres, recherche |
| Fil, envoi texte | ✅ | pagination, séparateurs de date, séries |
| Répondre / réagir / épingler / favori | ✅ | |
| Modifier / supprimer | ✅ | 15 min pour modifier, 2 j pour supprimer pour tous |
| Médias (images, vidéos, audio, documents) | ✅ | upload S3 presigned, albums |
| Recherche dans la conversation | ✅ | avec saut vers le message |
| Transférer | ✅ | multi-destinataires, albums entiers |
| Vocaux | ✅ | ⚠️ format selon le navigateur — voir `VoiceRecorder.tsx` |
| Démarrer une conversation, créer un groupe | ✅ | depuis ses amis |
| Présence (« en ligne » / « vu le… ») | ✅ | |
| Accusés de réception et de lecture | ✅ | ✓ / ✓✓ / ✓✓ bleu |
| Aperçus de liens en temps réel | ✅ | résolus par le serveur après l'envoi |
| Bandeau des épinglés, titre d'onglet | ✅ | |
| Panneau de détails (3ᵉ colonne) | ✅ | profil gated, médias, épinglés, favoris, membres, éphémères, bloquer/signaler |
| Archives, mute, épinglage, favori, non lu | ✅ | menu au survol d'une conversation |
| Stories, appels, gestion des groupes | ⏳ | hors périmètre V1 web |
