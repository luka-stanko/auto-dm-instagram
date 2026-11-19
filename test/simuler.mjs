// Joue tout le parcours contre le bot lancé en local (npm run dev, avec DRY_RUN=1 dans .dev.vars).
// Rien ne part chez Instagram : on vérifie ce que le bot a fait dans son journal.
//   node test/simuler.mjs [http://localhost:8787]

import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:8787';
const SECRET = 'secret-essai';
const ADMIN = 'essai';
const ACCOUNT = '17840000000000000';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { 'X-Admin-Key': ADMIN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function webhook(payload, { sign = true } = {}) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };
  if (sign) headers['X-Hub-Signature-256'] = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const res = await fetch(`${BASE}/webhook`, { method: 'POST', headers, body });
  return res.status;
}

const comment = (id, userId, username, text, mediaId = '18000000000000001') => ({
  object: 'instagram',
  entry: [{ id: ACCOUNT, time: Date.now(), changes: [{ field: 'comments', value: { id, text, from: { id: userId, username }, media: { id: mediaId, media_product_type: 'REELS' } } }] }],
});

const postback = (userId, payload) => ({
  object: 'instagram',
  entry: [{ id: ACCOUNT, time: Date.now(), messaging: [{ sender: { id: userId }, recipient: { id: ACCOUNT }, timestamp: Date.now(), postback: { mid: 'm1', title: 'Recevoir', payload } }] }],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const events = async () => (await api('/activity')).data.events || [];
const has = (list, type, userId) => list.some((e) => e.type === type && (!userId || e.user_id === userId));

// 1. Vérification du webhook par Meta
{
  const ok = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=essai-verification&hub.challenge=12345`);
  check('Meta vérifie le webhook avec le bon jeton', ok.status === 200 && (await ok.text()) === '12345');
  const ko = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=12345`);
  check('Un mauvais jeton est refusé', ko.status === 403);
}

// 2. Interface protégée
check('L’API refuse une mauvaise clé', (await api('/stats', { headers: { 'X-Admin-Key': 'faux' } })).status === 401);
check('L’API refuse un lien en http://', (await api('/automations', { method: 'POST', body: JSON.stringify({ keyword: 'X', dm_text: 'a', button_label: 'b', link_text: 'c', link_label: 'd', link_url: 'http://exemple.com' }) })).status === 400);

// 3. Une automatisation avec abonnement obligatoire, sur un seul reel
const created = await api('/automations', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Essai ManyChat maison',
    keyword: 'MANYCHAT',
    media_ids: ['18000000000000001'],
    public_replies: ['Envoyé {pseudo} 📩'],
    dm_text: 'Hello {pseudo} ! Voici le guide 👇',
    button_label: 'Recevoir le guide',
    require_follow: true,
    follow_text: 'Abonne-toi d’abord 🙏',
    follow_button: "C'est fait",
    link_text: 'Et voilà 👇',
    link_label: 'Ouvrir le guide',
    link_url: 'https://exemple.com/guide',
    once_per_user: true,
  }),
});
check('Automatisation créée', created.status === 201, `id ${created.data.id}`);
const id = created.data.id;

// 4. Signature
check('Un webhook sans signature est refusé', (await webhook(comment('c0', 'u0', 'pirate', 'manychat'), { sign: false })) === 401);

// 5. Commentaires
await webhook(comment('c1', 'abonne_1', 'lea', 'Manychat 🔥'));
await webhook(comment('c1', 'abonne_1', 'lea', 'Manychat 🔥'));              // doublon envoyé par Meta
await webhook(comment('c2', 'nonabonne_2', 'tom', 'many chat stp'));         // avec un espace
await webhook(comment('c3', 'abonne_3', 'zoe', 'MANYCAHT'));                // faute de frappe
await webhook(comment('c4', 'abonne_4', 'max', 'trop bien'));               // pas le mot-clé
await webhook(comment('c5', 'abonne_5', 'ana', 'manychat', '18000000000000009')); // autre reel
await webhook(comment('c6', ACCOUNT, 'mon_compte', 'manychat'));             // ton propre compte
await webhook(comment('c7', 'abonne_1', 'lea', 'manychat encore'));          // 2e commentaire de Léa
await wait(800);

