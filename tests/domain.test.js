import test from 'node:test'
import assert from 'node:assert/strict'
import { canAnswerRequest, canEditCharacter, canManageCampaign, canReadCharacter, parseNotation, resolveCheck, validCreationStats, validateDice } from '../server/domain.js'

const stats = { Force: 3, Constitution: 2, Agilité: 1, Magie: 1, Perception: 0, Intelligence: 0, Charisme: 0 }

test('la création accepte uniquement la distribution officielle des sept bonus', () => {
  assert.equal(validCreationStats(stats), true)
  assert.equal(validCreationStats({ ...stats, Force: 2 }), false)
  assert.equal(validCreationStats({ ...stats, Bonus: 0 }), false)
  assert.equal(validCreationStats(null), false)
})

test('les dés acceptent plusieurs faces et bornent les entrées', () => {
  assert.deepEqual(parseNotation('5d6+3'), { count: 5, sides: 6, modifier: 3 })
  assert.deepEqual(parseNotation('2D100'), { count: 2, sides: 100, modifier: 0 })
  assert.equal(parseNotation('21d6'), null)
  assert.equal(parseNotation('1d1'), null)
  assert.match(validateDice({ count: 21, sides: 20, modifier: 0 }), /nombre de dés/)
  assert.match(validateDice({ count: 1, sides: 1001, modifier: 0 }), /faces/)
})

test('les critiques naturels prévalent sur le total et le seuil', () => {
  assert.deepEqual(resolveCheck({ natural: 20, statBonus: 0, difficulty: 100 }), { total: 20, verdict: 'critical_success' })
  assert.deepEqual(resolveCheck({ natural: 1, statBonus: 30, difficulty: 2 }), { total: 31, verdict: 'critical_failure' })
  assert.deepEqual(resolveCheck({ natural: 12, statBonus: 3, difficulty: 15 }), { total: 15, verdict: 'success' })
  assert.deepEqual(resolveCheck({ natural: 12, statBonus: 2, difficulty: 15 }), { total: 14, verdict: 'failure' })
})

test('les politiques limitent la gestion, la lecture et la réponse au bon participant', () => {
  const gm = { id: 1, role: 'gm' }
  const player = { id: 2, role: 'player' }
  const otherPlayer = { id: 3, role: 'player' }
  const campaign = { id: 7, owner_id: 1 }
  const character = { campaign_id: 7, owner_id: 2 }
  const otherCampaignCharacter = { campaign_id: 8, owner_id: 2 }
  const request = { campaign_id: 7, target_user_id: 2, target_group: false }
  assert.equal(canManageCampaign(gm, campaign), true)
  assert.equal(canManageCampaign(player, campaign), false)
  assert.equal(canReadCharacter(gm, campaign, character), true)
  assert.equal(canReadCharacter(player, campaign, character), true)
  assert.equal(canReadCharacter(otherPlayer, campaign, character), false)
  assert.equal(canEditCharacter(otherPlayer, campaign, character), false)
  assert.equal(canReadCharacter(gm, campaign, otherCampaignCharacter), false)
  assert.equal(canAnswerRequest(player, campaign, request), true)
  assert.equal(canAnswerRequest(otherPlayer, campaign, request), false)
  assert.equal(canAnswerRequest(gm, campaign, request), true)
  assert.equal(canAnswerRequest(player, { ...campaign, id: 9 }, request), false)
  assert.equal(canAnswerRequest(otherPlayer, campaign, { ...request, target_group: true }), true)
})

