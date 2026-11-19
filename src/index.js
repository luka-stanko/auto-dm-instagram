// Point d'entrée du Worker Cloudflare.
//   GET  /webhook          vérification par Meta
//   POST /webhook          commentaires et clics sur les boutons
//   GET  /r/<code>         lien suivi (compte le clic puis redirige)
//   GET  /admin            ton interface
//   /api/...               l'API de l'interface (clé requise)
//   GET  /confidentialite  la page que Meta demande

import adminPage from './admin.html';
import { handleApi } from './api.js';
import { handleClick, handleWebhook, processQueue, timingSafeEqual, verifySignature } from './bot.js';
import { setSetting } from './db.js';
import { refreshTokenIfDue } from './instagram.js';
import { privacyPage } from './privacy.js';

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/webhook' && request.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe'
        && env.VERIFY_TOKEN
        && timingSafeEqual(url.searchParams.get('hub.verify_token') || '', env.VERIFY_TOKEN);
      return ok ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('Jeton de vérification incorrect.', { status: 403 });
    }

    if (pathname === '/webhook' && request.method === 'POST') {
      const raw = await request.arrayBuffer();
      if (!(await verifySignature(env, raw, request.headers.get('X-Hub-Signature-256')))) {
        ctx.waitUntil(setSetting(env, 'last_signature_error', String(Date.now())));
        return new Response('Signature refusée.', { status: 401 });
      }
      let payload;
      try {
        payload = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return new Response('JSON illisible.', { status: 400 });
      }
      // On répond tout de suite à Meta, le travail continue derrière.
      ctx.waitUntil(handleWebhook(env, payload, url.origin));
      return new Response('EVENT_RECEIVED');
    }

    if (pathname.startsWith('/r/')) {
      const target = await handleClick(env, pathname.slice(3));
      return target ? Response.redirect(target, 302) : html('<p>Ce lien n’existe pas ou plus.</p>', 404);
    }

    if (pathname.startsWith('/api/')) return handleApi(request, env, url);

    if (pathname === '/admin' || pathname === '/') return html(adminPage);

    if (pathname === '/confidentialite') return html(privacyPage(env));

    return html('<p>Page introuvable.</p>', 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([processQueue(env), refreshTokenIfDue(env)]));
  },
};
