// Le cœur du bot : un commentaire arrive, il répond, envoie le DM, vérifie l'abonnement, donne le lien.

import { getAutomation, logEvent, parseList, setSetting } from './db.js';
import { GraphError, buttonMessage, getOwnAccount, getProfile, replyToComment, sendMessage } from './instagram.js';
import { matchKeyword } from './match.js';

const MAX_ATTEMPTS = 6;
const RETRY_DELAY = 10 * 60 * 1000;

// ---------- Signature de Meta ----------

// Meta signe chaque webhook avec la clé secrète de ton app (en-tête X-Hub-Signature-256).
// On accepte la clé de l'app Instagram et, si tu l'as ajoutée, celle de l'app Meta.
export async function verifySignature(env, rawBody, header) {
  const secrets = [env.IG_APP_SECRET, env.META_APP_SECRET].filter(Boolean);
  if (!secrets.length) return false;
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = header.slice(7).toLowerCase();
  const enc = new TextEncoder();
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
    const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (timingSafeEqual(hex, expected)) return true;
  }
  return false;
}

export function timingSafeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ---------- Webhook ----------

export async function handleWebhook(env, payload, origin) {
  await setSetting(env, 'last_webhook_at', String(Date.now()));
  if (payload?.object !== 'instagram') return;

  for (const entry of payload.entry || []) {
    const accountId = String(entry.id || '');
    for (const change of entry.changes || []) {
      if (change.field === 'comments' && change.value) {
        await onComment(env, accountId, change.value).catch((e) => logEvent(env, { type: 'error', detail: `commentaire : ${e.message}` }));
      }
    }
    for (const m of entry.messaging || []) {
      if (m.message?.is_echo) continue; // nos propres messages
      if (m.postback) {
        await onPostback(env, m, origin).catch((e) => logEvent(env, { type: 'error', detail: `bouton : ${e.message}` }));
      }
    }
  }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// {pseudo} dans un texte devient le pseudo de la personne.
function fill(text, user) {
  return String(text || '').replaceAll('{pseudo}', user.username ? `@${user.username}` : '');
}

function mediaMatches(automation, mediaId) {
  const ids = parseList(automation.media_ids);
  return ids.length === 0 || ids.includes(String(mediaId));
}

async function onComment(env, accountId, value) {
  const commentId = value.id;
  const user = { id: String(value.from?.id || ''), username: value.from?.username || '' };
  if (!commentId || !user.id) return;

  // Le bot ignore tes propres commentaires (et ses propres réponses).
  let own = null;
  try {
    own = await getOwnAccount(env);
  } catch {
    // pas grave : on compare au moins à l'identifiant du compte reçu dans le webhook
  }
  if (user.id === accountId || user.id === own?.id || (own?.username && user.username === own.username)) return;

  const { results: automations } = await env.DB.prepare('SELECT * FROM automations WHERE active = 1 ORDER BY id DESC').all();
  const automation = automations.find((a) => mediaMatches(a, value.media?.id) && matchKeyword(value.text, a.keyword));
  if (!automation) return;

  // Meta envoie parfois deux fois le même webhook : un commentaire n'est traité qu'une fois.
  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO comments (comment_id, automation_id, user_id, username, media_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(commentId, automation.id, user.id, user.username, String(value.media?.id || ''), value.text || '', Date.now()).run();
  if (!inserted.meta.changes) return;

  await logEvent(env, { automationId: automation.id, user, type: 'comment', detail: value.text || '' });

  const replies = parseList(automation.public_replies).map((r) => String(r).trim()).filter(Boolean);
  if (replies.length) {
    await deliver(env, { action: 'reply', commentId, message: fill(pick(replies), user), automationId: automation.id, user });
  }

  if (automation.once_per_user) {
    const already = await env.DB.prepare(
      "SELECT 1 FROM events WHERE automation_id = ? AND user_id = ? AND type = 'dm' LIMIT 1",
    ).bind(automation.id, user.id).first();
    if (already) {
      await logEvent(env, { automationId: automation.id, user, type: 'skip', detail: 'déjà reçu ce DM' });
      return;
    }
  }

  await deliver(env, {
    action: 'message',
    type: 'dm',
    recipient: { comment_id: commentId },
    message: buttonMessage(fill(automation.dm_text, user), [
      { type: 'postback', title: automation.button_label, payload: `GET:${automation.id}` },
    ]),
    automationId: automation.id,
    user,
  });
}

async function onPostback(env, m, origin) {
  const [kind, idText] = String(m.postback.payload || '').split(':');
  if (kind !== 'GET') return;
  const automation = await getAutomation(env, Number(idText));
  if (!automation) return;

  const user = { id: String(m.sender?.id || ''), username: '' };
  if (!user.id) return;

  let profile = null;
  try {
    profile = await getProfile(env, user.id);
    user.username = profile.username || '';
  } catch (e) {
    await logEvent(env, { automationId: automation.id, user, type: 'error', detail: `profil illisible : ${e.message}` });
  }

  // Pas abonné : on le lui demande, avec un bouton « C'est fait » qui revérifie.
  if (automation.require_follow && profile && profile.is_user_follow_business === false) {
    await deliver(env, {
      action: 'message',
      type: 'follow_ask',
      recipient: { id: user.id },
      message: buttonMessage(fill(automation.follow_text, user), [
        { type: 'postback', title: automation.follow_button, payload: `GET:${automation.id}` },
      ]),
      automationId: automation.id,
      user,
    });
    return;
  }

  // Un lien suivi par personne : le même si elle reclique, pour compter les clics une seule fois.
  let link = await env.DB.prepare('SELECT token FROM links WHERE automation_id = ? AND user_id = ?').bind(automation.id, user.id).first();
  if (!link) {
    link = { token: crypto.randomUUID().replaceAll('-', '').slice(0, 20) };
    await env.DB.prepare(
      'INSERT OR IGNORE INTO links (token, automation_id, user_id, username, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(link.token, automation.id, user.id, user.username, Date.now()).run();
    link = await env.DB.prepare('SELECT token FROM links WHERE automation_id = ? AND user_id = ?').bind(automation.id, user.id).first();
  }

  await deliver(env, {
    action: 'message',
    type: 'link',
    recipient: { id: user.id },
    message: buttonMessage(fill(automation.link_text, user), [
      { type: 'web_url', title: automation.link_label, url: `${origin}/r/${link.token}` },
    ]),
    automationId: automation.id,
    user,
  });
}

// ---------- Envoi, avec file d'attente si Meta freine ----------

async function send(env, job) {
  if (job.action === 'reply') return replyToComment(env, job.commentId, job.message);
  return sendMessage(env, job.recipient, job.message);
}

function eventType(job) {
  return job.action === 'reply' ? 'reply' : job.type;
}

async function deliver(env, job) {
  try {
    await send(env, job);
    await logEvent(env, { automationId: job.automationId, user: job.user, type: eventType(job) });
  } catch (e) {
    if (e instanceof GraphError && e.transient) {
      await env.DB.prepare('INSERT INTO queue (payload, attempts, next_at, last_error, created_at) VALUES (?, 1, ?, ?, ?)')
        .bind(JSON.stringify(job), Date.now() + RETRY_DELAY, e.message, Date.now()).run();
      await logEvent(env, { automationId: job.automationId, user: job.user, type: 'retry', detail: `${eventType(job)} : ${e.message}` });
    } else {
      await logEvent(env, { automationId: job.automationId, user: job.user, type: 'error', detail: `${eventType(job)} : ${e.message}` });
    }
  }
}

// Appelé toutes les 10 minutes par le cron.
// Huit envois au plus par passage : l'offre gratuite de Cloudflare plafonne
// les requêtes à la base par exécution, et chaque envoi en coûte plusieurs.
// L'envoi est retiré de la file AVANT de partir : si le passage s'arrête en
// route, on perd au pire un nouvel essai, jamais on n'envoie deux fois le DM.
export async function processQueue(env) {
  const { results } = await env.DB.prepare('SELECT * FROM queue WHERE next_at <= ? ORDER BY id LIMIT 8').bind(Date.now()).all();
  for (const row of results) {
    const job = JSON.parse(row.payload);
    await env.DB.prepare('DELETE FROM queue WHERE id = ?').bind(row.id).run();
    try {
      await send(env, job);
      await logEvent(env, { automationId: job.automationId, user: job.user, type: eventType(job) });
    } catch (e) {
      const attempts = row.attempts + 1;
      if (e instanceof GraphError && e.transient && attempts < MAX_ATTEMPTS) {
        await env.DB.prepare('INSERT INTO queue (payload, attempts, next_at, last_error, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(row.payload, attempts, Date.now() + RETRY_DELAY, e.message, row.created_at).run();
      } else {
        await logEvent(env, { automationId: job.automationId, user: job.user, type: 'error', detail: `${eventType(job)} abandonné : ${e.message}` });
      }
    }
  }
}

// ---------- Clic sur le lien ----------

export async function handleClick(env, token) {
  const row = await env.DB.prepare(
    'SELECT l.*, a.link_url FROM links l JOIN automations a ON a.id = l.automation_id WHERE l.token = ?',
  ).bind(token).first();
  if (!row || !/^https?:\/\//i.test(row.link_url)) return null;
  if (!row.clicked_at) {
    await env.DB.prepare('UPDATE links SET clicked_at = ? WHERE token = ?').bind(Date.now(), token).run();
    await logEvent(env, { automationId: row.automation_id, user: { id: row.user_id, username: row.username }, type: 'click' });
  }
  return row.link_url;
}
