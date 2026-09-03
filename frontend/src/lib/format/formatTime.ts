/**
 * Relative under a day, absolute above it: "vor 12 Minuten" → "Dienstag, 09:14" → "12. Februar".
 * The design system fixes this ladder, so it lives in one place rather than at each call site.
 *
 * Everything here comes from Intl rather than a date library: it already knows German plurals
 * and month names, and switching this constant is most of what localising these strings takes.
 * A library would earn its place once times have to be shown in a zone other than the reader's,
 * or once differences have to be counted in calendar days rather than elapsed milliseconds.
 */
const LOCALE = 'de-DE'

const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'always' })

const WEEKDAY_AND_TIME = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const DAY_AND_MONTH = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' })

const DAY_MONTH_AND_YEAR = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const MONTH_AND_YEAR = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })

const DAY_MONTH_AND_YEAR_AND_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatActivityTime(isoTimestamp: string, now: Date = new Date()): string {
  const at = new Date(isoTimestamp)
  const elapsed = now.getTime() - at.getTime()

  // A clock that is slightly behind the server must not produce "in 3 Sekunden", and Intl
  // would render the sub-minute case as "vor 0 Minuten".
  if (elapsed < MINUTE) {
    return 'gerade eben'
  }
  if (elapsed < HOUR) {
    return RELATIVE.format(-Math.floor(elapsed / MINUTE), 'minute')
  }
  if (elapsed < DAY) {
    return RELATIVE.format(-Math.floor(elapsed / HOUR), 'hour')
  }
  if (elapsed < WEEK) {
    return WEEKDAY_AND_TIME.format(at)
  }
  // Within the same year the year itself carries no information.
  return at.getFullYear() === now.getFullYear()
    ? DAY_AND_MONTH.format(at)
    : DAY_MONTH_AND_YEAR.format(at)
}

/** Absolute, and only to the month: `formatActivityTime` would say "gerade eben" here. */
export function formatJoinedDate(isoTimestamp: string): string {
  return MONTH_AND_YEAR.format(new Date(isoTimestamp))
}

/**
 * The last day something is possible: when applying to a Blind-Date plot stops.
 *
 * To the day, not the minute. The team sets a date, which is stored as that day's last moment, so
 * a time here would only ever read „23:59" and would make a deadline look more exact than it is.
 */
export function formatDeadline(isoTimestamp: string): string {
  return DAY_MONTH_AND_YEAR.format(new Date(isoTimestamp))
}

/**
 * A moment in the future, to the minute: when a suspension ends. Absolute and never relative —
 * "in 2 Tagen" is not something somebody can plan around, and this is the one time in the
 * interface a member is told to come back later.
 */
export function formatUntil(isoTimestamp: string): string {
  return DAY_MONTH_AND_YEAR_AND_TIME.format(new Date(isoTimestamp))
}
