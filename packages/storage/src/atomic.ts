// SPDX-License-Identifier: AGPL-3.0-only
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

/**
 * Overwrite a file with zeros where the filesystem allows, then delete it.
 * On SSDs and copy-on-write filesystems that overwrite does not prove the old bytes are gone.
 */
export function secureRemove(file: string): void {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(file)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(file)
    return
  }
  if (!stat.isFile()) return
  const flags = fs.constants.O_NOFOLLOW ? fs.constants.O_RDWR | fs.constants.O_NOFOLLOW : 'r+'
  let fd: number
  try {
    fd = fs.openSync(file, flags)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      fs.unlinkSync(file)
      return
    }
    throw error
  }
  try {
    const zeros = Buffer.alloc(64 * 1024)
    let left = stat.size
    while (left > 0) {
      const wrote = fs.writeSync(fd, zeros, 0, Math.min(zeros.length, left))
      if (wrote <= 0) break
      left -= wrote
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.rmSync(file, { force: true })
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
  // POSIX mode 0700. Windows ignores this; the equivalent ACL is
  // icacls <dir> /inheritance:r /grant:r "<user>:(OI)(CI)F".
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
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
