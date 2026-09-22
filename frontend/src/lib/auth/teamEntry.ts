/**
 * Welcher Eintrag im Konto-Menü zu den Werkzeugen des Teams führt — oder keiner.
 *
 * **Wer eine Teamrolle hat**, bekommt die Moderation, und darin die Rundmails. **Wer ohne Rolle
 * vorbereiten darf** — weil der Ur-Admin einen Absender persönlich vergeben hat —, bekommt nur die
 * eine Seite, die ihn betrifft: Die Übersicht der Moderation würde ihn nach Hause schicken.
 */
export type TeamEntry = 'moderation' | 'publications'

export function teamEntry(user: {
  platformRole: string | null
  mayPreparePublications: boolean
}): TeamEntry | undefined {
  if (user.platformRole !== null) {
    return 'moderation'
  }

  return user.mayPreparePublications ? 'publications' : undefined
}
