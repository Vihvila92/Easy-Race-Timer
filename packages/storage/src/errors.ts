export type RaceFileKind = 'open' | 'newer' | 'dev-key' | 'missing-key' | 'key-file'

/**
 * One message for a race file the app will not open.
 * The text has the file name only: no directory, no key material, no stack.
 */
export class RaceFileError extends Error {
  readonly fileName: string
  readonly kind: RaceFileKind

  constructor(fileName: string, kind: RaceFileKind) {
    const message = kind === 'newer'
      ? 'This race file was saved by a newer Easy Race Timer.'
      : kind === 'dev-key'
        ? 'Dev key provider is disabled in production.'
        : kind === 'missing-key'
          ? 'No data key is configured. Refusing to open the race file.'
          : kind === 'key-file'
            ? 'The key file does not match this race file.'
            : `Could not open race file ${fileName}.`
    super(message)
    this.name = 'RaceFileError'
    this.fileName = fileName
    this.kind = kind
    this.stack = message
  }
}
