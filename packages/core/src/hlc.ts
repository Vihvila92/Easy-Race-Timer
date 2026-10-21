// SPDX-License-Identifier: AGPL-3.0-only
export interface Hlc {
  wallMs: number
  counter: number
  deviceId: string
}

export function formatHlc(hlc: Hlc): string {
  return `${hlc.wallMs}:${hlc.counter}:${hlc.deviceId}`
}

export function parseHlc(value: string): Hlc {
  const [wall, counter, deviceId] = value.split(':')
  return { wallMs: Number(wall), counter: Number(counter), deviceId }
}

export class HlcClock {
  private counter = 0
  private lastWall = 0

  constructor(private readonly deviceId: string, private readonly now: () => number = Date.now) {}

  tick(): string {
    const wall = this.now()
    if (wall === this.lastWall) this.counter += 1
    else {
      this.lastWall = wall
      this.counter = 0
    }
    return formatHlc({ wallMs: wall, counter: this.counter, deviceId: this.deviceId })
  }
}
