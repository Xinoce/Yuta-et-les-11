import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const destination = path.join(directory, 'cloudflared.exe')
const temporary = `${destination}.download-${process.pid}`
const sourceUrl = 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.4/cloudflared-windows-amd64.exe'
const expectedSha256 = '411b16d40c8d872243efeb52c550053d00af0a8a97fbb32e730fb8aba429eaa8'

async function fileSha256(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

try {
  if (await fs.stat(destination).then(() => true, () => false)) {
    if ((await fileSha256(destination)) === expectedSha256) {
      console.log('cloudflared 2026.10.4 est déjà présent et vérifié.')
      process.exit(0)
    }
  }

  console.log('Téléchargement de cloudflared 2026.10.4 depuis les releases officielles de Cloudflare…')
  const response = await fetch(sourceUrl, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Téléchargement refusé : HTTP ${response.status}.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== expectedSha256) throw new Error('Le SHA-256 de cloudflared ne correspond pas à la version attendue.')

  await fs.writeFile(temporary, bytes)
  await fs.rm(destination, { force: true })
  await fs.rename(temporary, destination)
  console.log('cloudflared téléchargé et vérifié.')
} catch (error) {
  await fs.rm(temporary, { force: true }).catch(() => undefined)
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

