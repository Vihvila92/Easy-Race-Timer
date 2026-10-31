// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { missingSpdxHeaders } from './check-spdx.js'

describe('SPDX headers', () => {
  it('fails when a source file is missing the header', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ert-spdx-'))
    const nested = path.join(root, 'src')
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    writeFileSync(path.join(nested, 'plain.ts'), 'export const value = 1\n')
    writeFileSync(path.join(nested, 'ok.ts'), '// SPDX-License-Identifier: AGPL-3.0-only\nexport const value = 1\n')
    writeFileSync(path.join(nested, 'wrong.ts'), '// SPDX-License-Identifier: MIT\nexport const value = 1\n')
    writeFileSync(path.join(root, 'note.md'), 'no header required\n')
    writeFileSync(path.join(root, 'dist', 'bundle.js'), 'generated()\n')
    writeFileSync(path.join(root, 'run.py'), '#!/usr/bin/env python3\nprint(1)\n')
    expect(missingSpdxHeaders(root).sort()).toEqual(['run.py', 'src/plain.ts', 'src/wrong.ts'])
    writeFileSync(path.join(root, 'run.py'), '#!/usr/bin/env python3\n# SPDX-License-Identifier: AGPL-3.0-only\nprint(1)\n')
    expect(missingSpdxHeaders(root).sort()).toEqual(['src/plain.ts', 'src/wrong.ts'])
  })
})
