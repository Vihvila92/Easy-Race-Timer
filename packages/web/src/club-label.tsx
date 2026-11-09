// SPDX-License-Identifier: AGPL-3.0-only
export function ClubLabel({ abbr, name }: { abbr: string; name: string }) {
  return (
    <>
      <span className="club-abbr" title={name}>{abbr || name}</span>
      <span className="club-full">{name || abbr}</span>
    </>
  )
}
