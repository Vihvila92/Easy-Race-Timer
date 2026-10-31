// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  addedDependencies,
  dependencyWarnings,
  gzipLength,
  runtimeDependencyNames,
  weightMarkdown,
} from './report-weight.js'

describe('runtime dependencies', () => {
  it('ignores devDependencies and reports names added since the base', () => {
    expect(runtimeDependencyNames({ dependencies: { b: '1', a: '2' } })).toEqual(['a', 'b'])
    const added = addedDependencies('packages/web/package.json', '@ert/web', ['react'], ['left-pad', 'react'])
    expect(added).toEqual([{ file: 'packages/web/package.json', packageName: '@ert/web', dependency: 'left-pad' }])
    expect(dependencyWarnings(added)[0]).toContain('::warning')
  })
})

describe('bundle summary', () => {
  it('sums the frontend and says when no installer was built', () => {
    const markdown = weightMarkdown({
      frontend: [{ path: 'packages/web/dist/index.html', bytes: 10, gzip: 8 }],
      installers: [],
      added: [],
    })
    expect(markdown).toContain('| **Total** | 10 | 8 |')
    expect(markdown).toContain('does not build the sidecar')
    expect(markdown).toContain('No new runtime dependencies.')
    expect(gzipLength(Buffer.from('aaaa'))).toBeGreaterThan(0)
  })

  it('lists installer packages and new runtime dependencies', () => {
    const markdown = weightMarkdown({
      frontend: [],
      installers: [{ path: 'src-tauri/target/release/bundle/deb/app.deb', bytes: 40, gzip: 0 }],
      added: [{ file: 'packages/web/package.json', packageName: '@ert/web', dependency: 'left-pad' }],
    })
    expect(markdown).toContain('app.deb')
    expect(markdown).toContain('`@ert/web` added `left-pad`')
  })
})
