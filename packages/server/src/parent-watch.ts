// SPDX-License-Identifier: AGPL-3.0-only
/** True while `parentPid` is still the parent and the process exists. */
export function parentStillAlive(
  parentPid: number,
  currentPpid: number,
  signal: (pid: number) => void = (pid) => {
    process.kill(pid, 0)
  },
): boolean {
  if (currentPpid !== parentPid) return false
  try {
    signal(parentPid)
    return true
  } catch {
    return false
  }
}

/** Call `onGone` when the parent exits or this process is reparented. */
export function watchParent(onGone: () => void, intervalMs = 200): () => void {
  const parentPid = process.ppid
  const timer = setInterval(() => {
    if (!parentStillAlive(parentPid, process.ppid)) onGone()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
