import fs from 'node:fs'
import path from 'node:path'

/** Write base64 assets under `root` and return that directory. A completed tree is left as-is. */
export function extractTree(root: string, files: Record<string, string>): string {
  const marker = path.join(root, '.complete')
  if (fs.existsSync(marker)) return root
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  for (const [rel, encoded] of Object.entries(files)) {
    const dest = safeJoin(root, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, Buffer.from(encoded, 'base64'))
  }
  fs.writeFileSync(marker, 'ok\n')
  return root
}

function safeJoin(root: string, rel: string): string {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel)) {
    throw new Error(`Refusing asset path ${rel}`)
  }
  const dest = path.resolve(root, rel)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (dest !== root && !dest.startsWith(prefix)) {
    throw new Error(`Refusing asset path ${rel}`)
  }
  return dest
}
