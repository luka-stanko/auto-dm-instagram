// Petites aides autour de la base D1.

export async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

export async function logEvent(env, { automationId = null, user = {}, type, detail = null }) {
  await env.DB.prepare(
    'INSERT INTO events (automation_id, user_id, username, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(automationId, user.id || null, user.username || null, type, detail, Date.now()).run();
}

export async function getAutomation(env, id) {
  return env.DB.prepare('SELECT * FROM automations WHERE id = ?').bind(id).first();
}

export function parseList(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
