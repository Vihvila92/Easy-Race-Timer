// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { chooseInstaller, healthCaptureProvesReady, packagedRaceFile, redactSecrets, sqliteHeaderIsEncrypted, tasklistShowsImage } from './desktop-smoke.mjs'

describe('desktop smoke', () => {
  it('picks the dmg and the NSIS installer', () => {
    expect(chooseInstaller('macos', ['Easy Race Timer_0.1.0_universal.dmg', 'Easy Race Timer.app.tar.gz'])).toMatch(/\.dmg$/)
    expect(chooseInstaller('windows', ['Easy Race Timer_0.1.0_x64-setup.exe', 'Easy Race Timer_0.1.0_x64_en-US.msi'])).toMatch(/-setup\.exe$/)
    expect(chooseInstaller('linux', ['Easy Race Timer_0.1.0_amd64.AppImage', 'Easy Race Timer_0.1.0_amd64.deb'])).toMatch(/\.AppImage$/)
  })

  it('treats the health JSON on the loopback capture as a 200 and hides tokens', () => {
    const token = 'ab'.repeat(32)
    const capture = `GET /auth?code=${token} HTTP/1.1\nHTTP/1.1 302\nSet-Cookie: ert_launch=${token}\nGET /api/v1/health HTTP/1.1\nHTTP/1.1 200 OK\n{"ok":true,"version":"0.1.0","pinConfigured":false}`
    expect(healthCaptureProvesReady(capture)).toBe(true)
    expect(healthCaptureProvesReady('GET /api/v1/health HTTP/1.1\nHTTP/1.1 401')).toBe(false)
    const hidden = redactSecrets(capture)
    expect(hidden).not.toContain(token)
    expect(hidden).toContain('/api/v1/health')
    expect(hidden).toContain('ert_launch=[redacted]')
  })

  it('reads tasklist output without treating the empty message as a process', () => {
    expect(tasklistShowsImage('INFO: No tasks are running which match the specified criteria.', 'ert-server.exe')).toBe(false)
    expect(tasklistShowsImage('"ert-server.exe","1234","Console","1","20 K"', 'ert-server.exe')).toBe(true)
  })

  it('recognises an encrypted race file and the packaged data path', () => {
    const plain = Buffer.from('SQLite format 3\0')
    expect(sqliteHeaderIsEncrypted(plain)).toBe(false)
    expect(sqliteHeaderIsEncrypted(Buffer.from('not a sqlite header!!'))).toBe(true)
    expect(packagedRaceFile('macos', { HOME: '/Users/runner' })).toBe('/Users/runner/Library/Application Support/fi.easyracetimer.app/ert.sqlite')
    expect(packagedRaceFile('windows', { APPDATA: 'C:\\Users\\runner\\AppData\\Roaming' })).toBe('C:\\Users\\runner\\AppData\\Roaming\\fi.easyracetimer.app\\ert.sqlite')
    expect(packagedRaceFile('linux', { HOME: '/home/runner' })).toBe('/home/runner/.local/share/fi.easyracetimer.app/ert.sqlite')
  })
})
