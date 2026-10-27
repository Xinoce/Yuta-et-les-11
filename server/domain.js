export const STATS = ['Force', 'Constitution', 'Agilité', 'Magie', 'Perception', 'Intelligence', 'Charisme']
export const CREATION_BONUSES = [3, 2, 1, 1, 0, 0, 0]
export const DIE_LIMITS = { maxCount: 20, maxSides: 1000, maxModifier: 10000 }

export function validCreationStats(stats) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false
  if (Object.keys(stats).length !== STATS.length || STATS.some((key) => !Number.isInteger(stats[key]))) return false
  return [...Object.values(stats)].sort((a, b) => b - a).every((value, index) => value === CREATION_BONUSES[index])
}

export function validateDice({ count, sides, modifier = 0 }) {
  if (!Number.isInteger(count) || count < 1 || count > DIE_LIMITS.maxCount) return 'Le nombre de dés doit être compris entre 1 et 20.'
  if (!Number.isInteger(sides) || sides < 2 || sides > DIE_LIMITS.maxSides) return 'Un dé doit avoir entre 2 et 1 000 faces.'
  if (!Number.isInteger(modifier) || Math.abs(modifier) > DIE_LIMITS.maxModifier) return 'Le modificateur doit être compris entre -10 000 et +10 000.'
  return null
}

export function parseNotation(notation) {
  if (typeof notation !== 'string' || notation.length > 32) return null
  const match = notation.trim().match(/^(\d{1,2})\s*d\s*(\d{1,4})(?:\s*([+-])\s*(\d{1,5}))?$/i)
  if (!match) return null
  const count = Number(match[1])
  const sides = Number(match[2])
  const magnitude = Number(match[4] || 0)
  const modifier = match[3] === '-' ? -magnitude : magnitude
  return validateDice({ count, sides, modifier }) ? null : { count, sides, modifier }
}

export function resolveCheck({ natural, statBonus, circumstance = 0, difficulty }) {
  const total = natural + statBonus + circumstance
  const verdict = natural === 20 ? 'critical_success' : natural === 1 ? 'critical_failure' : total >= difficulty ? 'success' : 'failure'
  return { total, verdict }
}

export function canManageCampaign(user, campaign) {
  return Boolean(user && campaign && user.role === 'gm' && user.id === campaign.owner_id)
}

export function canReadCharacter(user, campaign, character) {
  return Boolean(user && campaign && character && character.campaign_id === campaign.id &&
    (canManageCampaign(user, campaign) || character.owner_id === user.id))
}

export function canEditCharacter(user, campaign, character) {
  return canReadCharacter(user, campaign, character)
}

export function canAnswerRequest(user, campaign, request) {
  return Boolean(user && campaign && request && request.campaign_id === campaign.id &&
    (canManageCampaign(user, campaign) || (user.role === 'player' && (request.target_group || request.target_user_id === user.id))))
}

export function safeJson(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

