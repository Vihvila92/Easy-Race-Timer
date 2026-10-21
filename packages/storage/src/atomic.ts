import fs from 'node:fs'
import path from 'node:path'

/** fsync a directory so a rename is durable. Some operating systems do not allow it. */
export function fsyncDirectory(directory: string): void {
  let fd: number | undefined
  try {
    fd = fs.openSync(directory, 'r')
    fs.fsyncSync(fd)
  } catch {
    // Windows and a few filesystems reject directory fsync. The rename already happened.
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export function fsyncFile(file: string): void {
  const fd = fs.openSync(file, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Copy onto dest via a temp file in the same directory, fsync, then rename.
 * A crash leaves the previous dest in place. The temp file is removed on failure.
 */
export function atomicCopyFile(source: string, dest: string): void {
  const directory = path.dirname(dest)
  fs.mkdirSync(directory, { recursive: true })
  const tmp = path.join(directory, `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.copyFileSync(source, tmp)
    fsyncFile(tmp)
    try {
      fs.chmodSync(tmp, 0o600)
    } catch {
      // Permissions are best-effort on filesystems that ignore them.
    }
    fs.renameSync(tmp, dest)
    fsyncDirectory(directory)
    try {
      fs.chmodSync(dest, 0o600)
    } catch {
      // Permissions are best-effort on filesystems that ignore them.
    }
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}
