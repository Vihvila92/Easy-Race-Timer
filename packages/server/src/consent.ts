import { z } from 'zod'
import { AppError, createId, type AgeInput } from '@ert/core'
import { CONSENT_TEXT_VERSION, consentAge, validateConsentActor } from '@ert/people'
import type { AppDb } from '@ert/storage'

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

const consentBody = z.strictObject({
  purpose: z.string().min(1).optional(),
  granted: z.boolean(),
  givenBy: z.enum(['self', 'guardian']),
  guardian: z.strictObject({
    name: z.string(),
    relation: z.string(),
    contact: z.string(),
  }).optional(),
  textVersion: z.string().min(1).optional(),
  channel: z.string().min(1),
  recordedBy: z.string().min(1).optional(),
})

export interface ConsentDependencies {
  db: AppDb
  now: () => number
  deviceId: string
  audit: (personId: string, granted: boolean) => void
  emit: (payload: { personId: string; granted: boolean }) => void
  /** Removes the person after a granted consent is withdrawn. Append-only rows stay. */
  anonymize: (personId: string, nowMs: number) => void
}

interface PersonIdentity extends AgeInput {
  id: string
  birthDate: string | null
  birthYear: number | null
}

/**
 * Append-only consent log. Revocation inserts a new row and then anonymizes the person.
 * Identifiers are ULIDs, so two records in the same millisecond do not collide.
 */
export class ConsentService {
  constructor(private readonly deps: ConsentDependencies) {}

  record(subjectId: string, body: unknown): { id: string } {
    const parsed = consentBody.safeParse(body)
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid consent')
    }
    const input = parsed.data
    const person = this.deps.db.get<{ id: string; gender: AgeInput['gender']; birth_date: string | null; birth_year: number | null }>(
      'SELECT id, gender, birth_date, birth_year FROM person WHERE id = ?',
      subjectId,
    )
    if (!person) throw new AppError('NOT_FOUND', 'Person not found')
    const identity: PersonIdentity = {
      id: person.id,
      gender: person.gender,
      birthDate: person.birth_date,
      birthYear: person.birth_year,
    }
    const raceDay = this.deps.db.get<{ date_start: string }>('SELECT date_start FROM event ORDER BY created_at LIMIT 1')?.date_start
    const age = raceDay ? consentAge(identity, raceDay) : null
    const guardian = validateConsentActor({ givenBy: input.givenBy, age, guardian: input.guardian })
    const purpose = input.purpose ?? 'long_term_storage'
    const previous = this.deps.db.get<{ granted: number }>(
      'SELECT granted FROM consent WHERE person_id = ? AND purpose = ? ORDER BY recorded_at DESC, id DESC LIMIT 1',
      subjectId,
      purpose,
    )
    const now = this.deps.now()
    const id = createId()
    if (!ULID.test(id)) throw new AppError('VALIDATION_ERROR', 'Could not allocate a consent id')
    const revocation = input.granted === false && previous?.granted === 1
    this.deps.db.tx(() => {
      this.deps.db.run(
        `INSERT INTO consent (id, person_id, purpose, granted, given_by, guardian_name, text_version, channel, recorded_by, recorded_at, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        subjectId,
        purpose,
        input.granted ? 1 : 0,
        input.givenBy,
        guardian.name,
        input.textVersion ?? CONSENT_TEXT_VERSION,
        input.channel,
        input.recordedBy ?? this.deps.deviceId,
        now,
        guardian.evidence,
      )
      this.deps.audit(subjectId, input.granted)
      if (revocation) this.deps.anonymize(subjectId, now)
    })
    this.deps.emit({ personId: subjectId, granted: input.granted })
    return { id }
  }
}
