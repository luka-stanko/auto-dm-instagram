// Installe (ou met à jour) ton auto-DM sur ton compte Cloudflare.
//   npm run installer            tout : base de données, mise en ligne, codes, jeton Instagram
//   npm run installer -- --jeton seulement coller (ou remplacer) le jeton et la clé secrète Instagram
// Relançable sans risque : ce qui existe déjà est gardé.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROOT, 'wrangler.toml');
const CODES = join(ROOT, 'mes-codes.txt');
const PLACEHOLDER = 'A-REMPLIR-PAR-L-INSTALLATEUR';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, fallback = '') => (await rl.question(fallback ? `${q} [${fallback}] ` : `${q} `)).trim() || fallback;
const say = (s = '') => console.log(s);
const step = (n, s) => say(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const fail = (s) => { say(`\n\x1b[31m${s}\x1b[0m`); rl.close(); process.exit(1); };

function wrangler(args, { capture = false, input } = {}) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  });
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}` };
}

const code = (n) => randomBytes(n).toString('base64url');

function readCodes() {
  if (!existsSync(CODES)) return {};
  const out = {};
  for (const line of readFileSync(CODES, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeCodes(c) {
  writeFileSync(CODES, `# Tes codes. Ne les partage pas. Ce fichier ne quitte pas ton ordinateur.
URL=${c.URL || ''}
ADMIN_KEY=${c.ADMIN_KEY}
VERIFY_TOKEN=${c.VERIFY_TOKEN}
`);
}

async function putInstagramSecrets() {
  say('Colle les deux valeurs de ton app Meta (étape 3 du guide). Laisse vide pour garder la valeur actuelle.');
  const secret = await ask('Clé secrète de l’app Instagram :');
  const token = await ask('Jeton d’accès Instagram (commence par IGAA) :');
  if (secret) {
    if (!wrangler(['secret', 'put', 'IG_APP_SECRET'], { input: secret }).ok) fail('Impossible d’enregistrer la clé secrète.');
    say('✔ Clé secrète enregistrée');
  }
  if (token) {
    if (!token.startsWith('IG')) say('⚠ Ce jeton ne commence pas par IG : vérifie que c’est bien le jeton Instagram.');
    if (!wrangler(['secret', 'put', 'IG_TOKEN'], { input: token }).ok) fail('Impossible d’enregistrer le jeton.');
    say('✔ Jeton enregistré (le bot le renouvellera tout seul avant ses 60 jours)');
  }
}

async function main() {
  say('\x1b[1mInstallation de ton auto-DM Instagram\x1b[0m');

  step(1, 'Connexion à ton compte Cloudflare');
  if (!wrangler(['whoami'], { capture: true }).out.match(/associated with the email|You are logged in/i)) {
    say('Une page Cloudflare va s’ouvrir dans ton navigateur : accepte, puis reviens ici.');
    if (!wrangler(['login']).ok) fail('Connexion à Cloudflare annulée.');
  }
  say('✔ Connecté');

  if (process.argv.includes('--jeton')) {
    step(2, 'Jeton Instagram');
    await putInstagramSecrets();
    rl.close();
    return;
  }

  step(2, 'Ta page de confidentialité (Meta l’exige)');
  let toml = readFileSync(TOML, 'utf8');
  const current = (k) => (toml.match(new RegExp(`^${k} = "(.*)"$`, 'm')) || [])[1] || '';
  const owner = await ask('Ton nom ou celui de ta marque :', current('OWNER_NAME') === 'Ton nom' ? '' : current('OWNER_NAME'));
  const email = await ask('Ton email de contact :', current('CONTACT_EMAIL') === 'toi@exemple.com' ? '' : current('CONTACT_EMAIL'));
  if (!owner || !email) fail('Le nom et l’email sont obligatoires pour la page de confidentialité.');
  toml = toml.replace(/^OWNER_NAME = ".*"$/m, `OWNER_NAME = ${JSON.stringify(owner)}`)
    .replace(/^CONTACT_EMAIL = ".*"$/m, `CONTACT_EMAIL = ${JSON.stringify(email)}`);
  writeFileSync(TOML, toml);
  say('✔ Noté');

  step(3, 'Base de données');
  if (toml.includes(PLACEHOLDER)) {
    const created = wrangler(['d1', 'create', 'auto-dm'], { capture: true });
    let id = (created.out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
    if (!id) {
      const list = wrangler(['d1', 'list', '--json'], { capture: true });
      try {
        id = JSON.parse(list.out.slice(list.out.indexOf('['))).find((d) => d.name === 'auto-dm')?.uuid;
      } catch { /* on échoue juste en dessous */ }
    }
    if (!id) fail(`Impossible de créer la base de données :\n${created.out}`);
    toml = toml.replace(PLACEHOLDER, id);
    writeFileSync(TOML, toml);
  }
  if (!wrangler(['d1', 'execute', 'auto-dm', '--remote', '--yes', '--file', 'schema.sql'], { capture: true }).ok) {
    fail('Impossible de préparer la base de données. Relance `npm run installer`.');
  }
  say('✔ Base de données prête');

  step(4, 'Mise en ligne du bot');
  const deployed = wrangler(['deploy'], { capture: true });
  if (!deployed.ok && /subdomain/i.test(deployed.out)) {
    fail('Ton compte Cloudflare n’a pas encore d’adresse workers.dev. Ouvre dash.cloudflare.com → Workers & Pages une fois (Cloudflare la crée), puis relance `npm run installer`.');
  }
  if (!deployed.ok) fail(`La mise en ligne a échoué :\n${deployed.out}`);
  const url = (deployed.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i) || [])[0];
  if (!url) {
    say(deployed.out);
    fail('Mis en ligne, mais je ne trouve pas l’adresse. Dans Cloudflare, ouvre Workers & Pages → auto-dm pour la voir.');
  }
  say(`✔ En ligne sur ${url}`);

  step(5, 'Tes codes');
  const codes = readCodes();
  codes.URL = url;
  codes.ADMIN_KEY ||= code(18);
  codes.VERIFY_TOKEN ||= code(18);
  for (const name of ['ADMIN_KEY', 'VERIFY_TOKEN']) {
    if (!wrangler(['secret', 'put', name], { input: codes[name] }).ok) fail(`Impossible d’enregistrer ${name}.`);
  }
  writeCodes(codes);
  say('✔ Clé de l’interface et code de vérification Meta créés (gardés dans mes-codes.txt)');

  step(6, 'Jeton Instagram (facultatif maintenant)');
  if ((await ask('As-tu déjà ton jeton Instagram et la clé secrète de ton app ? (o/n)', 'n')).toLowerCase().startsWith('o')) {
    await putInstagramSecrets();
  } else {
    say('Pas de souci : quand tu les as, lance `npm run installer -- --jeton`.');
  }

  rl.close();
  say(`
\x1b[1mC’est installé.\x1b[0m

  Ton interface         ${url}/admin
  Clé de l’interface    ${codes.ADMIN_KEY}

  Pour Meta (étape 4 du guide)
  URL de rappel         ${url}/webhook
  Jeton de vérification ${codes.VERIFY_TOKEN}
  Confidentialité       ${url}/confidentialite

Ces infos sont aussi dans mes-codes.txt.`);
}

main().catch((e) => fail(e.message));
