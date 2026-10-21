import { describe, expect, it } from 'vitest'
import { formatReadyLine, parseReadyLine } from './ready-line.js'

const payload = {
  url: 'http://127.0.0.1:43123',
  dataDir: '/home/volunteer/.local/share/fi.easyracetimer.app',
  dbPath: '/home/volunteer/.local/share/fi.easyracetimer.app/ert.sqlite',
}

describe('ERT_READY line', () => {
  it('parses the line the server prints', () => {
    expect(parseReadyLine(formatReadyLine(payload))).toEqual(payload)
    expect(parseReadyLine(`  ${formatReadyLine({ ...payload, url: 'http://127.0.0.1:1/' })}  `)?.url).toBe('http://127.0.0.1:1/')
  })

  it('rejects a missing, malformed, or non-loopback line', () => {
    expect(parseReadyLine('')).toBeNull()
    expect(parseReadyLine('listening on 8080')).toBeNull()
    expect(parseReadyLine('ERT_READY')).toBeNull()
    expect(parseReadyLine('ERT_READY ')).toBeNull()
    expect(parseReadyLine('ERT_READY {')).toBeNull()
    expect(parseReadyLine('ERT_READY {"url":"http://127.0.0.1:1"}')).toBeNull()
    expect(parseReadyLine('ERT_READY {"url":"http://127.0.0.1:1","dataDir":"","dbPath":"/tmp/ert.sqlite"}')).toBeNull()
    expect(parseReadyLine(`prefix ${formatReadyLine(payload)}`)).toBeNull()
    for (const url of [
      'http://localhost:8080',
      'http://0.0.0.0:8080',
      'https://127.0.0.1:8080',
      'http://127.0.0.1:0',
      'http://127.0.0.1:080',
      'http://127.0.0.1:8080/api',
      'http://127.0.0.1:8080?x=1',
      'http://user@127.0.0.1:8080',
    ]) {
      expect(parseReadyLine(formatReadyLine({ ...payload, url }))).toBeNull()
    }
  })
})