let ev = await events();
const dmCount = ev.filter((e) => e.type === 'dm').length;
check('Léa (« Manychat 🔥 ») reçoit réponse publique + DM', has(ev, 'reply', 'abonne_1') && has(ev, 'dm', 'abonne_1'));
check('Le doublon de Meta n’est traité qu’une fois', ev.filter((e) => e.type === 'comment' && e.user_id === 'abonne_1').length === 2);
check('« many chat » est reconnu', has(ev, 'dm', 'nonabonne_2'));
check('« MANYCAHT » (faute) est reconnu', has(ev, 'dm', 'abonne_3'));
check('« trop bien » est ignoré', !has(ev, 'comment', 'abonne_4'));
check('Un commentaire sur un autre reel est ignoré', !has(ev, 'comment', 'abonne_5'));
check('Ton propre commentaire est ignoré', !has(ev, 'comment', ACCOUNT));
check('Léa ne reçoit pas un 2e DM', has(ev, 'skip', 'abonne_1') && dmCount === 3, `${dmCount} DM`);

// 6. Clics sur le bouton
await webhook(postback('nonabonne_2', `GET:${id}`));   // Tom n'est pas abonné
await webhook(postback('abonne_1', `GET:${id}`));      // Léa est abonnée
await webhook(postback('abonne_1', `GET:${id}`));      // Léa reclique
await wait(800);
ev = await events();
check('Tom, pas abonné, reçoit la demande d’abonnement', has(ev, 'follow_ask', 'nonabonne_2') && !has(ev, 'link', 'nonabonne_2'));
check('Léa, abonnée, reçoit le lien', has(ev, 'link', 'abonne_1'));

// 7. Le lien suivi
const linkRes = await fetch(`${BASE}/admin`);
check('L’interface se charge', linkRes.ok && (await linkRes.text()).includes('Automatisations'));

const stats1 = (await api('/stats')).data;
check('3 envois comptés', stats1.totals.sends === 3, `${stats1.totals.sends}`);
check('0 clic avant ouverture', stats1.totals.clicks === 0);

// Le code du lien de Léa, lu dans la base locale.
const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'auto-dm', '--local', '--json', '--command', "SELECT token FROM links WHERE user_id = 'abonne_1'"], { encoding: 'utf8' });
const rows = JSON.parse(out)[0].results;
check('Léa a un seul lien, même après deux clics sur le bouton', rows.length === 1);
const click = await fetch(`${BASE}/r/${rows[0].token}`, { redirect: 'manual' });
check('Le lien redirige vers la vraie page', click.status === 302 && click.headers.get('location') === 'https://exemple.com/guide');
await fetch(`${BASE}/r/${rows[0].token}`, { redirect: 'manual' });  // elle rouvre le lien
check('Un faux lien répond 404', (await fetch(`${BASE}/r/inconnu`, { redirect: 'manual' })).status === 404);

const stats2 = (await api('/stats')).data;
check('1 clic compté (pas 2)', stats2.totals.clicks === 1, `${stats2.totals.clicks}`);
check('CTR = 1/3', Math.abs(stats2.totals.ctr - 1 / 3) < 1e-9);

// 9. Pause : plus rien ne part
await api(`/automations/${id}/toggle`, { method: 'POST' });
await webhook(comment('c8', 'abonne_8', 'eva', 'manychat'));
await wait(500);
check('En pause, un commentaire ne déclenche rien', !has(await events(), 'comment', 'abonne_8'));
await api(`/automations/${id}/toggle`, { method: 'POST' });

// 10. Meta freine : l'envoi part dans la file d'attente
const limited = await api('/automations', {
  method: 'POST',
  body: JSON.stringify({ keyword: 'LIMITE', public_replies: ['[ratelimit]'], dm_text: 'ok', button_label: 'ok', link_text: 'ok', link_label: 'ok', link_url: 'https://exemple.com' }),
});
await webhook(comment('c9', 'abonne_9', 'noe', 'limite'));
await wait(500);
const status = (await api('/status')).data;
check('Un envoi freiné part dans la file d’attente', has(await events(), 'retry', 'abonne_9') && status.queued === 1, `${status.queued} en attente`);
await api(`/automations/${limited.data.id}`, { method: 'DELETE' });

console.log(failures ? `\n${failures} vérification(s) en échec.` : '\nTout le parcours fonctionne.');
process.exit(failures ? 1 : 0);
