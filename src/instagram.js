// Tout ce qui parle à l'API officielle d'Instagram (connexion Instagram, graph.instagram.com).

import { getSetting, setSetting } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

export class GraphError extends Error {
  constructor(message, { status, code, subcode, transient } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.transient = Boolean(transient);
  }
}

// Codes de Meta qui veulent dire « trop d'envois, réessaie plus tard ».
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

function isDryRun(env) {
  return env.DRY_RUN === '1';
}

// Le jeton : celui renouvelé par le bot s'il existe, sinon celui que tu as collé (IG_TOKEN).
// Si tu colles un nouveau IG_TOKEN, il reprend la main.
export async function getToken(env) {
  const fromEnv = env.IG_TOKEN || '';
  const seen = await getSetting(env, 'ig_token_env');
  if (fromEnv && fromEnv !== seen) {
    await setSetting(env, 'ig_token_env', fromEnv);
    await setSetting(env, 'ig_token', fromEnv);
    await setSetting(env, 'ig_token_refreshed_at', '');
    return fromEnv;
  }
  return (await getSetting(env, 'ig_token')) || fromEnv;
}

export async function graph(env, method, path, { query = {}, body } = {}) {
  if (isDryRun(env)) return dryRun(env, method, path, query, body);

  const token = await getToken(env);
  if (!token) throw new GraphError('IG_TOKEN manquant : colle ton jeton Instagram dans les secrets du Worker.');

  const url = new URL(`https://graph.instagram.com/${env.GRAPH_VERSION || 'v24.0'}/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new GraphError(`Instagram injoignable : ${e.message}`, { transient: true });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = data.error || {};
    throw new GraphError(err.message || `Erreur HTTP ${res.status}`, {
      status: res.status,
      code: err.code,
      subcode: err.error_subcode,
      transient: res.status === 429 || res.status >= 500 || err.is_transient || RATE_LIMIT_CODES.has(err.code),
    });
  }
  return data;
}

// Répondre sous un commentaire.
export function replyToComment(env, commentId, message) {
  return graph(env, 'POST', `${commentId}/replies`, { body: { message } });
}

// Un message privé : `recipient` vaut { comment_id } pour le premier (réponse privée à un commentaire),
// puis { id } une fois que la personne a cliqué sur un bouton.
export function sendMessage(env, recipient, message) {
  return graph(env, 'POST', 'me/messages', { body: { recipient, message } });
}

// Un texte suivi de boutons (3 maximum, 20 caractères par bouton).
export function buttonMessage(text, buttons) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: String(text).slice(0, 640),
        buttons: buttons.map((b) => ({ ...b, title: String(b.title).slice(0, 20) })),
      },
    },
  };
}

// Pseudo et abonnement de quelqu'un qui a écrit au compte ou cliqué sur un bouton.
export function getProfile(env, userId) {
  return graph(env, 'GET', userId, { query: { fields: 'username,is_user_follow_business' } });
}

export async function getOwnAccount(env) {
  const cached = await getSetting(env, 'account');
  if (cached) return JSON.parse(cached);
  const me = await graph(env, 'GET', 'me', { query: { fields: 'user_id,username' } });
  const account = { id: String(me.user_id || me.id), username: me.username };
  await setSetting(env, 'account', JSON.stringify(account));
  return account;
}

export function listMedia(env) {
  return graph(env, 'GET', 'me/media', {
    query: {
      fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp',
      limit: '30',
    },
  });
}

// Un jeton Instagram dure 60 jours. Le bot le renouvelle tout seul tous les 20 jours.
export async function refreshTokenIfDue(env) {
  if (isDryRun(env)) return;
  const now = Date.now();
  const lastCheck = Number(await getSetting(env, 'token_checked_at')) || 0;
  if (now - lastCheck < DAY) return;
  await setSetting(env, 'token_checked_at', String(now));

  const refreshedAt = Number(await getSetting(env, 'ig_token_refreshed_at')) || 0;
  if (refreshedAt && now - refreshedAt < 20 * DAY) return;

  const token = await getToken(env);
  if (!token) return;
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.access_token) {
      await setSetting(env, 'ig_token', data.access_token);
      await setSetting(env, 'ig_token_refreshed_at', String(now));
      await setSetting(env, 'token_status', `renouvelé le ${new Date(now).toISOString().slice(0, 10)}`);
    } else {
      await setSetting(env, 'token_status', `renouvellement refusé : ${data.error?.message || 'réponse vide'}`);
    }
  } catch (e) {
    await setSetting(env, 'token_status', `renouvellement impossible : ${e.message}`);
  }
}

// Mode essai (DRY_RUN=1) : rien ne part chez Instagram, tout est écrit dans le journal du Worker.
// Un identifiant qui commence par « nonabonne » joue quelqu'un qui n'est pas abonné.
function dryRun(env, method, path, query, body) {
  console.log(`[essai] ${method} ${path} ${body ? JSON.stringify(body) : JSON.stringify(query)}`);
  if (path === 'me') return { user_id: '17840000000000000', username: 'mon_compte' };
  if (path === 'me/media') {
    return {
      data: [1, 2, 3, 4].map((n) => ({
        id: `1800000000000000${n}`,
        caption: `Reel d'essai numéro ${n}`,
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        thumbnail_url: '',
        permalink: 'https://www.instagram.com/',
        timestamp: new Date(Date.now() - n * DAY).toISOString(),
      })),
    };
  }
  if (method === 'GET') {
    return { username: `essai_${path.slice(-4)}`, is_user_follow_business: !path.startsWith('nonabonne') };
  }
  if (String(body?.message || '').includes('[ratelimit]')) {
    throw new GraphError('Limite d’envoi atteinte (essai)', { code: 4, transient: true });
  }
  return { id: `essai_${crypto.randomUUID()}`, recipient_id: 'essai' };
}
