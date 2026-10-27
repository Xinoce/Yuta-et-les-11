import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '../data')
fs.mkdirSync(dataDir, { recursive: true })
export const db = new Database(path.join(dataDir, 'yuta.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('gm','player')), must_change_password INTEGER NOT NULL DEFAULT 0,
  active_campaign_id INTEGER, auth_user_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE,
  game_id TEXT UNIQUE, join_password_hash TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id), is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS game_images (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL, original_name TEXT NOT NULL, content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL, is_shown INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(campaign_id,user_id)
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  age TEXT NOT NULL DEFAULT '', species TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',
  portrait TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', stats TEXT NOT NULL,
  hp_current INTEGER NOT NULL DEFAULT 20, hp_max INTEGER NOT NULL DEFAULT 20,
  wounds TEXT NOT NULL DEFAULT '', states TEXT NOT NULL DEFAULT '', talents TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL DEFAULT '[]', magic TEXT NOT NULL DEFAULT '', goals TEXT NOT NULL DEFAULT '',
  relationships TEXT NOT NULL DEFAULT '', experience INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS character_selections (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY(campaign_id,user_id)
);
CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL, character_name TEXT, notation TEXT NOT NULL, dice TEXT NOT NULL,
  modifier INTEGER NOT NULL, total INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'free',
  detail TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roll_requests (
  id TEXT PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  gm_id INTEGER NOT NULL REFERENCES users(id), target_user_id INTEGER REFERENCES users(id), target_group INTEGER NOT NULL DEFAULT 0,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL, action TEXT NOT NULL, stat TEXT NOT NULL,
  difficulty INTEGER NOT NULL, stat_bonus INTEGER NOT NULL, circumstance INTEGER NOT NULL DEFAULT 0,
  context TEXT NOT NULL DEFAULT '', expires_at TEXT, status TEXT NOT NULL DEFAULT 'pending',
  result_roll_id INTEGER REFERENCES rolls(id), resolved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`)

function ensureColumn(table, column, definition) {
  const existing = db.pragma(`table_info(${table})`).some((item) => item.name === column)
  if (!existing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

ensureColumn('users', 'username', 'TEXT')
ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'active_campaign_id', 'INTEGER')
ensureColumn('users', 'auth_user_id', 'TEXT')
ensureColumn('campaigns', 'is_open', 'INTEGER NOT NULL DEFAULT 1')
ensureColumn('campaigns', 'game_id', 'TEXT')
ensureColumn('campaigns', 'join_password_hash', 'TEXT')
ensureColumn('campaigns', 'status', "TEXT NOT NULL DEFAULT 'active'")
const gameIdUpdate = db.prepare('UPDATE campaigns SET game_id=? WHERE id=?')
for (const campaign of db.prepare('SELECT id FROM campaigns WHERE game_id IS NULL OR game_id = ?').all('')) {
  gameIdUpdate.run(`Y11-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, campaign.id)
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS campaigns_game_id_unique ON campaigns(game_id)')
db.exec("UPDATE users SET username='legacy_' || id WHERE username IS NULL OR username='' ")
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE)')

const characterSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='characters'").get()?.sql || ''
if (/UNIQUE\s*\(\s*campaign_id\s*,\s*owner_id\s*\)/i.test(characterSql)) {
  db.pragma('foreign_keys = OFF')
  db.pragma('legacy_alter_table = ON')
  db.exec(`
    BEGIN;
    ALTER TABLE characters RENAME TO characters_legacy;
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
      age TEXT NOT NULL DEFAULT '', species TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',
      portrait TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', stats TEXT NOT NULL,
      hp_current INTEGER NOT NULL DEFAULT 20, hp_max INTEGER NOT NULL DEFAULT 20,
      wounds TEXT NOT NULL DEFAULT '', states TEXT NOT NULL DEFAULT '', talents TEXT NOT NULL DEFAULT '[]',
      equipment TEXT NOT NULL DEFAULT '[]', magic TEXT NOT NULL DEFAULT '', goals TEXT NOT NULL DEFAULT '',
      relationships TEXT NOT NULL DEFAULT '', experience INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO characters SELECT * FROM characters_legacy;
    DROP TABLE characters_legacy;
    COMMIT;
  `)
  db.pragma('legacy_alter_table = OFF')
  db.pragma('foreign_keys = ON')
}

ensureColumn('characters', 'gold', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('characters', 'kind', "TEXT NOT NULL DEFAULT 'player'")

db.exec(`
CREATE TABLE IF NOT EXISTS character_selections (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY(campaign_id,user_id)
);
CREATE TABLE IF NOT EXISTS character_portraits (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  storage_name TEXT NOT NULL, original_name TEXT NOT NULL, content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS rolls_campaign_created ON rolls(campaign_id, id DESC);
CREATE INDEX IF NOT EXISTS requests_campaign_created ON roll_requests(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS game_images_campaign_created ON game_images(campaign_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique ON users(auth_user_id) WHERE auth_user_id IS NOT NULL;
`)

export const json = (value) => JSON.stringify(value)
export const rowCharacter = (row) => row && ({
  ...row, stats: JSON.parse(row.stats), talents: JSON.parse(row.talents), equipment: JSON.parse(row.equipment),
})

