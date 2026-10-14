export type Gender = 'F' | 'M' | 'X'
export type AgeBasis = 'birth_date' | 'birth_year'

export interface CategoryDef {
  id: string
  raceId: string
  gender: Gender | null
  minAge: number | null
  maxAge: number | null
  ranked: boolean
  autoAssign: boolean
}

export type CategoryWarning =
  | { code: 'birth_year_only' }
  | { code: 'below_youngest'; age: number; categoryId: string }
  | { code: 'no_matching_category'; categoryId: string; categoryRaceId: string; enteredRaceId: string }
  | { code: 'no_category' }

export interface AgeInput {
  gender: Gender
  birthDate: string | null
  birthYear: number | null
}

export function ageOnReference(person: AgeInput, basis: AgeBasis, referenceDate: string): { age: number; yearOnly: boolean } {
  const [year, month, day] = referenceDate.slice(0, 10).split('-').map(Number)
  if (basis === 'birth_year' || !person.birthDate) {
    if (person.birthYear == null) throw new Error('birth year required')
    return { age: year - person.birthYear, yearOnly: basis === 'birth_date' && !person.birthDate }
  }
  const [, birthMonth, birthDay] = person.birthDate.slice(0, 10).split('-').map(Number)
  const birthYear = Number(person.birthDate.slice(0, 4))
  const beforeBirthday = month < birthMonth || (month === birthMonth && day < birthDay)
  return { age: year - birthYear - (beforeBirthday ? 1 : 0), yearOnly: false }
}

function fits(category: CategoryDef, age: number): boolean {
  if (category.minAge == null) return false
  if (category.minAge > age) return false
  if (category.maxAge != null && age > category.maxAge) return false
  return true
}

/**
 * Suggest a category on the entered distance.
 * 1. Matching auto-assign category on that distance.
 * 2. Younger than the youngest category on that distance, and no category fits anywhere → youngest + warning.
 * 3. A fit exists only on another distance → no assignment, NO_MATCHING_CATEGORY.
 */
export function suggestCategory(
  person: AgeInput,
  basis: AgeBasis,
  raceId: string,
  categories: CategoryDef[],
  referenceDate: string,
): { categoryId: string; age: number; warnings: CategoryWarning[] } {
  const { age, yearOnly } = ageOnReference(person, basis, referenceDate)
  const warnings: CategoryWarning[] = []
  if (yearOnly) warnings.push({ code: 'birth_year_only' })

  const candidates = categories.filter((category) => category.autoAssign && category.gender === person.gender)
  const onRace = candidates.filter((category) => category.raceId === raceId)
  const hits = onRace.filter((category) => fits(category, age))
  if (hits.length) return { categoryId: hits[0].id, age, warnings }

  const youngest = onRace.reduce<CategoryDef | null>((best, category) => {
    if (category.minAge == null) return best
    if (!best || best.minAge == null || category.minAge < best.minAge) return category
    return best
  }, null)

  if (youngest && youngest.minAge != null && age < youngest.minAge && !candidates.some((category) => fits(category, age))) {
    warnings.push({ code: 'below_youngest', age, categoryId: youngest.id })
    return { categoryId: youngest.id, age, warnings }
  }

  const elsewhere = candidates.filter((category) => fits(category, age))
  if (elsewhere.length) {
    warnings.push({
      code: 'no_matching_category',
      categoryId: elsewhere[0].id,
      categoryRaceId: elsewhere[0].raceId,
      enteredRaceId: raceId,
    })
    return { categoryId: '', age, warnings }
  }

  warnings.push({ code: 'no_category' })
  return { categoryId: '', age, warnings }
}
