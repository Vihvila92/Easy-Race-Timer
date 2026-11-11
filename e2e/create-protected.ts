// SPDX-License-Identifier: AGPL-3.0-only
import { createProtectedRaceFile } from '@ert/storage'

const file = process.env.ERT_E2E_FILE
const first = process.env.ERT_E2E_FIRST
const second = process.env.ERT_E2E_SECOND
if (!file || !first || !second) process.exit(1)
const created = await createProtectedRaceFile(file, { password: first, confirm: first }, { password: second, confirm: second })
process.stdout.write(created.recoveryKey.toString('ascii'))
created.recoveryKey.fill(0)
created.db.raw.close()
