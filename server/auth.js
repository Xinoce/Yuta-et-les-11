import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COOKIE = 'yuta_session'
const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(here, '../data')
fs.mkdirSync(dataDir, { recursive: true })
const secretFile = path.join(dataDir, 'session-secret')
if (!process.env.SESSION_SECRET && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48), { flag: 'wx' })
const sessionSecret = process.env.SESSION_SECRET || fs.readFileSync(secretFile)
const b64 = (value) => Buffer.from(value).toString('base64url')

export function signSession(userId) {
  const payload = b64(JSON.stringify({ sub: userId, exp: Date.now() + 14 * 24 * 60 * 60 * 1000 }))
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest()
  let provided
  try { provided = Buffer.from(signature, 'base64url') } catch { return null }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(expected, provided)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return Number.isInteger(data.sub) && Number.isFinite(data.exp) && data.exp > Date.now() ? data.sub : null
  } catch { return null }
}

export function parseCookie(header = '') {
  const entry = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))
  return entry ? decodeURIComponent(entry.slice(COOKIE.length + 1)) : null
}

export function sessionCookie(token, secureOverride) {
  const needsSecure = secureOverride ?? (process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'))
  const secure = needsSecure ? '; Secure' : ''
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600${secure}`
}

export const clearSessionCookie = (secure = false) => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`

