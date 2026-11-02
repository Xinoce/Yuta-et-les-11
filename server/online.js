import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let tunnelProcess = null
let startTimer = null
let stopping = false
let state = { status: 'stopped', publicUrl: null, error: null }

const snapshot = () => ({ ...state })

function findCloudflared() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'cloudflared.exe'),
    path.resolve(here, '../tools/cloudflared.exe'),
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

export function getTunnelStatus() { return snapshot() }

async function waitForTunnelReady(child, port, publicUrl, isConnected) {
  const deadline = Date.now() + 45000
  let originReady = false
  while (tunnelProcess === child && state.status === 'starting' && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?probe=${Date.now()}`, { signal: AbortSignal.timeout(1500), cache: 'no-store' })
      if (response.ok) {
        const payload = await response.json()
        originReady = typeof payload?.hasGame === 'boolean'
      } else originReady = false
    } catch { originReady = false }
    if (originReady && isConnected()) {
      state = { status: 'online', publicUrl, error: null }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 900))
  }
  if (tunnelProcess === child && state.status === 'starting') {
    state = isConnected()
      ? { status: 'error', publicUrl: null, error: 'Le serveur local de Yuta ne répond pas. Ferme puis relance l’application.' }
      : { status: 'error', publicUrl: null, error: 'Cloudflare n’a pas pu établir de connexion depuis ce réseau. Vérifie la connexion Internet ou réessaie sur un autre réseau.' }
    child.kill()
  }
}

export function startPublicTunnel(port) {
  if (state.status === 'online' || state.status === 'starting') return snapshot()
  if (tunnelProcess) {
    const previous = tunnelProcess
    tunnelProcess = null
    previous.kill()
  }
  const executable = findCloudflared()
  if (!executable) {
    state = { status: 'error', publicUrl: null, error: 'Le composant Cloudflare Tunnel est introuvable.' }
    return snapshot()
  }

  stopping = false
  state = { status: 'starting', publicUrl: null, error: null }
  let child
  try {
    child = spawn(executable, ['tunnel', '--protocol', 'http2', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    tunnelProcess = child
  } catch (error) {
    state = { status: 'error', publicUrl: null, error: error instanceof Error ? error.message : 'Impossible de démarrer le tunnel.' }
    tunnelProcess = null
    return snapshot()
  }

  let logBuffer = ''
  let tunnelConnected = false
  let readinessCheckStarted = false
  const consume = (chunk) => {
    logBuffer = (logBuffer + chunk.toString()).slice(-16000)
    if (/Registered tunnel connection/i.test(logBuffer)) tunnelConnected = true
    if (tunnelProcess !== child || state.status !== 'starting') return
    const match = logBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
    if (match && !readinessCheckStarted) {
      clearTimeout(startTimer)
      startTimer = null
      state = { status: 'starting', publicUrl: match[0], error: null }
      readinessCheckStarted = true
      void waitForTunnelReady(child, port, match[0], () => tunnelConnected)
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  child.on('error', (error) => {
    if (tunnelProcess !== child) return
    clearTimeout(startTimer)
    startTimer = null
    state = { status: 'error', publicUrl: null, error: `Cloudflare Tunnel : ${error.message}` }
    tunnelProcess = null
  })
  child.on('exit', (code) => {
    if (tunnelProcess !== child) return
    clearTimeout(startTimer)
    startTimer = null
    tunnelProcess = null
    if (stopping) state = { status: 'stopped', publicUrl: null, error: null }
    else if (state.status !== 'error') {
      const diagnostic = logBuffer
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.includes('.trycloudflare.com'))
        .slice(-2)
        .join(' · ')
        .slice(-360)
      const summary = /timeout|unreachable|connection refused|no route|network is down/i.test(diagnostic)
        ? 'Réseau inaccessible depuis Cloudflare. Vérifie ta connexion et autorise Yuta et les 11 dans le pare-feu Windows.'
        : diagnostic || `code ${code ?? 'inconnu'}`
      state = { status: 'error', publicUrl: null, error: `Cloudflare Tunnel s’est arrêté : ${summary}` }
    }
    stopping = false
  })
  startTimer = setTimeout(() => {
    if (state.status !== 'starting') return
    state = { status: 'error', publicUrl: null, error: 'Cloudflare met trop de temps à répondre. Vérifie la connexion Internet, le pare-feu Windows et réessaie.' }
    child.kill()
  }, 55000)
  return snapshot()
}

export function stopPublicTunnel() {
  clearTimeout(startTimer)
  startTimer = null
  if (!tunnelProcess) {
    state = { status: 'stopped', publicUrl: null, error: null }
    return snapshot()
  }
  stopping = true
  state = { status: 'stopping', publicUrl: null, error: null }
  tunnelProcess.kill()
  return snapshot()
}

