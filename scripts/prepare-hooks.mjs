// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
if (inside.status !== 0) process.exit(0)
const configured = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' })
process.exit(configured.status === 0 ? 0 : configured.status ?? 1)
