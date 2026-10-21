import { describe, expect, it } from 'vitest'
import { parentStillAlive } from './parent-watch.js'

describe('parent watch', () => {
  it('notices a reparented process and a parent that is gone', () => {
    expect(parentStillAlive(10, 1, () => {})).toBe(false)
    expect(parentStillAlive(10, 10, () => {
      throw new Error('gone')
    })).toBe(false)
    expect(parentStillAlive(10, 10, () => {})).toBe(true)
  })
})
