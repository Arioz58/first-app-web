# Mise en ligne (preprod)

Le site est un client : il ne sert à rien seul, il parle au **backend Railway**. Trois
choses doivent être alignées, et l'oubli de la troisième est le piège classique.

## 1. Déployer sur Vercel

1. [vercel.com](https://vercel.com) → **Add New… → Project**
2. Importer `Arioz58/first-app-web` (autoriser GitHub si demandé)
3. Vercel détecte Next.js tout seul — **ne rien changer** aux réglages de build
4. Avant de valider, ouvrir **Environment Variables** et ajouter :

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://first-app-backend-production-c2db.up.railway.app` |

   ⚠️ **Sans cette variable, le site cherchera `localhost:3000`** — c'est-à-dire la machine
   du visiteur, pas le serveur. Rien ne fonctionnera, et l'erreur est silencieuse.

5. **Deploy**. L'URL obtenue ressemble à `first-app-web.vercel.app`.

⚠️ Une variable `NEXT_PUBLIC_` est **incluse dans le build** : la modifier plus tard exige
de **redéployer**, un simple redémarrage ne suffit pas.

## 2. Protéger l'accès (facultatif)

Project → **Settings → Deployment Protection → Password Protection**.
Une page demande alors un mot de passe avant d'accéder au site.

⚠️ Cette option demande un **plan Vercel Pro**. Sans elle, l'URL est publique — voir la
note de sécurité plus bas.

## 3. Autoriser l'URL Vercel sur le bucket S3 — **indispensable**

Sans cette étape, le site s'affiche et les messages passent, mais **aucun envoi de photo,
document ou vocal ne fonctionne** : le navigateur bloque le téléversement.

Éditer `infra/s3-cors.json` du repo **first-app-backend** pour ajouter l'URL Vercel :

```json
"AllowedOrigins": [
  "http://localhost:3000",
  "https://first-app-web.vercel.app"
]
```

puis, depuis `first-app-backend/` :

```bash
aws s3api put-bucket-cors \
  --bucket nexa-media-dev-957667616720-eu-north-1-an \
  --cors-configuration file://infra/s3-cors.json
```

ou par la console AWS : S3 → le bucket → **Permissions → CORS**.

⚠️ Vercel crée aussi une URL **par déploiement** (`first-app-web-<hash>.vercel.app`). Seule
l'URL stable est autorisée ici : les aperçus de branche ne pourront pas téléverser. C'est
volontaire — ouvrir le bucket à `*.vercel.app` autoriserait n'importe quel projet Vercel du
monde à y écrire.

## Ce que le client peut faire, et ce qu'il ne peut pas

| | |
|---|---|
| Voir l'interface, naviguer, envoyer des messages | ✅ |
| Envoyer photos, documents, vocaux | ✅ **une fois l'étape 3 faite** |
| Se connecter par QR depuis son téléphone | ✅ si son app mobile pointe sur le même backend |
| Se connecter par numéro | ⚠️ l'OTP est **simulé** : le code n'est pas envoyé par SMS, il s'affiche dans les logs Railway |

## ⚠️ Sécurité — c'est une preprod, pas une production

- **Les données sont réelles** : même base, mêmes conversations que l'app mobile de test.
- **L'OTP est simulé** (pas de Twilio en preprod) : le code est lisible dans les logs
  Railway. En pratique personne d'extérieur ne peut se connecter, mais ce n'est pas une
  barrière de sécurité.
- **CORS backend grand ouvert** (`cors()` sans restriction) et **jetons en `localStorage`** :
  les deux sont notés au `todo` pour le durcissement du Mois 5.
- Avant une vraie production : Twilio, CORS restreint, CSP, révocation des jetons.
