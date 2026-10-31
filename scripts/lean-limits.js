// SPDX-License-Identifier: AGPL-3.0-only
/** Size and complexity ceilings from the lean-code check. Shared by ESLint and check:lean. */
const LEAN_LIMITS = {
  complexity: 10,
  'max-lines-per-function': 60,
  'max-lines': 400,
  'max-depth': 3,
  'max-params': 4,
}

export function leanRules(level = 'warn') {
  return Object.fromEntries(Object.entries(LEAN_LIMITS).map(([rule, max]) => [rule, [level, max]]))
}

export function leanRuleFlags(level = 'error') {
  return Object.entries(LEAN_LIMITS).flatMap(([rule, max]) => ['--rule', `${rule}: [${level}, ${max}]`])
}
