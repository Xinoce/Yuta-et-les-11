import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dataDir, db, json, rowCharacter } from './db.js'
import { clearSessionCookie, parseCookie, sessionCookie, signSession, verifySession } from './auth.js'
import { canAnswerRequest, canEditCharacter, canManageCampaign, canReadCharacter, parseNotation, resolveCheck, safeJson, STATS, validCreationStats, validateDice } from './domain.js'
import { getTunnelStatus, startPublicTunnel, stopPublicTunnel } from './online.js'

const app = express()
const server = createServer(app)
const io = new Server(server)
const here = path.dirname(fileURLToPath(import.meta.url))
const clientBuild = path.resolve(here, '../dist')
const gameImageRoot = path.join(dataDir, 'game-images')
const characterImageRoot = path.join(dataDir, 'character-images')
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgpgqkjjlfuofonejmse.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_B1VJJ0QUceDgNJVZ9Xa2ww_ChtgvPJt'
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(express.json({ limit: '16mb' }))
if (fs.existsSync(clientBuild)) app.use(express.static(clientBuild))

const publicUser = ({ id, email, username, display_name, role, must_change_password, auth_user_id }) => ({
  id, email, username: username || display_name, displayName: display_name, role,
  mustChangePassword: Boolean(must_change_password), authLinked: Boolean(auth_user_id),
})
const fail = (res, status, error) => res.status(status).json({ error })
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const normalizeGameId = (value) => cleanText(value, 32).toUpperCase().replace(/[^A-Z0-9]/g, '')
const validStatsObject = (stats) => Boolean(stats && typeof stats === 'object' && !Array.isArray(stats) &&
  Object.keys(stats).length === STATS.length && STATS.every((stat) => Number.isInteger(stats[stat]) && stats[stat] >= -99 && stats[stat] <= 99))
