import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDataDir, resolveDbPath, resolveListenPort } from './config.js'

describe('desktop launch config', () => {
  it('uses the operating system data directory when none is configured', () => {
    expect(resolveDataDir({}, 'darwin', '/Users/volunteer')).toBe('/Users/volunteer/Library/Application Support/Easy Race Timer')
    expect(resolveDataDir({ APPDATA: 'C:\\Users\\volunteer\\AppData\\Roaming' }, 'win32', 'C:\\Users\\volunteer')).toBe('C:\\Users\\volunteer\\AppData\\Roaming\\Easy Race Timer')
    expect(resolveDataDir({}, 'linux', '/home/volunteer')).toBe('/home/volunteer/.local/share/easy-race-timer')
    expect(resolveDataDir({ XDG_DATA_HOME: '/home/volunteer/data' }, 'linux', '/home/volunteer')).toBe('/home/volunteer/data/easy-race-timer')
  })

  it('accepts an explicit data directory and database file', () => {
    const dir = resolveDataDir({ ERT_DATA_DIR: 'race-data' }, 'linux', '/home/volunteer')
    expect(dir).toBe(path.resolve('race-data'))
    expect(resolveDbPath({}, dir)).toBe(path.join(dir, 'ert.sqlite'))
    expect(resolveDbPath({ ERT_DB: '/tmp/ert.sqlite' }, dir)).toBe(path.resolve('/tmp/ert.sqlite'))
  })

  it('asks for a free port unless one was requested', () => {
    expect(resolveListenPort({})).toBe(0)
    expect(resolveListenPort({ PORT: '' })).toBe(0)
    expect(resolveListenPort({ PORT: '0' })).toBe(0)
    expect(resolveListenPort({ PORT: '8080' })).toBe(8080)
    expect(() => resolveListenPort({ PORT: 'nope' })).toThrow(/PORT/)
  })
})
