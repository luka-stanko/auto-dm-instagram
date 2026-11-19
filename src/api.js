// L'API de l'interface : protégée par ta clé (ADMIN_KEY), envoyée dans l'en-tête X-Admin-Key.

import { getSetting, parseList } from './db.js';
import { getOwnAccount, listMedia } from './instagram.js';
import { timingSafeEqual } from './bot.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const LIMITS = { name: 80, keyword: 40, dm_text: 640, button_label: 20, follow_text: 640, follow_button: 20, link_text: 640, link_label: 20, link_url: 2000 };

function clean(input) {
  const a = {};
  for (const [field, max] of Object.entries(LIMITS)) a[field] = String(input[field] ?? '').trim().slice(0, max);
  a.media_ids = JSON.stringify(parseList(JSON.stringify(input.media_ids || [])).map(String).slice(0, 100));
  a.public_replies = JSON.stringify(
    (Array.isArray(input.public_replies) ? input.public_replies : []).map((r) => String(r).trim().slice(0, 300)).filter(Boolean).slice(0, 10),
  );
  a.require_follow = input.require_follow ? 1 : 0;
  a.once_per_user = input.once_per_user === false ? 0 : 1;
  a.active = input.active === false ? 0 : 1;

  if (!a.name) a.name = a.keyword;
  const missing = ['keyword', 'dm_text', 'button_label', 'link_text', 'link_label', 'link_url'].filter((f) => !a[f]);
  if (a.require_follow) missing.push(...['follow_text', 'follow_button'].filter((f) => !a[f]));
  if (missing.length) return { error: `Champs manquants : ${missing.join(', ')}` };
  if (!/^https:\/\/\S+$/i.test(a.link_url)) return { error: 'Le lien doit commencer par https://' };
  return { automation: a };
}

const FIELDS = ['name', 'keyword', 'media_ids', 'public_replies', 'dm_text', 'button_label', 'require_follow', 'follow_text', 'follow_button', 'link_text', 'link_label', 'link_url', 'once_per_user', 'active'];

async function stats(env) {
  const { results } = await env.DB.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM events e WHERE e.automation_id = a.id AND e.type = 'comment') AS comments,
      (SELECT COUNT(*) FROM events e WHERE e.automation_id = a.id AND e.type = 'dm') AS sends,
      (SELECT COUNT(*) FROM links l WHERE l.automation_id = a.id AND l.clicked_at IS NOT NULL) AS clicks
    FROM automations a ORDER BY a.id DESC`).all();
  const automations = results.map((a) => ({
    ...a,
    media_ids: parseList(a.media_ids),
    public_replies: parseList(a.public_replies),
    require_follow: Boolean(a.require_follow),
    once_per_user: Boolean(a.once_per_user),
    active: Boolean(a.active),
  }));
  const sends = automations.reduce((s, a) => s + a.sends, 0);
  const clicks = automations.reduce((s, a) => s + a.clicks, 0);
  const people = await env.DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE type = 'dm'").first();
  return {
    totals: { sends, clicks, people: people?.n || 0, ctr: sends ? clicks / sends : 0, active: automations.filter((a) => a.active).length, total: automations.length },
    automations,
  };
}

export async function handleApi(request, env, url) {
  if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY manquant dans les secrets du Worker.' }, 503);
  if (!timingSafeEqual(request.headers.get('X-Admin-Key') || '', env.ADMIN_KEY)) return json({ error: 'Clé incorrecte.' }, 401);

  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  if (path === '/stats' && method === 'GET') return json(await stats(env));

  if (path === '/activity' && method === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT e.*, a.name AS automation_name, a.keyword
      FROM events e LEFT JOIN automations a ON a.id = e.automation_id
      ORDER BY e.id DESC LIMIT 60`).all();
    return json({ events: results });
  }

  if (path === '/status' && method === 'GET') {
    let account = null;
    let accountError = null;
    try {
      account = await getOwnAccount(env);
    } catch (e) {
      accountError = e.message;
    }
    const queued = await env.DB.prepare('SELECT COUNT(*) AS n FROM queue').first();
    return json({
      account,
      accountError,
      dryRun: env.DRY_RUN === '1',
      lastWebhookAt: Number(await getSetting(env, 'last_webhook_at')) || null,
      lastSignatureError: Number(await getSetting(env, 'last_signature_error')) || null,
      tokenStatus: await getSetting(env, 'token_status'),
      queued: queued?.n || 0,
      webhookUrl: `${url.origin}/webhook`,
      privacyUrl: `${url.origin}/confidentialite`,
    });
  }

  if (path === '/media' && method === 'GET') {
    try {
      const data = await listMedia(env);
      return json({ media: data.data || [] });
    } catch (e) {
      return json({ media: [], error: e.message });
    }
  }

  if (path === '/automations' && method === 'POST') {
    const { automation, error } = clean(await request.json().catch(() => ({})));
    if (error) return json({ error }, 400);
    const cols = [...FIELDS, 'created_at'];
    const res = await env.DB.prepare(`INSERT INTO automations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...FIELDS.map((f) => automation[f]), Date.now()).run();
    return json({ id: res.meta.last_row_id }, 201);
  }

  const one = path.match(/^\/automations\/(\d+)(\/toggle)?$/);
  if (one) {
    const id = Number(one[1]);
    const existing = await env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(id).first();
    if (!existing) return json({ error: 'Automatisation introuvable.' }, 404);

    if (one[2] && method === 'POST') {
      await env.DB.prepare('UPDATE automations SET active = ? WHERE id = ?').bind(existing.active ? 0 : 1, id).run();
      return json({ ok: true, active: !existing.active });
    }
    if (!one[2] && method === 'PUT') {
      const { automation, error } = clean(await request.json().catch(() => ({})));
      if (error) return json({ error }, 400);
      await env.DB.prepare(`UPDATE automations SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
        .bind(...FIELDS.map((f) => automation[f]), id).run();
      return json({ ok: true });
    }
    if (!one[2] && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM automations WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'Route inconnue.' }, 404);
}