const imageTypes = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
async function verifySupabaseIdentity(accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 10000) return { identity: null, unavailable: false }
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { identity: null, unavailable: false }
    const identity = await response.json()
    return identity?.id && identity?.email ? { identity, unavailable: false } : { identity: null, unavailable: false }
  } catch { return { identity: null, unavailable: true } }
}
function usernameFromIdentity(identity) {
  const metadata = identity.user_metadata || {}
  const candidate = cleanText(metadata.username, 24).replace(/[^a-zA-Z0-9._-]/g, '') ||
    cleanText(String(identity.email).split('@')[0], 24).replace(/[^a-zA-Z0-9._-]/g, '')
  const base = /^[a-zA-Z0-9._-]{2,24}$/.test(candidate) ? candidate : `joueur${crypto.randomInt(1000, 9999)}`
  let username = base
  let suffix = 2
  while (db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(username)) {
    const ending = String(suffix++)
    username = `${base.slice(0, 24 - ending.length)}${ending}`
  }
  return username
}
const imageInfo = (row) => ({
  id: row.id, name: row.original_name, contentType: row.content_type, byteSize: row.byte_size,
  isShown: Boolean(row.is_shown), createdAt: row.created_at, url: `/api/game-images/${row.id}/file`,
})
function validImageSignature(type, bytes) {
  if (type === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/gif') return bytes.length > 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  if (type === 'image/webp') return bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}
const campaignInfo = (campaign, userId) => campaign && ({
  id: campaign.id, gameId: campaign.game_id, name: campaign.name,
  inviteCode: campaign.owner_id === userId ? campaign.invite_code : null,
  legacyJoinPassword: campaign.owner_id === userId && !campaign.join_password_hash ? campaign.invite_code : null,
  joinPasswordSet: Boolean(campaign.join_password_hash || campaign.invite_code), isOpen: Boolean(campaign.is_open),
  status: campaign.status || 'active', isOwner: campaign.owner_id === userId,
})
const characterInfo = (row) => {
  const character = rowCharacter(row)
  if (!character) return null
  character.portrait = db.prepare('SELECT 1 FROM character_portraits WHERE character_id=?').get(character.id)
    ? `/api/characters/${character.id}/portrait/file`
    : ''
  return character
}
const oneCampaign = (userId) => db.prepare(`SELECT c.* FROM campaigns c
  JOIN campaign_members m ON m.campaign_id=c.id JOIN users u ON u.id=m.user_id
  WHERE m.user_id=? ORDER BY (c.id=u.active_campaign_id) DESC,c.id DESC LIMIT 1`).get(userId)
const startupCampaign = (userId) => {
  const campaign = db.prepare(`SELECT c.* FROM campaigns c JOIN campaign_members m ON m.campaign_id=c.id JOIN users u ON u.id=m.user_id
    WHERE m.user_id=? ORDER BY (c.status='active') DESC,(c.id=u.active_campaign_id) DESC,c.id DESC LIMIT 1`).get(userId)
  if (campaign) db.prepare('UPDATE users SET active_campaign_id=? WHERE id=?').run(campaign.id, userId)
  return campaign
}
const member = (campaignId, userId) => db.prepare('SELECT 1 FROM campaign_members WHERE campaign_id=? AND user_id=?').get(campaignId, userId)
const getCharacter = (id) => characterInfo(db.prepare('SELECT * FROM characters WHERE id=?').get(id))
const getRoll = (id) => {
  const row = db.prepare('SELECT * FROM rolls WHERE id=?').get(id)
  return row && { ...row, dice: JSON.parse(row.dice), detail: safeJson(row.detail, null) }
}
const getRequest = (id) => {
  const row = db.prepare(`SELECT q.*, u.display_name AS target_name, c.name AS character_name,
    r.id AS result_id, r.display_name AS result_player, r.character_name AS result_character,
    r.notation AS result_notation, r.dice AS result_dice, r.modifier AS result_modifier,
    r.total AS result_total, r.detail AS result_detail, r.created_at AS result_created_at
    FROM roll_requests q LEFT JOIN users u ON q.target_user_id=u.id
    LEFT JOIN characters c ON q.character_id=c.id LEFT JOIN rolls r ON q.result_roll_id=r.id WHERE q.id=?`).get(id)
  if (!row) return null
  const result = row.result_id ? {
    id: row.result_id, player: row.result_player, character: row.result_character, notation: row.result_notation,
    dice: JSON.parse(row.result_dice), modifier: row.result_modifier, total: row.result_total,
    detail: safeJson(row.result_detail, null), created_at: row.result_created_at,
  } : null
  return {
    id: row.id, campaign_id: row.campaign_id, gm_id: row.gm_id, target_user_id: row.target_user_id,
    target_group: Boolean(row.target_group), target_name: row.target_name, character_id: row.character_id,
    character_name: row.character_name, action: row.action, stat: row.stat, difficulty: row.difficulty,
    stat_bonus: row.stat_bonus, circumstance: row.circumstance, context: row.context,
    expires_at: row.expires_at, status: row.status, result_roll_id: row.result_roll_id,
    resolved_at: row.resolved_at, created_at: row.created_at, result,
  }
}

function authAccount(req, res, next) {
  const id = verifySession(parseCookie(req.headers.cookie))
  const user = id && db.prepare('SELECT id,email,username,display_name,role,must_change_password,auth_user_id FROM users WHERE id=?').get(id)
  if (!user) return fail(res, 401, 'Connectez-vous pour continuer.')
  req.user = user
  next()
}
function authUser(req, res, next) {
  return authAccount(req, res, (error) => {
    if (error) return next(error)
    if (req.user.must_change_password) return fail(res, 428, 'Changez votre mot de passe avant de continuer.')
    req.campaign = oneCampaign(req.user.id)
    if (!req.campaign) return fail(res, 409, 'Choisissez ou créez une campagne pour continuer.')
    next()
  })
}
function requireGM(req, res, next) {
  if (!canManageCampaign(req.user, req.campaign)) return fail(res, 403, 'Cette action est réservée au Maître du Jeu.')
  next()
}
function requireActiveCampaign(req, res, next) {
  if (req.campaign.status !== 'active') return fail(res, 409, req.campaign.status === 'paused' ? 'La campagne est en pause.' : 'La campagne est arrêtée.')
  next()
}
function emitCampaign(campaignId, event, data) { io.to(`campaign:${campaignId}`).emit(event, data) }
async function matchesJoinPassword(campaign, password) {
  if (typeof password !== 'string' || !password) return false
  if (campaign.join_password_hash) return bcrypt.compare(password, campaign.join_password_hash)
  const expected = Buffer.from(String(campaign.invite_code || '').toUpperCase())
  const provided = Buffer.from(password.toUpperCase())
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
}

if (db.prepare('SELECT COUNT(*) AS total FROM users').get().total === 0) {
  const hash = bcrypt.hashSync('admin123', 12)
  db.prepare(`INSERT INTO users(email,username,password_hash,display_name,role,must_change_password)
    VALUES('yuta@local.invalid','Yuta',?,'Yuta','gm',1)`).run(hash)
}

app.get('/api/bootstrap', (_req, res) => res.json({ hasGame: db.prepare("SELECT 1 FROM campaigns WHERE is_open=1 AND status='active' LIMIT 1").get() !== undefined }))
app.get('/api/lobbies', (req, res) => {
  const gameId = normalizeGameId(req.query.gameId)
  const rows = gameId
    ? db.prepare(`SELECT c.id,c.game_id,c.name,c.is_open,c.created_at,u.display_name AS host_name,
      (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id=c.id) AS player_count
      FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE upper(replace(c.game_id,'-',''))=? AND c.status='active' LIMIT 1`).all(gameId)
    : db.prepare(`SELECT c.id,c.game_id,c.name,c.is_open,c.created_at,u.display_name AS host_name,
      (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id=c.id) AS player_count
      FROM campaigns c JOIN users u ON u.id=c.owner_id WHERE c.is_open=1 AND c.status='active' ORDER BY c.created_at DESC`).all()
  res.json(rows.map((row) => ({ id: row.id, gameId: row.game_id, name: row.name, isOpen: Boolean(row.is_open), hostName: row.host_name, playerCount: row.player_count, createdAt: row.created_at })))
})

app.post('/api/auth/register', async (req, res) => {
  const displayName = cleanText(req.body?.displayName, 40)
  const username = cleanText(req.body?.username, 24)
  const { identity, unavailable } = await verifySupabaseIdentity(req.body?.accessToken)
  if (unavailable) return fail(res, 503, 'Supabase est momentanément inaccessible. Réessaie dans un instant.')
  if (!identity) return fail(res, 401, 'La session Supabase a expiré. Connecte-toi à nouveau.')
  const email = cleanText(identity.email, 254).toLowerCase()
  const joinPassword = req.body?.joinPassword
  const campaignId = Number(req.body?.campaignId)
  if (!/^[a-zA-Z0-9._-]{2,24}$/.test(username)) return fail(res, 400, 'Le pseudo de connexion doit faire 2 à 24 caractères (lettres, chiffres, . _ -).')
  if (displayName.length < 2) return fail(res, 400, 'Le pseudo affiché doit contenir au moins 2 caractères.')
  if (req.body?.email && cleanText(req.body.email, 254).toLowerCase() !== email) return fail(res, 400, 'L’adresse de la session Supabase ne correspond pas au compte créé.')
  if (typeof joinPassword !== 'string' || joinPassword.length < 8 || joinPassword.length > 200) return fail(res, 400, 'Le mot de passe de partie doit contenir au moins 8 caractères.')
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId)
  if (!campaign) return fail(res, 404, 'Partie introuvable.')
  if (campaign.status !== 'active') return fail(res, 409, campaign.status === 'paused' ? 'Cette campagne est en pause.' : 'Cette campagne est arrêtée.')
  if (!await matchesJoinPassword(campaign, joinPassword)) return fail(res, 403, 'Mot de passe de partie incorrect.')
  if (db.prepare('SELECT 1 FROM users WHERE auth_user_id=?').get(identity.id)) return fail(res, 409, 'Ce compte Supabase possède déjà un profil sur ce PC. Connecte-toi plutôt.')
  if (db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?) OR username=? COLLATE NOCASE').get(email, username)) return fail(res, 409, 'Ce compte ou ce pseudo existe déjà sur ce PC. Connecte-toi avec ce profil ou lie son compte Supabase dans Réglages.')
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
  const joinPasswordHash = campaign.join_password_hash ? campaign.join_password_hash : await bcrypt.hash(String(campaign.invite_code), 12)
  try {
    const result = db.transaction(() => {
      const info = db.prepare(`INSERT INTO users(email,username,password_hash,display_name,role,auth_user_id)
        VALUES(?,?,?,?, 'player',?)`).run(email, username, passwordHash, displayName, identity.id)
      if (!campaign.join_password_hash) db.prepare('UPDATE campaigns SET join_password_hash=? WHERE id=?').run(joinPasswordHash, campaign.id)
      db.prepare('INSERT INTO campaign_members(campaign_id,user_id) VALUES(?,?)').run(campaign.id, info.lastInsertRowid)
      db.prepare('UPDATE users SET active_campaign_id=? WHERE id=?').run(campaign.id, info.lastInsertRowid)
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid)
      return { user }
    })()
    res.setHeader('Set-Cookie', sessionCookie(signSession(result.user.id), req.secure))
    res.status(201).json({ user: publicUser(result.user), campaign: campaignInfo(campaign, result.user.id) })
  } catch (error) { fail(res, error.status || 500, error.message || 'Impossible de créer le compte.') }
})

