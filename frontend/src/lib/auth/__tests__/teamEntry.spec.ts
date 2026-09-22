import { describe, expect, it } from 'vitest'
import { teamEntry } from '@/lib/auth/teamEntry'

/**
 * Der Weg zu den Werkzeugen des Teams im Konto-Menü. Rogue hat keine Teamrolle, aber einen
 * persönlichen Absender — und soll die eine Seite finden, die ihn betrifft, nicht die Moderation.
 */
describe('teamEntry', () => {
  it('führt ohne Rolle, aber mit persönlichem Absender, zu den Rundmails', () => {
    expect(teamEntry({ platformRole: null, mayPreparePublications: true })).toBe('publications')
  })

  it('führt mit Teamrolle in die Moderation, auch wenn sie vorbereiten darf', () => {
    expect(teamEntry({ platformRole: 'moderator', mayPreparePublications: true })).toBe(
      'moderation',
    )
  })

  it('zeigt einem Mitglied ohne beides nichts', () => {
    expect(teamEntry({ platformRole: null, mayPreparePublications: false })).toBeUndefined()
  })
})
