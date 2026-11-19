# Le guide : installer ton auto-DM Instagram

Sept étapes, environ 45 minutes la première fois. À la fin, ton bot répond tout seul à chaque commentaire qui contient ton mot-clé.

## Avant de commencer

- Un compte Instagram **professionnel** (Créateur ou Entreprise).
- Un ordinateur avec **Node.js** (la version LTS sur [nodejs.org](https://nodejs.org)). Il ne sert qu'à l'installation.
- Un compte **Cloudflare** gratuit : [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
- Un compte **Meta for Developers** gratuit : [developers.facebook.com](https://developers.facebook.com).

**Le plus simple : fais-le avec ton agent IA.** Ouvre ce dossier dans Claude Code (ou ton agent IA préféré) et colle-lui ce message :

> Je veux installer ce bot d'auto-DM Instagram. Lis le GUIDE.md et les fichiers du dossier, puis accompagne-moi étape par étape : lance toi-même les commandes du terminal quand c'est possible, dis-moi exactement où cliquer dans Cloudflare et dans Meta, attends ma confirmation avant chaque étape suivante, et aide-moi si j'ai une erreur. Ne me demande jamais mes mots de passe ni mes jetons : je les colle moi-même quand le terminal les demande.

---

## Étape 1 : mets le bot en ligne

Ouvre un terminal dans ce dossier, puis :

```bash
npm install
```

```bash
npm run installer
```

L'installateur te connecte à Cloudflare (une page s'ouvre, tu acceptes), te demande ton nom et ton email (pour la page de confidentialité), crée ta base de données et met le bot en ligne. Il finit par afficher :

- **ton interface** et **sa clé** ;
- **l'URL de rappel** et **le jeton de vérification** pour Meta ;
- **l'adresse de ta page de confidentialité**.

Tout est aussi gardé dans `mes-codes.txt`, dans ce dossier. Ne le partage pas (il n'est jamais envoyé sur GitHub : il est dans le `.gitignore`).

À la question « As-tu déjà ton jeton Instagram ? », réponds `n` : on le crée à l'étape suivante.

## Étape 2 : crée ton app Meta et ton jeton

1. Sur [developers.facebook.com](https://developers.facebook.com) : **Mes apps → Créer une app**.
2. Donne-lui un nom (par exemple « Auto-DM »), puis choisis le cas d'usage **Gérer les messages et le contenu sur Instagram**.
3. Ouvre la configuration de l'**API avec la connexion Instagram** (pas la connexion Facebook).
4. Vérifie que ces trois autorisations sont ajoutées : `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.
5. En haut de la page, repère la **clé secrète de l'app Instagram** (bouton Afficher). Garde-la de côté.
6. Dans **Générer des jetons d'accès**, ajoute ton compte Instagram, accepte, puis génère le jeton. Il commence par `IGAA`. C'est une clé secrète : ne la montre à personne.

## Étape 3 : donne le jeton au bot

```bash
npm run installer -- --jeton
```

Colle la clé secrète de l'app, puis le jeton. Ils ne sont écrits nulle part dans le dossier : ils partent directement dans les secrets de ton bot chez Cloudflare.

## Étape 4 : relie Meta à ton bot

Toujours dans la configuration de l'API avec la connexion Instagram, partie **Configurer les webhooks** :

1. **URL de rappel** : l'adresse donnée par l'installateur, qui finit par `/webhook`.
2. **Jeton de vérification** : celui de l'installateur (`VERIFY_TOKEN` dans `mes-codes.txt`).
3. Clique sur **Vérifier et enregistrer**.
4. Abonne-toi aux champs **comments**, **messages** et **messaging_postbacks**.

Puis, dans **Paramètres de l'app → Paramètres de base** : mets l'adresse de ta page de confidentialité (elle finit par `/confidentialite`) comme URL de la politique de confidentialité, et aussi comme URL des instructions de suppression des données si Meta la demande.

## Étape 5 : autorise les messages sur ton téléphone

Dans Instagram : **Paramètres → Messages et réponses aux stories → Contrôles des messages → Outils connectés**, et active **Autoriser l'accès aux messages**. Sans ça, le bot répond sous les commentaires mais n'envoie aucun DM.

## Étape 6 : passe l'app en ligne

Publie ton app (mode **Live**). Tant qu'elle est en développement, seuls les comptes qui ont un rôle sur l'app déclenchent le bot. Si Meta te demande des informations supplémentaires pour publier, c'est sur ton compte Meta : suis ses étapes.

## Étape 7 : ta première automatisation

1. Ouvre ton interface (l'adresse qui finit par `/admin`) et entre ta clé. Elle reste retenue sur cet appareil.
2. **Nouvelle automatisation** : le mot-clé, les publications (ou toutes), les réponses publiques, le DM et son bouton, l'option d'abonnement, et ton lien en `https://`.
3. Teste avec **un autre compte** que le tien : le bot ignore volontairement tes propres commentaires.

Le DM part en quelques secondes. Tout ce qui se passe s'affiche dans **Dernières actions**.

---

## Si ça ne marche pas

| Ce que tu vois | Ce qu'il faut vérifier |
|---|---|
| « Vérifier et enregistrer » échoue chez Meta | L'URL de rappel finit bien par `/webhook`, et le jeton de vérification est celui de `mes-codes.txt`. |
| La pastille dit « Webhooks refusés » | La clé secrète de l'app n'est pas la bonne : relance `npm run installer -- --jeton`. |
| La pastille dit « Jeton Instagram à vérifier » | Le jeton est faux ou expiré : regénère-le dans Meta et relance `npm run installer -- --jeton`. |
| La pastille reste sur « En attente du premier commentaire » | Meta n'envoie rien : tu as testé avec ton propre compte, l'app n'est pas en Live, ou les champs `comments`, `messages`, `messaging_postbacks` ne sont pas cochés. |
| La réponse publique part, mais pas le DM | L'accès aux messages n'est pas autorisé sur ton téléphone (étape 5), ou il manque l'autorisation `instagram_business_manage_messages`. L'erreur exacte est dans Dernières actions. |
| Tu veux voir ce que fait le bot en direct | `npx wrangler tail` dans ce dossier affiche son journal en temps réel. |

## Bon à savoir

- **Une réponse privée par commentaire, dans les 7 jours** : c'est une règle de Meta. Le bot n'écrit jamais « à froid » : seulement aux personnes qui ont commenté ou cliqué.
- **Meta freine parfois les envois** quand il y a beaucoup de commentaires d'un coup. Le bot garde ces envois de côté et réessaie tout seul toutes les 10 minutes.
- **Le mot-clé** est reconnu en majuscules ou minuscules, avec accents ou emojis autour, et avec une petite faute à partir de 5 lettres (`MANYCAHT` passe). Les mots courts doivent être exacts : `KIT` n'attrape pas « kits ».
- **Une seule fois par personne** (option) : quelqu'un qui recommente reçoit la réponse publique, mais pas un second DM.
- **Le lien** passe par ton bot, qui compte qui l'a ouvert, puis redirige vers ta page.
- **`{pseudo}`** dans un texte devient le pseudo de la personne.
- **Les boutons** font 20 caractères maximum (règle d'Instagram).

## Le modifier

C'est ton bot : change les textes, ajoute des options, refais l'interface. Le plus simple est de demander à ton agent IA, puis de remettre en ligne avec :

```bash
npx wrangler deploy
```

Pour essayer tes changements sur ton ordinateur **sans rien envoyer à Instagram** (mode essai) :

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:local
```

```bash
npm run dev
```

L'interface s'ouvre sur `http://localhost:8787/admin` avec la clé `essai`. Dans un second terminal, `npm test` joue tout le parcours (commentaires, doublons, fautes de frappe, abonnement, clics, pause, envois freinés) et vérifie chaque étape.
