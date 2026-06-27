import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface UploadResult {
  success: boolean
  txId?: string
  url?: string
  localPath?: string
  error?: string
}

/**
 * Upload a colony site to Arweave via Irys (paid in SOL).
 * Falls back to local filesystem if IRYS_PRIVATE_KEY is not set.
 */
export async function uploadColonySite(
  files: Map<string, string>,
  colonyId: string,
): Promise<UploadResult> {
  const privateKey = process.env.IRYS_PRIVATE_KEY

  if (privateKey) {
    try {
      return await uploadArweave(files, colonyId, privateKey)
    } catch (err) {
      console.warn('[arweave] Upload failed, falling back to local:', (err as Error).message)
    }
  }

  return uploadLocal(files, colonyId)
}

async function uploadArweave(
  files: Map<string, string>,
  colonyId: string,
  privateKey: string,
): Promise<UploadResult> {
  const { default: Irys } = await import('@irys/sdk')

  const irys = new Irys({
    network: 'devnet',
    token: 'solana',
    key: privateKey,
    config: { providerUrl: process.env.SOLANA_RPC || 'https://api.devnet.solana.com' },
  })

  const tags = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'Protocol', value: 'Metacuum-ColonySite' },
    { name: 'Colony-Id', value: colonyId },
    { name: 'App-Name', value: 'βWAVE-ColonyAgent' },
  ]

  const entries = Array.from(files.entries())
  const receipts = await Promise.all(
    entries.map(async ([path, content]) => {
      return irys.upload(content, {
        tags: [...tags, { name: 'Path', value: path }],
      })
    }),
  )

  return {
    success: true,
    txId: receipts[0]?.id,
    url: receipts[0] ? `https://arweave.net/${receipts[0].id}` : undefined,
  }
}

export function uploadLocal(files: Map<string, string>, colonyId: string): UploadResult {
  const outDir = join(__dirname, '../../../colony-sites', colonyId)

  for (const [path, content] of files) {
    const fullPath = join(outDir, path)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }

  return {
    success: true,
    localPath: outDir,
  }
}
