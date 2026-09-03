import type {
  IssueWarningBody,
  ListStrikeHistory200Item,
  SuggestNextStrikeAction200,
} from '@/api/models'

type Severity = IssueWarningBody['severity']
type Action = ListStrikeHistory200Item['action']

/**
 * How heavily an incident weighed. The three names come from the platform rules and are the
 * enum's own, so they are not reordered or renamed here — only translated.
 *
 * Ordered lightest first, which is also the order somebody reads them in when deciding.
 */
export const STRIKE_SEVERITIES: ReadonlyArray<{ value: Severity; label: string }> = [
  { value: 'acceptable', label: 'Akzeptabel' },
  { value: 'borderline', label: 'Grenzwertig' },
  { value: 'severe', label: 'Schwerwiegend' },
]

export const STRIKE_SEVERITY_LABELS: Record<Severity, string> = Object.fromEntries(
  STRIKE_SEVERITIES.map((severity) => [severity.value, severity.label]),
) as Record<Severity, string>

/** What was decided. „Löschung" is recorded here but carried out through its own route. */
export const STRIKE_ACTION_LABELS: Record<Action, string> = {
  warning: 'Verwarnung',
  suspension: 'Sperrung',
  deletion: 'Löschung',
}

/**
 * The suggestion in words. Built here rather than in the backend, like every other label in
 * this project: the API answers with the counts, the interface says what they mean.
 *
 * It is only ever a suggestion — the ladder is not enforced, and an incident weighed as severe
 * may be answered with a suspension without any warning having come first.
 */
export function strikeSuggestion(suggestion: SuggestNextStrikeAction200): string {
  if (suggestion.action === 'warning') {
    return suggestion.priorWarnings === 0
      ? 'Vorschlag: erste Verwarnung.'
      : 'Vorschlag: zweite Verwarnung. Der nächste Verstoß wäre der 1. Strike.'
  }

  if (suggestion.ladderExhausted) {
    return 'Alle drei Strikes sind vergeben. Der nächste Schritt wäre laut Regelwerk die Löschung.'
  }

  const strikeNumber = suggestion.priorSuspensions + 1
  return `Vorschlag: ${strikeNumber}. Strike — ${suggestion.suggestedHours} Stunden Sperrung.`
}
