// SPDX-License-Identifier: AGPL-3.0-only
import enJson from '../locales/en.json'
import fiJson from '../locales/fi.json'

/** Finnish strings are the typed key set. English must provide every key. */
export const fi = fiJson
export type MessageKey = keyof typeof fi

export const en: Record<MessageKey, string> = enJson