app.post('/api/auth/login', async (req, res) => {
  let user
  if (req.body?.accessToken) {
    const { identity, unavailable } = await verifySupabaseIdentity(req.body.accessToken)
    if (unavailable) return fail(res, 503, 'Supabase est momentanément inaccessible. Réessaie dans un instant.')
    if (!identity) return fail(res, 401, 'La session Supabase a expiré. Connecte-toi à nouveau.')
    user = db.prepare('SELECT * FROM users WHERE auth_user_id=?').get(identity.id)
    if (!user && req.body?.role === 'player') {
      const localEmail = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(identity.email)
      if (localEmail) return fail(res, 409, 'Ce profil existe déjà sur ce PC mais son compte Supabase n’est pas lié. Connecte-toi avec ton ancien identifiant puis lie-le dans Réglages.')
      const metadata = identity.user_metadata || {}
      const username = usernameFromIdentity(identity)
      const displayName = cleanText(metadata.displayName || metadata.display_name, 40) || username
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
      try {
        const created = db.prepare(`INSERT INTO users(email,username,password_hash,display_name,role,auth_user_id)
          VALUES(?,?,?,?,'player',?)`).run(identity.email.toLowerCase(), username, passwordHash, displayName, identity.id)
        user = db.prepare('SELECT * FROM users WHERE id=?').get(created.lastInsertRowid)
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Un profil avec ces informations existe déjà sur ce PC.')
        throw error
      }
    }
    if (!user) return fail(res, 409, 'Ce compte Supabase n’est pas encore lié à ce profil MJ. Connecte-toi avec l’ancien compte puis lie Supabase dans Réglages.')
  } else {
    const identifier = cleanText(req.body?.identifier ?? req.body?.email, 254)
    user = db.prepare('SELECT * FROM users WHERE auth_user_id IS NULL AND (lower(email)=lower(?) OR username=? COLLATE NOCASE)').get(identifier, identifier)
    if (!user || typeof req.body?.password !== 'string' || !(await bcrypt.compare(req.body.password, user.password_hash))) return fail(res, 401, 'Identifiant ou mot de passe incorrect.')
  }
  res.setHeader('Set-Cookie', sessionCookie(signSession(user.id), req.secure))
  res.json({ user: publicUser(user), campaign: campaignInfo(startupCampaign(user.id), user.id) })
})
app.post('/api/auth/link-supabase', authAccount, async (req, res) => {
  if (req.user.must_change_password) return fail(res, 428, 'Changez votre mot de passe avant de lier Supabase.')
  const { identity, unavailable } = await verifySupabaseIdentity(req.body?.accessToken)
  if (unavailable) return fail(res, 503, 'Supabase est momentanément inaccessible. Réessaie dans un instant.')
  if (!identity) return fail(res, 401, 'La session Supabase a expiré. Connecte-toi à nouveau.')
  if (req.user.auth_user_id && req.user.auth_user_id !== identity.id) return fail(res, 409, 'Un autre compte Supabase est déjà lié à ce profil.')
  const linkedElsewhere = db.prepare('SELECT id FROM users WHERE auth_user_id=? AND id<>?').get(identity.id, req.user.id)
  if (linkedElsewhere) return fail(res, 409, 'Ce compte Supabase est déjà lié à un autre profil sur ce PC.')
  const emailOwner = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(identity.email, req.user.id)
  if (emailOwner) return fail(res, 409, 'Cette adresse e-mail est déjà utilisée par un autre profil sur ce PC.')
  try {
    db.prepare('UPDATE users SET auth_user_id=?,email=?,must_change_password=0 WHERE id=?').run(identity.id, identity.email.toLowerCase(), req.user.id)
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)
    res.json({ user: publicUser(user), campaign: campaignInfo(startupCampaign(req.user.id), req.user.id) })
  } catch (error) {
    fail(res, error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500, error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Ce compte Supabase ou cette adresse e-mail est déjà lié.' : 'Impossible de lier le compte Supabase.')
  }
})
app.post('/api/auth/logout', (req, res) => { res.setHeader('Set-Cookie', clearSessionCookie(req.secure)); res.json({ ok: true }) })

app.get('/api/me', authAccount, (req, res) => res.json({ user: publicUser(req.user), campaign: campaignInfo(startupCampaign(req.user.id), req.user.id) }))
app.get('/api/campaigns', authAccount, (req, res) => {
  const rows = db.prepare(`SELECT c.* FROM campaigns c JOIN campaign_members m ON m.campaign_id=c.id
    WHERE m.user_id=? ORDER BY (c.id=(SELECT active_campaign_id FROM users WHERE id=?)) DESC,c.created_at DESC`).all(req.user.id, req.user.id)
  res.json(rows.map((campaign) => campaignInfo(campaign, req.user.id)))
})
app.delete('/api/campaigns/:id', authAccount, async (req, res) => {
  if (req.user.role !== 'gm') return fail(res, 403, 'Seul le MJ peut supprimer une campagne.')
  if (req.user.must_change_password) return fail(res, 428, 'Changez votre mot de passe avant de continuer.')
  const campaignId = Number(req.params.id)
  if (!integer(campaignId, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 400, 'Campagne invalide.')
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND owner_id=?').get(campaignId, req.user.id)
  if (!campaign) return fail(res, 404, 'Campagne introuvable.')
  db.transaction(() => {
    db.prepare('UPDATE users SET active_campaign_id=NULL WHERE active_campaign_id=?').run(campaignId)
    db.prepare('DELETE FROM campaigns WHERE id=?').run(campaignId)
  })()
  emitCampaign(campaignId, 'campaign:deleted', { campaignId })
  try { await fs.promises.rm(path.join(gameImageRoot, String(campaignId)), { recursive: true, force: true }) }
  catch (error) { console.error('Impossible de supprimer les images de la campagne', campaignId, error) }
  try { await fs.promises.rm(path.join(characterImageRoot, String(campaignId)), { recursive: true, force: true }) }
  catch (error) { console.error('Impossible de supprimer les portraits de la campagne', campaignId, error) }
  res.json({ campaign: campaignInfo(startupCampaign(req.user.id), req.user.id) })
})
app.patch('/api/account', authAccount, async (req, res) => {
  const username = cleanText(req.body?.username, 24)
  const displayName = cleanText(req.body?.displayName, 40)
  const currentPassword = req.body?.currentPassword
  const newPassword = req.body?.newPassword
  const supabaseLinked = Boolean(req.user.auth_user_id)
  if (!supabaseLinked && (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id).password_hash)))) return fail(res, 403, 'Mot de passe actuel incorrect.')
  if (supabaseLinked && newPassword) return fail(res, 400, 'Le mot de passe de ce compte se modifie via Supabase.')
  if (!/^[a-zA-Z0-9._-]{2,24}$/.test(username)) return fail(res, 400, 'Le pseudo de connexion doit faire 2 à 24 caractères (lettres, chiffres, . _ -).')
  if (displayName.length < 2) return fail(res, 400, 'Le pseudo affiché doit contenir au moins 2 caractères.')
  if (req.user.must_change_password && (typeof newPassword !== 'string' || newPassword.length < 10)) return fail(res, 400, 'Définissez un nouveau mot de passe d’au moins 10 caractères.')
  if (newPassword && (newPassword.length < 10 || newPassword.length > 200)) return fail(res, 400, 'Le nouveau mot de passe doit contenir 10 à 200 caractères.')
  try {
    const hash = !supabaseLinked && newPassword ? await bcrypt.hash(newPassword, 12) : null
    db.prepare(`UPDATE users SET username=?,display_name=?,password_hash=COALESCE(?,password_hash),
      must_change_password=CASE WHEN ? IS NULL THEN must_change_password ELSE 0 END WHERE id=?`)
      .run(username, displayName, hash, hash, req.user.id)
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)
    res.json({ user: publicUser(updated), campaign: campaignInfo(startupCampaign(req.user.id), req.user.id) })
  } catch (error) { fail(res, error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500, error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Ce pseudo est déjà utilisé.' : 'Impossible de modifier le compte.') }
})

