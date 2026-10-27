import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { io as socketClient } from 'socket.io-client'

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuta-test-'))
process.env.DATA_DIR = testDataDir
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
const { db, server } = await import('../server/index.js')
let origin
let gmCookie
let playerCookie
let secondPlayerCookie
let campaign
let player
let playerCharacter

async function call(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
const playerAccount = (name, email, campaignId, joinPassword = 'mot-de-passe-session') => ({ username: name, displayName: name, email, password: 'motdepasse-test-123', joinPassword, campaignId })

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`

  const defaultAdmin = await call('/api/auth/login', { method: 'POST', body: { identifier: 'Yuta', password: 'admin123' } })
  assert.equal(defaultAdmin.status, 200)
  gmCookie = defaultAdmin.cookie
  assert.equal(defaultAdmin.data.user.mustChangePassword, true)
  assert.equal((await call('/api/campaigns', { method: 'POST', cookie: gmCookie, body: { name: 'Bloquée' } })).status, 428)
  const secured = await call('/api/account', { method: 'PATCH', cookie: gmCookie, body: {
    username: 'Yuta', displayName: 'Yuta', currentPassword: 'admin123', newPassword: 'nouveau-mot-de-passe-MJ',
  } })
  assert.equal(secured.status, 200)
  assert.equal(secured.data.user.mustChangePassword, false)

  const createdCampaign = await call('/api/campaigns', { method: 'POST', cookie: gmCookie, body: { name: 'Les Veilleurs', joinPassword: 'mot-de-passe-session' } })
  assert.equal(createdCampaign.status, 201)
  campaign = createdCampaign.data
  assert.equal((await call('/api/lobbies')).data[0].id, campaign.id)

  await call('/api/campaign', { method: 'PATCH', cookie: gmCookie, body: { name: campaign.name, isOpen: false } })
  const deniedInvite = await call('/api/auth/register', { method: 'POST', body: playerAccount('Mira', 'mira@example.test', campaign.id, 'mauvais-mot-de-passe') })
  assert.equal(deniedInvite.status, 403)
  await call('/api/campaign', { method: 'PATCH', cookie: gmCookie, body: { name: campaign.name, isOpen: true } })

  const createdPlayer = await call('/api/auth/register', { method: 'POST', body: playerAccount('Mira', 'mira@example.test', campaign.id) })
  assert.equal(createdPlayer.status, 201)
  playerCookie = createdPlayer.cookie
  player = createdPlayer.data.user
  const createdSecondPlayer = await call('/api/auth/register', { method: 'POST', body: playerAccount('Haru', 'haru@example.test', campaign.id) })
  assert.equal(createdSecondPlayer.status, 201)
  secondPlayerCookie = createdSecondPlayer.cookie

  const createdCharacter = await call('/api/characters', { method: 'POST', cookie: playerCookie, body: {
    name: 'Mira', stats: { Force: 3, Constitution: 2, Agilité: 1, Magie: 1, Perception: 0, Intelligence: 0, Charisme: 0 },
  } })
  assert.equal(createdCharacter.status, 201)
  playerCharacter = createdCharacter.data
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  fs.rmSync(testDataDir, { recursive: true, force: true })
})

test('le compte Yuta est précréé et impose un nouveau mot de passe au premier accès', async () => {
  const loginWithOldPassword = await call('/api/auth/login', { method: 'POST', body: { identifier: 'Yuta', password: 'admin123' } })
  assert.equal(loginWithOldPassword.status, 401)
  const currentProfile = await call('/api/me', { cookie: gmCookie })
  assert.equal(currentProfile.data.user.username, 'Yuta')
  assert.equal(currentProfile.data.user.mustChangePassword, false)
})

test('un lien de partie retrouve le salon par son ID', async () => {
  const response = await call(`/api/lobbies?gameId=${encodeURIComponent(campaign.gameId)}`)
  assert.equal(response.status, 200)
  assert.equal(response.data.length, 1)
  assert.equal(response.data[0].id, campaign.id)
  assert.equal(response.data[0].gameId, campaign.gameId)
})

test('le MJ gère les golds et l’inventaire, les joueurs ne peuvent pas les modifier', async () => {
  const denied = await call(`/api/characters/${playerCharacter.id}`, {
    method: 'PATCH', cookie: playerCookie, body: { gold: 999, equipment: ['Épée'] },
  })
  assert.equal(denied.status, 403)

  const updated = await call(`/api/characters/${playerCharacter.id}`, {
    method: 'PATCH', cookie: gmCookie, body: { gold: 125, equipment: ['Épée de voyage', 'Potion × 2'] },
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.gold, 125)
  assert.deepEqual(updated.data.equipment, ['Épée de voyage', 'Potion × 2'])

  const visibleToPlayer = await call('/api/active-character', { cookie: playerCookie })
  assert.equal(visibleToPlayer.data.gold, 125)
  assert.deepEqual(visibleToPlayer.data.equipment, ['Épée de voyage', 'Potion × 2'])
})

test('les joueurs ne peuvent ni lire ni modifier la fiche d’un autre joueur et peuvent créer plusieurs héros', async () => {
  const forbiddenEdit = await call(`/api/characters/${playerCharacter.id}`, {
    method: 'PATCH', cookie: secondPlayerCookie, body: { name: 'Fiche volée', stats: playerCharacter.stats },
  })
  assert.equal(forbiddenEdit.status, 403)
  const visible = await call('/api/characters', { cookie: secondPlayerCookie })
  assert.equal(visible.status, 200)
  assert.deepEqual(visible.data, [])
  const validEdit = await call(`/api/characters/${playerCharacter.id}`, {
    method: 'PATCH', cookie: playerCookie, body: { description: 'Une histoire commence.' },
  })
  assert.equal(validEdit.status, 200)
  assert.equal(validEdit.data.description, 'Une histoire commence.')
  const secondHero = await call('/api/characters', { method: 'POST', cookie: playerCookie, body: {
    name: 'Mira, plus tard', stats: { Force: 3, Constitution: 2, Agilité: 1, Magie: 1, Perception: 0, Intelligence: 0, Charisme: 0 },
  } })
  assert.equal(secondHero.status, 201)
  const selected = await call('/api/active-character', { method: 'POST', cookie: playerCookie, body: { characterId: secondHero.data.id } })
  assert.equal(selected.data.id, secondHero.data.id)
})

test('seul le MJ crée une requête et seul le joueur visé peut la résoudre une fois', async () => {
  const denied = await call('/api/requests', { method: 'POST', cookie: playerCookie, body: { action: 'Escalader', stat: 'Force', difficulty: 15, statBonus: 3, targetUserId: player.id } })
  assert.equal(denied.status, 403)
  const created = await call('/api/requests', { method: 'POST', cookie: gmCookie, body: {
    action: 'Franchir le gouffre', stat: 'Force', difficulty: 15, statBonus: 3, circumstance: 1,
    targetUserId: player.id, characterId: playerCharacter.id,
  } })
  assert.equal(created.status, 201)
  const requestId = created.data.id
  const wrongPlayer = await call(`/api/requests/${requestId}/resolve`, { method: 'POST', cookie: secondPlayerCookie, body: { difficulty: -500, statBonus: 0 } })
  assert.equal(wrongPlayer.status, 403)
  const resolved = await call(`/api/requests/${requestId}/resolve`, { method: 'POST', cookie: playerCookie, body: { difficulty: -500, statBonus: 0 } })
  assert.equal(resolved.status, 200)
  const detail = resolved.data.roll.detail
  assert.equal(detail.difficulty, 15)
  assert.equal(detail.statBonus, 3)
  assert.equal(detail.circumstance, 1)
  assert.equal(resolved.data.roll.total, detail.natural + 4)
  assert.ok(detail.natural >= 1 && detail.natural <= 20)
  assert.equal((await call(`/api/requests/${requestId}/resolve`, { method: 'POST', cookie: playerCookie })).status, 409)
})

test('un lancer sauvegardé est diffusé en direct au MJ et au joueur connecté', async () => {
  const gmSocket = socketClient(origin, { extraHeaders: { cookie: gmCookie }, reconnection: false })
  const playerSocket = socketClient(origin, { extraHeaders: { cookie: playerCookie }, reconnection: false })
  const connected = (socket) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai de connexion Socket.IO dépassé.')), 4000)
    socket.once('connect', () => { clearTimeout(timer); resolve() })
    socket.once('connect_error', (error) => { clearTimeout(timer); reject(error) })
  })
  const received = (socket) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le lancer n’a pas été diffusé en direct.')), 4000)
    socket.once('roll:new', (roll) => { clearTimeout(timer); resolve(roll) })
  })
  try {
    await Promise.all([connected(gmSocket), connected(playerSocket)])
    const gmSawRoll = received(gmSocket)
    const playerSawRoll = received(playerSocket)
    const created = await call('/api/rolls', { method: 'POST', cookie: playerCookie, body: { count: 1, sides: 20, modifier: 0 } })
    assert.equal(created.status, 201)
    const [gmRoll, playerRoll] = await Promise.all([gmSawRoll, playerSawRoll])
    assert.equal(gmRoll.id, created.data.id)
    assert.equal(playerRoll.id, created.data.id)
  } finally { gmSocket.close(); playerSocket.close() }
})

test('le MJ crée des PNJ et attribue des compagnons jouables aux joueurs', async () => {
  const npc = await call('/api/characters', { method: 'POST', cookie: gmCookie, body: {
    kind: 'npc', name: 'Gardienne du pont', stats: playerCharacter.stats,
  } })
  assert.equal(npc.status, 201)
  assert.equal(npc.data.kind, 'npc')
  assert.equal(npc.data.owner_id, 1)

  const companion = await call('/api/characters', { method: 'POST', cookie: gmCookie, body: {
    kind: 'companion', ownerId: player.id, name: 'Asha', stats: playerCharacter.stats,
  } })
  assert.equal(companion.status, 201)
  assert.equal(companion.data.kind, 'companion')
  assert.equal(companion.data.owner_id, player.id)

  const gmCharacters = await call('/api/characters', { cookie: gmCookie })
  assert.ok(gmCharacters.data.some((character) => character.id === npc.data.id))
  const playerCharacters = await call('/api/characters', { cookie: playerCookie })
  assert.ok(playerCharacters.data.some((character) => character.id === companion.data.id))
  assert.ok(!playerCharacters.data.some((character) => character.id === npc.data.id))
  const selected = await call('/api/active-character', { method: 'POST', cookie: playerCookie, body: { characterId: companion.data.id } })
  assert.equal(selected.status, 200)
  assert.equal(selected.data.id, companion.data.id)
})

test('le MJ peut créer, sélectionner, mettre en pause, arrêter et reprendre ses campagnes', async () => {
  const initialList = await call('/api/campaigns', { cookie: gmCookie })
  assert.equal(initialList.status, 200)
  assert.ok(initialList.data.some((item) => item.id === campaign.id && item.isOwner))

  const created = await call('/api/campaigns', { method: 'POST', cookie: gmCookie, body: {
    name: 'La seconde chronique', joinPassword: 'mot-de-passe-seconde',
  } })
  assert.equal(created.status, 201)
  assert.equal(created.data.status, 'active')
  const secondCampaign = created.data
  const switchedBack = await call(`/api/campaigns/${campaign.id}/select`, { method: 'POST', cookie: gmCookie })
  assert.equal(switchedBack.data.campaign.id, campaign.id)

  const paused = await call('/api/campaign', { method: 'PATCH', cookie: gmCookie, body: {
    name: campaign.name, isOpen: true, joinPassword: '', status: 'paused',
  } })
  assert.equal(paused.status, 200)
  assert.equal(paused.data.status, 'paused')
  assert.equal((await call(`/api/lobbies?gameId=${encodeURIComponent(campaign.gameId)}`)).data.length, 0)
  assert.equal((await call('/api/rolls', { method: 'POST', cookie: gmCookie, body: { count: 1, sides: 20 } })).status, 409)
  assert.equal((await call(`/api/campaigns/${campaign.id}/join`, { method: 'POST', cookie: playerCookie, body: { joinPassword: 'mot-de-passe-session' } })).status, 409)

  const stopped = await call('/api/campaign', { method: 'PATCH', cookie: gmCookie, body: {
    name: campaign.name, isOpen: true, joinPassword: '', status: 'stopped',
  } })
  assert.equal(stopped.data.status, 'stopped')
  assert.equal(stopped.data.isOpen, false)
  const resumed = await call('/api/campaign', { method: 'PATCH', cookie: gmCookie, body: {
    name: campaign.name, isOpen: true, joinPassword: '', status: 'active',
  } })
  assert.equal(resumed.data.status, 'active')
  assert.equal((await call('/api/campaigns', { cookie: gmCookie })).data.some((item) => item.id === secondCampaign.id), true)
})

