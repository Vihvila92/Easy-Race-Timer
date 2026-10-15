import { createRegistry, type SportProfile } from '@ert/core'

export interface TemplateCategory {
  id: string
  raceId: string
  gender: 'F' | 'M' | null
  minAge: number | null
  maxAge: number | null
  ranked: boolean
  autoAssign: boolean
  nameFi: string
  nameEn: string
  descriptionFi: string
  descriptionEn: string
}

const ages = [4, 6, 8, 10, 12, 14, 16]

/** Default template: kids 4 km (T/P 4–16) and adults 8 km (N/M) plus unranked K8. */
export function kidsAndAdultsTemplate(): { races: { id: string; nameFi: string; nameEn: string; distanceM: number; start: string }[]; categories: TemplateCategory[] } {
  const categories: TemplateCategory[] = []
  for (const [gender, prefix, labelFi, labelEn, enPrefix] of [
    ['F', 'T', 'Tytöt', 'Girls', 'G'],
    ['M', 'P', 'Pojat', 'Boys', 'B'],
  ] as const) {
    for (const age of ages) {
      categories.push({
        id: `${prefix}${age}`,
        raceId: 'R4',
        gender,
        minAge: age,
        maxAge: age + 1,
        ranked: true,
        autoAssign: true,
        nameFi: `${prefix}${age}`,
        nameEn: `${enPrefix}${age}`,
        descriptionFi: `${labelFi} ${age}–${age + 1} v`,
        descriptionEn: `${labelEn} ${age}–${age + 1} y`,
      })
    }
  }
  categories.push(
    {
      id: 'N', raceId: 'R8', gender: 'F', minAge: 16, maxAge: null, ranked: true, autoAssign: true,
      nameFi: 'N', nameEn: 'W', descriptionFi: 'Naiset', descriptionEn: 'Women',
    },
    {
      id: 'M', raceId: 'R8', gender: 'M', minAge: 16, maxAge: null, ranked: true, autoAssign: true,
      nameFi: 'M', nameEn: 'M', descriptionFi: 'Miehet', descriptionEn: 'Men',
    },
    {
      id: 'K8', raceId: 'R8', gender: null, minAge: null, maxAge: null, ranked: false, autoAssign: false,
      nameFi: 'Kunto 8 km', nameEn: 'Open 8 km', descriptionFi: 'Sijoittamaton', descriptionEn: 'Unranked',
    },
  )
  return {
    races: [
      { id: 'R4', nameFi: '4 km', nameEn: '4 km', distanceM: 4000, start: '11:00:00' },
      { id: 'R8', nameFi: '8 km', nameEn: '8 km', distanceM: 8000, start: '11:30:00' },
    ],
    categories,
  }
}

export const runProfile: SportProfile = {
  id: 'run',
  rounding: 'floor_1s',
  startMode: 'mass',
  terminology: { fi: 'Juoksu', en: 'Running' },
  validateRace(input) {
    return input.distanceM > 0 ? [] : ['distance must be positive']
  },
}

export const sportRegistry = createRegistry<SportProfile>()
sportRegistry.register(runProfile)