app.post('/api/campaigns', authAccount, async (req, res) => {
  if (req.user.role !== 'gm') return fail(res, 403, 'Seul le MJ peut créer une campagne.')
  if (req.user.must_change_password) return fail(res, 428, 'Changez votre mot de passe avant de créer une campagne.')
  const name = cleanText(req.body?.name, 80)
  const joinPassword = req.body?.joinPassword
  if (name.length < 2) return fail(res, 400, 'Donnez un nom à la campagne.')
  if (typeof joinPassword !== 'string' || joinPassword.length < 8 || joinPassword.length > 200) return fail(res, 400, 'Le mot de passe de partie doit contenir au moins 8 caractères.')
  const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase()
  const gameId = `Y11-${crypto.randomBytes(5).toString('hex').toUpperCase()}`
  const joinPasswordHash = await bcrypt.hash(joinPassword, 12)
  const create = db.transaction(() => {
    const result = db.prepare('INSERT INTO campaigns(name,invite_code,game_id,join_password_hash,owner_id,is_open) VALUES(?,?,?,?,?,1)')
      .run(name, inviteCode, gameId, joinPasswordHash, req.user.id)
    db.prepare('INSERT INTO campaign_members(campaign_id,user_id) VALUES(?,?)').run(result.lastInsertRowid, req.user.id)
    db.prepare('UPDATE users SET active_campaign_id=? WHERE id=?').run(result.lastInsertRowid, req.user.id)
    return db.prepare('SELECT * FROM campaigns WHERE id=?').get(result.lastInsertRowid)
  })()
  res.status(201).json(campaignInfo(create, req.user.id))
})
app.post('/api/campaigns/:id/join', authAccount, async (req, res) => {
  if (req.user.must_change_password) return fail(res, 428, 'Changez votre mot de passe avant de rejoindre une partie.')
  if (req.user.role !== 'player') return fail(res, 403, 'Un compte MJ ne peut pas rejoindre comme joueur.')
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=?').get(Number(req.params.id))
  if (!campaign) return fail(res, 404, 'Partie introuvable.')
  if (campaign.status !== 'active') return fail(res, 409, campaign.status === 'paused' ? 'Cette campagne est en pause.' : 'Cette campagne est arrêtée.')
  if (!await matchesJoinPassword(campaign, req.body?.joinPassword)) return fail(res, 403, 'Mot de passe de partie incorrect.')
  if (!campaign.join_password_hash) db.prepare('UPDATE campaigns SET join_password_hash=? WHERE id=?').run(await bcrypt.hash(String(campaign.invite_code), 12), campaign.id)
  db.prepare('INSERT INTO campaign_members(campaign_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING').run(campaign.id, req.user.id)
  db.prepare('UPDATE users SET active_campaign_id=? WHERE id=?').run(campaign.id, req.user.id)
  res.json({ campaign: campaignInfo(campaign, req.user.id) })
})
app.post('/api/campaigns/:id/select', authAccount, (req, res) => {
  if (!member(Number(req.params.id), req.user.id)) return fail(res, 403, 'Vous ne faites pas partie de cette campagne.')
  db.prepare('UPDATE users SET active_campaign_id=? WHERE id=?').run(Number(req.params.id), req.user.id)
  const campaign = oneCampaign(req.user.id)
  res.json({ campaign: campaignInfo(campaign, req.user.id) })
})
app.patch('/api/campaign', authUser, requireGM, async (req, res) => {
  const name = cleanText(req.body?.name, 80)
  if (name.length < 2) return fail(res, 400, 'Le nom de la campagne doit contenir au moins deux caractères.')
  if (typeof req.body?.isOpen !== 'boolean') return fail(res, 400, 'État de session invalide.')
  const joinPassword = req.body?.joinPassword
  const status = req.body?.status ?? req.campaign.status ?? 'active'
  if (!['active', 'paused', 'stopped'].includes(status)) return fail(res, 400, 'État de campagne invalide.')
  if (joinPassword != null && joinPassword !== '' && (typeof joinPassword !== 'string' || joinPassword.length < 8 || joinPassword.length > 200)) return fail(res, 400, 'Le mot de passe de partie doit contenir au moins 8 caractères.')
  const hash = typeof joinPassword === 'string' && joinPassword ? await bcrypt.hash(joinPassword, 12) : null
  db.prepare("UPDATE campaigns SET name=?,is_open=?,status=?,join_password_hash=COALESCE(?,join_password_hash) WHERE id=?")
    .run(name, status === 'stopped' ? 0 : req.body.isOpen ? 1 : 0, status, hash, req.campaign.id)
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.campaign.id)
  emitCampaign(campaign.id, 'campaign:updated', campaignInfo(campaign, req.user.id))
  res.json(campaignInfo(campaign, req.user.id))
})
app.get('/api/tunnel', authUser, requireGM, (_req, res) => res.json(getTunnelStatus()))
app.post('/api/tunnel/start', authUser, requireGM, (_req, res) => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 3001
  const status = startPublicTunnel(port)
  res.json(status)
})
app.post('/api/tunnel/stop', authUser, requireGM, (_req, res) => res.json(stopPublicTunnel()))
app.get('/api/characters/:id/portrait/file', authUser, (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Portrait introuvable.')
  const characterRow = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!characterRow || !canReadCharacter(req.user, req.campaign, characterRow)) return fail(res, 404, 'Portrait introuvable.')
  const portrait = db.prepare('SELECT * FROM character_portraits WHERE character_id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!portrait || !/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(portrait.storage_name)) return fail(res, 404, 'Portrait introuvable.')
  const directory = path.join(characterImageRoot, String(req.campaign.id), String(id))
  const filePath = path.join(directory, portrait.storage_name)
  if (path.dirname(filePath) !== directory) return fail(res, 404, 'Portrait introuvable.')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.type(portrait.content_type).sendFile(filePath, (error) => {
    if (error && !res.headersSent) fail(res, 404, 'Portrait introuvable.')
  })
})
app.put('/api/characters/:id/portrait', authUser, async (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Personnage introuvable.')
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!character) return fail(res, 404, 'Personnage introuvable.')
  if (!canEditCharacter(req.user, req.campaign, character)) return fail(res, 403, 'Tu ne peux pas modifier le portrait de cette fiche.')
  if (req.user.role !== 'gm' && req.campaign.status !== 'active') return fail(res, 409, 'Les portraits des joueurs sont verrouillés pendant la pause ou après l’arrêt de la campagne.')
  const contentType = req.body?.contentType
  const data = req.body?.data
  const originalName = path.basename(cleanText(req.body?.name, 160)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120) || 'portrait'
  if (!imageTypes[contentType]) return fail(res, 400, 'Formats acceptés : JPG, PNG, GIF et WebP.')
  if (typeof data !== 'string' || data.length > 14_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return fail(res, 400, 'Le fichier image est invalide.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024) return fail(res, 413, 'Une image doit faire 10 Mo maximum.')
  if (!validImageSignature(contentType, bytes)) return fail(res, 400, 'Le contenu du fichier ne correspond pas à son format déclaré.')
  const directory = path.join(characterImageRoot, String(req.campaign.id), String(id))
  const storageName = `${crypto.randomBytes(12).toString('hex')}${imageTypes[contentType]}`
  const filePath = path.join(directory, storageName)
  try {
    await fs.promises.mkdir(directory, { recursive: true })
    await fs.promises.writeFile(filePath, bytes, { flag: 'wx' })
    const previous = db.prepare('SELECT storage_name FROM character_portraits WHERE character_id=?').get(id)
    db.prepare(`INSERT INTO character_portraits(character_id,campaign_id,storage_name,original_name,content_type,byte_size)
      VALUES(?,?,?,?,?,?) ON CONFLICT(character_id) DO UPDATE SET campaign_id=excluded.campaign_id,
      storage_name=excluded.storage_name,original_name=excluded.original_name,content_type=excluded.content_type,
      byte_size=excluded.byte_size,created_at=CURRENT_TIMESTAMP`).run(id, req.campaign.id, storageName, originalName, contentType, bytes.length)
    if (previous) await fs.promises.rm(path.join(directory, previous.storage_name), { force: true })
    emitCampaign(req.campaign.id, 'character:updated', { id })
    res.json(getCharacter(id))
  } catch (error) {
    try { await fs.promises.rm(filePath, { force: true }) } catch { /* Preserve the original failure. */ }
    console.error('Impossible d’enregistrer le portrait', id, error)
    fail(res, 500, 'Impossible d’enregistrer ce portrait.')
  }
})
app.delete('/api/characters/:id/portrait', authUser, async (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Personnage introuvable.')
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!character) return fail(res, 404, 'Personnage introuvable.')
  if (!canEditCharacter(req.user, req.campaign, character)) return fail(res, 403, 'Tu ne peux pas modifier le portrait de cette fiche.')
  if (req.user.role !== 'gm' && req.campaign.status !== 'active') return fail(res, 409, 'Les portraits des joueurs sont verrouillés pendant la pause ou après l’arrêt de la campagne.')
  const portrait = db.prepare('SELECT * FROM character_portraits WHERE character_id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!portrait) return res.json(getCharacter(id))
  db.prepare('DELETE FROM character_portraits WHERE character_id=?').run(id)
  try { await fs.promises.rm(path.join(characterImageRoot, String(req.campaign.id), String(id), portrait.storage_name), { force: true }) }
  catch (error) { console.error('Impossible de supprimer le portrait', id, error) }
  emitCampaign(req.campaign.id, 'character:updated', { id })
  res.json(getCharacter(id))
})
app.get('/api/game-images', authUser, (req, res) => {
  const rows = canManageCampaign(req.user, req.campaign)
    ? db.prepare('SELECT * FROM game_images WHERE campaign_id=? ORDER BY id DESC').all(req.campaign.id)
    : db.prepare('SELECT * FROM game_images WHERE campaign_id=? AND is_shown=1 ORDER BY id DESC LIMIT 1').all(req.campaign.id)
  res.json(rows.map(imageInfo))
})
app.get('/api/game-images/:id/file', authUser, (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Image introuvable.')
  const row = db.prepare('SELECT * FROM game_images WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!row || (!canManageCampaign(req.user, req.campaign) && !row.is_shown)) return fail(res, 404, 'Image introuvable.')
  const directory = path.join(gameImageRoot, String(req.campaign.id))
  const filePath = path.join(directory, row.storage_name)
  if (path.dirname(filePath) !== directory) return fail(res, 404, 'Image introuvable.')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.type(row.content_type).sendFile(filePath, (error) => {
    if (error && !res.headersSent) fail(res, 404, 'Image introuvable.')
  })
})
app.post('/api/game-images', authUser, requireGM, async (req, res) => {
  const contentType = req.body?.contentType
  const data = req.body?.data
  const fileName = path.basename(cleanText(req.body?.name, 160)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120) || 'image'
  if (!imageTypes[contentType]) return fail(res, 400, 'Formats acceptés : JPG, PNG, GIF et WebP.')
  if (typeof data !== 'string' || data.length > 14_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return fail(res, 400, 'Le fichier image est invalide.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 1 || bytes.length > 10 * 1024 * 1024) return fail(res, 413, 'Une image doit faire 10 Mo maximum.')
  if (!validImageSignature(contentType, bytes)) return fail(res, 400, 'Le contenu du fichier ne correspond pas à son format déclaré.')
  const directory = path.join(gameImageRoot, String(req.campaign.id))
  const storageName = `${crypto.randomBytes(12).toString('hex')}${imageTypes[contentType]}`
  const filePath = path.join(directory, storageName)
  try {
    await fs.promises.mkdir(directory, { recursive: true })
    await fs.promises.writeFile(filePath, bytes, { flag: 'wx' })
    const result = db.prepare(`INSERT INTO game_images(campaign_id,storage_name,original_name,content_type,byte_size)
      VALUES(?,?,?,?,?)`).run(req.campaign.id, storageName, fileName, contentType, bytes.length)
    const row = db.prepare('SELECT * FROM game_images WHERE id=?').get(result.lastInsertRowid)
    emitCampaign(req.campaign.id, 'game:images:updated', { campaignId: req.campaign.id })
    res.status(201).json(imageInfo(row))
  } catch (error) {
    try { await fs.promises.rm(filePath, { force: true }) } catch { /* Preserve the original failure. */ }
    console.error('Impossible d’enregistrer une image de jeu', error)
    fail(res, 500, 'Impossible d’enregistrer cette image.')
  }
})
app.patch('/api/game-images/:id', authUser, requireGM, (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Image introuvable.')
  if (typeof req.body?.isShown !== 'boolean') return fail(res, 400, 'État d’affichage invalide.')
  const image = db.prepare('SELECT * FROM game_images WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!image) return fail(res, 404, 'Image introuvable.')
  const update = db.transaction(() => {
    if (req.body.isShown) db.prepare('UPDATE game_images SET is_shown=0 WHERE campaign_id=?').run(req.campaign.id)
    db.prepare('UPDATE game_images SET is_shown=? WHERE id=?').run(req.body.isShown ? 1 : 0, id)
    return db.prepare('SELECT * FROM game_images WHERE id=?').get(id)
  })()
  emitCampaign(req.campaign.id, 'game:images:updated', { campaignId: req.campaign.id })
  res.json(imageInfo(update))
})
app.delete('/api/game-images/:id', authUser, requireGM, async (req, res) => {
  const id = Number(req.params.id)
  if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) return fail(res, 404, 'Image introuvable.')
  const image = db.prepare('SELECT * FROM game_images WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!image) return fail(res, 404, 'Image introuvable.')
  db.prepare('DELETE FROM game_images WHERE id=?').run(id)
  try { await fs.promises.rm(path.join(gameImageRoot, String(req.campaign.id), image.storage_name), { force: true }) }
  catch (error) { console.error('Impossible de supprimer une image de jeu', id, error) }
  emitCampaign(req.campaign.id, 'game:images:updated', { campaignId: req.campaign.id })
  res.json({ ok: true })
})
server.on('close', stopPublicTunnel)
app.get('/api/members', authUser, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.display_name,u.role,ch.id AS character_id,ch.name AS character_name
    FROM campaign_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN character_selections s ON s.campaign_id=m.campaign_id AND s.user_id=m.user_id
    LEFT JOIN characters ch ON ch.id=s.character_id
    WHERE m.campaign_id=? ORDER BY u.role DESC,u.display_name`).all(req.campaign.id)
  res.json(rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role, online: (online.get(row.id) || 0) > 0, characterId: row.character_id, characterName: row.character_name })))
})

app.get('/api/characters', authUser, (req, res) => {
  const rows = canManageCampaign(req.user, req.campaign)
    ? db.prepare('SELECT * FROM characters WHERE campaign_id=? ORDER BY name').all(req.campaign.id)
    : db.prepare('SELECT * FROM characters WHERE campaign_id=? AND owner_id=?').all(req.campaign.id, req.user.id)
  res.json(rows.map(characterInfo))
})
app.get('/api/active-character', authUser, (req, res) => {
  const selection = db.prepare(`SELECT c.* FROM character_selections s JOIN characters c ON c.id=s.character_id
    WHERE s.campaign_id=? AND s.user_id=?`).get(req.campaign.id, req.user.id)
  res.json(selection ? characterInfo(selection) : null)
})
app.post('/api/active-character', authUser, (req, res) => {
  const characterId = Number(req.body?.characterId)
  const character = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=? AND owner_id=?')
    .get(characterId, req.campaign.id, req.user.id)
  if (!character) return fail(res, 404, 'Choisissez un de vos personnages dans cette campagne.')
  db.prepare(`INSERT INTO character_selections(campaign_id,user_id,character_id) VALUES(?,?,?)
    ON CONFLICT(campaign_id,user_id) DO UPDATE SET character_id=excluded.character_id`)
    .run(req.campaign.id, req.user.id, character.id)
  emitCampaign(req.campaign.id, 'character:active', { userId: req.user.id, characterId: character.id })
  res.json(characterInfo(character))
})
app.post('/api/characters', authUser, (req, res) => {
  const gm = canManageCampaign(req.user, req.campaign)
  if (!gm && req.campaign.status !== 'active') return fail(res, 409, 'Vous ne pouvez pas créer de fiche pendant la pause ou après l’arrêt de la campagne.')
  if (!gm && req.user.role !== 'player') return fail(res, 403, 'Seuls le MJ et les joueurs peuvent créer une fiche.')
  const body = req.body || {}
  const kind = gm ? body.kind : 'player'
  if (gm && !['companion', 'npc', 'monster', 'other'].includes(kind)) return fail(res, 400, 'Choisissez compagnon, PNJ, monstre ou autre fiche MJ.')
  const name = cleanText(body.name, 60)
  if (name.length < 2) return fail(res, 400, 'Le personnage doit avoir un nom.')
  if (!validCreationStats(body.stats) && !(gm && body.allowCustomStats && validStatsObject(body.stats))) return fail(res, 400, 'Répartissez les bonus officiels ou activez les caractéristiques personnalisées du MJ.')
  if (gm && body.allowCustomStats && !validStatsObject(body.stats)) return fail(res, 400, 'Caractéristiques invalides.')
  const ownerId = gm && kind === 'companion' ? Number(body.ownerId) : req.user.id
  if (gm && kind === 'companion') {
    const assignedPlayer = db.prepare(`SELECT 1 FROM campaign_members m JOIN users u ON u.id=m.user_id
      WHERE m.campaign_id=? AND m.user_id=? AND u.role='player'`).get(req.campaign.id, ownerId)
    if (!assignedPlayer) return fail(res, 400, 'Attribuez le compagnon à un joueur de cette campagne.')
  }
  const ownerCount = db.prepare('SELECT COUNT(*) AS total FROM characters WHERE campaign_id=? AND owner_id=?').get(req.campaign.id, ownerId).total
  if ((!gm && ownerCount >= 10) || (gm && kind !== 'companion' && db.prepare('SELECT COUNT(*) AS total FROM characters WHERE campaign_id=? AND owner_id=?').get(req.campaign.id, req.user.id).total >= 200)) return fail(res, 409, 'La limite de fiches de cette campagne est atteinte.')
  const hpCurrent = gm && integer(body.hpCurrent, 0, 9999) ? body.hpCurrent : 20
  const hpMax = gm && integer(body.hpMax, 1, 9999) ? body.hpMax : 20
  const info = db.prepare(`INSERT INTO characters(campaign_id,owner_id,kind,name,age,species,origin,description,stats,hp_current,hp_max)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(req.campaign.id, ownerId, kind, name, cleanText(body.age, 40), cleanText(body.species, 60), cleanText(body.origin, 100), cleanText(body.description, 2000), json(body.stats), hpCurrent, hpMax)
  if (!gm || kind === 'companion') db.prepare(`INSERT INTO character_selections(campaign_id,user_id,character_id) VALUES(?,?,?)
    ON CONFLICT(campaign_id,user_id) DO NOTHING`).run(req.campaign.id, ownerId, info.lastInsertRowid)
  const character = getCharacter(info.lastInsertRowid)
  emitCampaign(req.campaign.id, 'character:updated', { id: character.id })
  res.status(201).json(character)
})
app.patch('/api/characters/:id', authUser, (req, res) => {
  const id = Number(req.params.id)
  const current = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(id, req.campaign.id)
  if (!current) return fail(res, 404, 'Personnage introuvable.')
  const gm = canManageCampaign(req.user, req.campaign)
  if (!canEditCharacter(req.user, req.campaign, current)) return fail(res, 403, 'Vous ne pouvez modifier que votre personnage.')
  if (!gm && req.campaign.status !== 'active') return fail(res, 409, 'Les fiches des joueurs sont verrouillées pendant la pause ou après l’arrêt de la campagne.')
  const body = req.body || {}
  if (!gm && ('equipment' in body || 'gold' in body)) return fail(res, 403, 'Seul le MJ peut modifier l’inventaire et les golds.')
  const set = {}
  for (const key of ['name', 'age', 'species', 'origin', 'description']) {
    if (key in body) set[key] = cleanText(body[key], key === 'description' ? 2000 : 100)
  }
  if ('portrait' in body) set.portrait = cleanText(body.portrait, 500)
  if (gm) {
    if ('stats' in body) {
      if (!body.allowCustomStats && !validCreationStats(body.stats)) return fail(res, 400, 'La répartition ne respecte pas les bonus officiels. Activez la dérogation MJ si besoin.')
      if (!body.stats || STATS.some((stat) => !Number.isInteger(body.stats[stat])) || Object.keys(body.stats).length !== STATS.length || Object.values(body.stats).some((v) => v < -99 || v > 99)) return fail(res, 400, 'Caractéristiques invalides.')
      set.stats = json(body.stats)
    }
    if ('hpCurrent' in body && integer(body.hpCurrent, 0, 9999)) set.hp_current = body.hpCurrent
    if ('hpMax' in body && integer(body.hpMax, 1, 9999)) set.hp_max = body.hpMax
    for (const [key, column] of [['wounds', 'wounds'], ['states', 'states'], ['magic', 'magic'], ['goals', 'goals'], ['relationships', 'relationships']]) if (key in body) set[column] = cleanText(body[key], 2000)
    if ('experience' in body && integer(body.experience, 0, 1000000)) set.experience = body.experience
    if ('talents' in body && Array.isArray(body.talents) && body.talents.length <= 40) set.talents = json(body.talents.slice(0, 40).map((v) => ({ name: cleanText(v.name, 80), description: cleanText(v.description, 500), effect: cleanText(v.effect, 500), notes: cleanText(v.notes, 500) })))
    if ('equipment' in body && Array.isArray(body.equipment) && body.equipment.length <= 100) set.equipment = json(body.equipment.slice(0, 100).map((v) => cleanText(v, 120)))
    if ('gold' in body) {
      if (!integer(body.gold, 0, 999999999)) return fail(res, 400, 'Le nombre de golds doit être un entier positif.')
      set.gold = body.gold
    }
  }
  if (!Object.keys(set).length) return res.json(characterInfo(current))
  set.updated_at = new Date().toISOString()
  const sql = Object.keys(set).map((key) => `${key}=@${key}`).join(',')
  db.prepare(`UPDATE characters SET ${sql} WHERE id=@id`).run({ ...set, id })
  const character = getCharacter(id)
  emitCampaign(req.campaign.id, 'character:updated', { id: character.id })
  res.json(character)
})

app.get('/api/rolls', authUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM rolls WHERE campaign_id=? ORDER BY id DESC LIMIT 100').all(req.campaign.id)
  res.json(rows.map((row) => ({ ...row, dice: JSON.parse(row.dice), detail: safeJson(row.detail, null) })))
})
app.post('/api/rolls', authUser, requireActiveCampaign, (req, res) => {
  const input = req.body || {}
  let dice = { count: input.count, sides: input.sides, modifier: input.modifier ?? 0 }
  if (input.notation !== undefined) {
    const parsed = parseNotation(input.notation)
    if (!parsed) return fail(res, 400, 'Notation invalide. Exemple : 3d6+2 (maximum 20 dés, 1 000 faces).')
    dice = parsed
  }
  const validationError = validateDice(dice)
  if (validationError) return fail(res, 400, validationError)
  let character = null
  if (input.characterId !== undefined && input.characterId !== null) {
    character = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(Number(input.characterId), req.campaign.id)
    if (!character) return fail(res, 404, 'Personnage introuvable.')
    if (!canReadCharacter(req.user, req.campaign, character)) return fail(res, 403, 'Vous ne pouvez lancer qu’au nom de votre personnage.')
  }
  const results = Array.from({ length: dice.count }, () => crypto.randomInt(1, dice.sides + 1))
  const total = results.reduce((sum, value) => sum + value, 0) + dice.modifier
  const notation = `${dice.count}d${dice.sides}${dice.modifier > 0 ? `+${dice.modifier}` : dice.modifier < 0 ? dice.modifier : ''}`
  const info = db.prepare(`INSERT INTO rolls(campaign_id,user_id,character_id,display_name,character_name,notation,dice,modifier,total)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(req.campaign.id, req.user.id, character?.id ?? null, req.user.display_name, character?.name ?? null, notation, json(results), dice.modifier, total)
  const roll = getRoll(info.lastInsertRowid)
  emitCampaign(req.campaign.id, 'roll:new', roll)
  res.status(201).json(roll)
})

app.get('/api/requests', authUser, (req, res) => {
  const rows = req.user.role === 'gm'
    ? db.prepare('SELECT id FROM roll_requests WHERE campaign_id=? ORDER BY created_at DESC LIMIT 100').all(req.campaign.id)
    : db.prepare(`SELECT id FROM roll_requests WHERE campaign_id=? AND (target_user_id=? OR target_group=1) ORDER BY created_at DESC LIMIT 100`).all(req.campaign.id, req.user.id)
  res.json(rows.map((row) => getRequest(row.id)))
})
app.post('/api/requests', authUser, requireActiveCampaign, requireGM, (req, res) => {
  const body = req.body || {}
  const action = cleanText(body.action, 120)
  const stat = body.stat
  const difficulty = body.difficulty
  const statBonus = body.statBonus
  const circumstance = body.circumstance ?? 0
  const targetGroup = body.targetGroup === true
  const targetUserId = targetGroup ? null : Number(body.targetUserId)
  if (action.length < 2) return fail(res, 400, 'Décrivez l’action demandée.')
  if (!STATS.includes(stat)) return fail(res, 400, 'Choisissez une caractéristique officielle.')
  if (!integer(difficulty, -1000, 1000)) return fail(res, 400, 'Difficulté invalide (de -1 000 à 1 000).')
  if (![0, 1, 2, 3].includes(statBonus)) return fail(res, 400, 'Le bonus doit être +0, +1, +2 ou +3.')
  if (!integer(circumstance, -1000, 1000)) return fail(res, 400, 'Modificateur circonstanciel invalide.')
  if (!targetGroup && (!integer(targetUserId, 1, Number.MAX_SAFE_INTEGER) || !member(req.campaign.id, targetUserId) || db.prepare('SELECT role FROM users WHERE id=?').get(targetUserId)?.role !== 'player')) return fail(res, 400, 'Choisissez un joueur de cette campagne.')
  let characterId = null
  if (body.characterId !== undefined && body.characterId !== null && body.characterId !== '') {
    characterId = Number(body.characterId)
    const character = db.prepare('SELECT * FROM characters WHERE id=? AND campaign_id=?').get(characterId, req.campaign.id)
    if (!character || (!targetGroup && character.owner_id !== targetUserId)) return fail(res, 400, 'Ce personnage ne correspond pas au joueur choisi.')
  }
  let expiresAt = null
  if (body.expiresMinutes !== undefined && body.expiresMinutes !== null && body.expiresMinutes !== '') {
    const minutes = Number(body.expiresMinutes)
    if (!integer(minutes, 1, 1440)) return fail(res, 400, 'L’expiration doit être comprise entre 1 minute et 24 heures.')
    expiresAt = new Date(Date.now() + minutes * 60000).toISOString()
  }
  const id = crypto.randomUUID()
  db.prepare(`INSERT INTO roll_requests(id,campaign_id,gm_id,target_user_id,target_group,character_id,action,stat,difficulty,stat_bonus,circumstance,context,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, req.campaign.id, req.user.id, targetUserId, targetGroup ? 1 : 0, characterId, action, stat, difficulty, statBonus, circumstance, cleanText(body.context, 600), expiresAt)
  const request = getRequest(id)
  emitCampaign(req.campaign.id, 'request:new', request)
  res.status(201).json(request)
})
app.post('/api/requests/:id/resolve', authUser, requireActiveCampaign, (req, res) => {
  const current = db.prepare('SELECT * FROM roll_requests WHERE id=? AND campaign_id=?').get(req.params.id, req.campaign.id)
  if (!current) return fail(res, 404, 'Requête introuvable.')
  if (!canAnswerRequest(req.user, req.campaign, current)) return fail(res, 403, 'Cette requête ne vous est pas destinée.')
  if (current.status !== 'pending') return fail(res, 409, 'Cette requête a déjà été traitée.')
  if (current.expires_at && Date.parse(current.expires_at) <= Date.now()) {
    db.prepare("UPDATE roll_requests SET status='expired' WHERE id=? AND status='pending'").run(current.id)
    emitCampaign(req.campaign.id, 'request:updated', getRequest(current.id))
    return fail(res, 410, 'Cette requête a expiré.')
  }
  if (current.character_id) {
    const character = db.prepare('SELECT * FROM characters WHERE id=?').get(current.character_id)
    if (!character || !canReadCharacter(req.user, req.campaign, character)) return fail(res, 403, 'Cette requête ne concerne pas votre personnage.')
  }
  const natural = crypto.randomInt(1, 21)
  const { total, verdict } = resolveCheck({ natural, statBonus: current.stat_bonus, circumstance: current.circumstance, difficulty: current.difficulty })
  const character = current.character_id ? db.prepare('SELECT * FROM characters WHERE id=?').get(current.character_id) : null
  const detail = { natural, stat: current.stat, statBonus: current.stat_bonus, circumstance: current.circumstance, difficulty: current.difficulty, verdict, action: current.action }
  const transaction = db.transaction(() => {
    const info = db.prepare(`INSERT INTO rolls(campaign_id,user_id,character_id,display_name,character_name,notation,dice,modifier,total,kind,detail)
      VALUES(?,?,?,?,?,?,?,?,?,'request',?)`).run(req.campaign.id, req.user.id, character?.id ?? null, req.user.display_name, character?.name ?? null, '1d20', json([natural]), current.stat_bonus + current.circumstance, total, json(detail))
    const updated = db.prepare("UPDATE roll_requests SET status='resolved',result_roll_id=?,resolved_at=? WHERE id=? AND status='pending'").run(info.lastInsertRowid, new Date().toISOString(), current.id)
    if (!updated.changes) throw Object.assign(new Error('Cette requête a déjà été traitée.'), { status: 409 })
    return getRoll(info.lastInsertRowid)
  })
  let roll
  try { roll = transaction() } catch (error) { return fail(res, error.status || 500, error.message) }
  const request = getRequest(current.id)
  emitCampaign(req.campaign.id, 'roll:new', roll)
  emitCampaign(req.campaign.id, 'request:updated', request)
  res.json({ request, roll })
})
app.post('/api/requests/:id/cancel', authUser, requireGM, (req, res) => {
  const current = db.prepare('SELECT * FROM roll_requests WHERE id=? AND campaign_id=?').get(req.params.id, req.campaign.id)
  if (!current) return fail(res, 404, 'Requête introuvable.')
  if (current.status !== 'pending') return fail(res, 409, 'Cette requête a déjà été traitée.')
  db.prepare("UPDATE roll_requests SET status='cancelled' WHERE id=? AND status='pending'").run(current.id)
  const request = getRequest(current.id)
  emitCampaign(req.campaign.id, 'request:updated', request)
  res.json(request)
})

app.use('/api', (_req, res) => fail(res, 404, 'Route introuvable.'))
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.parse.failed') return fail(res, 400, 'Corps de requête JSON invalide.')
  console.error(error)
  fail(res, 500, 'Une erreur interne est survenue.')
})

const online = new Map()
io.use((socket, next) => {
  const userId = verifySession(parseCookie(socket.handshake.headers.cookie))
  const user = userId && db.prepare('SELECT id,email,display_name,role FROM users WHERE id=?').get(userId)
  const campaign = user && oneCampaign(user.id)
  if (!user || !campaign) return next(new Error('unauthorized'))
  socket.data.user = user
  socket.data.campaign = campaign
  next()
})
io.on('connection', (socket) => {
  const { user, campaign } = socket.data
  socket.join(`campaign:${campaign.id}`)
  online.set(user.id, (online.get(user.id) || 0) + 1)
  emitCampaign(campaign.id, 'presence:update', { userId: user.id, online: true })
  socket.on('disconnect', () => {
    const nextCount = Math.max(0, (online.get(user.id) || 1) - 1)
    if (nextCount) online.set(user.id, nextCount)
    else online.delete(user.id)
    if (!nextCount) emitCampaign(campaign.id, 'presence:update', { userId: user.id, online: false })
  })
})

export function startServer({ port = Number(process.env.PORT || 3001), host = '0.0.0.0', onListening } = {}) {
  server.listen(port, host, () => {
    const address = server.address()
    console.log(`Yuta et les 11 — serveur sur http://localhost:${typeof address === 'object' ? address.port : port}`)
    onListening?.(address)
  })
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) startServer()

export { app, db, io, server }

