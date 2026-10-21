// SPDX-License-Identifier: AGPL-3.0-only
import { AppError, ageOnReference, type AgeInput } from '@ert/core'

/** A person under this age on race day cannot consent for themselves. */
export const CONSENT_GUARDIAN_AGE = 15

export interface GuardianDetails {
  name: string
  relation: string
  contact: string
}

export interface StoredGuardian {
  name: string | null
  evidence: string | null
}

/** Age on race day. Unknown when the birth date and birth year are both missing. */
export function consentAge(person: AgeInput, raceDay: string): number | null {
  try {
    const basis = person.birthDate ? 'birth_date' : 'birth_year'
    return ageOnReference(person, basis, raceDay).age
  } catch {
    return null
  }
}

export function guardianRequired(age: number | null): boolean {
  return age == null || age < CONSENT_GUARDIAN_AGE
}

/**
 * Self-consent is refused under 15 and when age is unknown.
 * A guardian record must include name, relation and contact.
 */
export function validateConsentActor(input: {
  givenBy: 'self' | 'guardian'
  age: number | null
  guardian?: Partial<GuardianDetails>
}): StoredGuardian {
  if (input.givenBy === 'self') {
    if (guardianRequired(input.age)) {
      throw new AppError('VALIDATION_ERROR', 'A guardian must consent for a person under 15')
    }
    return { name: null, evidence: null }
  }
  const name = input.guardian?.name?.trim() ?? ''
  const relation = input.guardian?.relation?.trim() ?? ''
  const contact = input.guardian?.contact?.trim() ?? ''
  if (!name || !relation || !contact) {
    throw new AppError('VALIDATION_ERROR', 'Guardian name, relation and contact are required')
  }
  return { name, evidence: JSON.stringify({ relation, contact }) }
}
