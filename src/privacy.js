// La politique de confidentialité que Meta exige pour publier l'app.
// Elle se remplit avec OWNER_NAME et CONTACT_EMAIL (wrangler.toml).

const escape = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function privacyPage(env) {
  const name = escape(env.OWNER_NAME || 'Le propriétaire de ce compte');
  const email = escape(env.CONTACT_EMAIL || '');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Politique de confidentialité</title>
<style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#16161a;background:#fff}h1{font-size:26px}h2{font-size:18px;margin-top:28px}</style>
</head><body>
<h1>Politique de confidentialité</h1>
<p>Ce service est un outil de réponse automatique sur Instagram exploité par ${name}. Il répond aux personnes qui commentent un mot-clé sous une publication et leur envoie, par message privé, le lien qu'elles ont demandé.</p>
<h2>Données traitées</h2>
<p>Quand tu commentes un mot-clé ou que tu cliques sur un bouton dans un message, le service enregistre ton identifiant Instagram, ton nom d'utilisateur, le texte de ton commentaire, la date, et si tu as ouvert le lien envoyé. S'il est demandé d'être abonné, il vérifie ton abonnement au compte au moment du clic.</p>
<h2>Utilisation</h2>
<p>Ces données servent uniquement à t'envoyer le lien demandé, à éviter de te l'envoyer plusieurs fois et à compter les envois et les clics. Elles ne sont ni vendues ni transmises à des tiers, en dehors de Meta (Instagram) et de Cloudflare, qui héberge le service.</p>
<h2>Conservation et suppression</h2>
<p>Tu peux demander à tout moment la suppression de tes données${email ? ` en écrivant à <a href="mailto:${email}">${email}</a>` : ''}. Elles sont alors effacées.</p>
</body></html>`;
}
