-- Base de données du bot (Cloudflare D1, du SQLite).
-- Relancer ce fichier ne casse rien : chaque table n'est créée que si elle manque.

-- Une automatisation = un mot-clé, des publications, des textes et un lien.
CREATE TABLE IF NOT EXISTS automations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  keyword        TEXT    NOT NULL,
  media_ids      TEXT    NOT NULL DEFAULT '[]',  -- [] = toutes les publications
  public_replies TEXT    NOT NULL DEFAULT '[]',  -- une tirée au hasard ; [] = pas de réponse publique
  dm_text        TEXT    NOT NULL,
  button_label   TEXT    NOT NULL DEFAULT 'Recevoir le lien',
  require_follow INTEGER NOT NULL DEFAULT 0,
  follow_text    TEXT    NOT NULL DEFAULT 'Avant de t''envoyer le lien, assure-toi d''être abonné à mon compte 🙏 Une fois que c''est bon, clique sur « C''est fait » 👇',
  follow_button  TEXT    NOT NULL DEFAULT 'C''est fait',
  link_text      TEXT    NOT NULL DEFAULT 'Et voilà ! Clique sur le bouton pour l''ouvrir 👇',
  link_label     TEXT    NOT NULL DEFAULT 'Ouvrir le lien',
  link_url       TEXT    NOT NULL,
  once_per_user  INTEGER NOT NULL DEFAULT 1,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL
);

-- Chaque commentaire traité, une seule fois (Meta renvoie parfois deux fois le même).
CREATE TABLE IF NOT EXISTS comments (
  comment_id    TEXT PRIMARY KEY,
  automation_id INTEGER,
  user_id       TEXT,
  username      TEXT,
  media_id      TEXT,
  text          TEXT,
  created_at    INTEGER NOT NULL
);

-- Le journal : comment, reply, dm, follow_ask, link, click, skip, error.
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER,
  user_id       TEXT,
  username      TEXT,
  type          TEXT    NOT NULL,
  detail        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_automation ON events (automation_id, type);
CREATE INDEX IF NOT EXISTS events_by_date ON events (created_at);

-- Un lien suivi par personne et par automatisation : c'est ce qui compte les clics.
CREATE TABLE IF NOT EXISTS links (
  token         TEXT PRIMARY KEY,
  automation_id INTEGER NOT NULL,
  user_id       TEXT    NOT NULL,
  username      TEXT,
  clicked_at    INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS links_once ON links (automation_id, user_id);

-- Les envois que Meta a freinés, réessayés toutes les 10 minutes.
CREATE TABLE IF NOT EXISTS queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

-- Réglages internes : jeton Instagram renouvelé, compte, dernier webhook reçu.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
