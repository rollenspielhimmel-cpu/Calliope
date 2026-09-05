/**
 * Rechnet zwischen dem, was jemand eintippt, und dem, was in der Datenbank steht.
 *
 * **Warum überhaupt.** „Sonntag um 20 Uhr" heißt Sonntag um 20 Uhr in Deutschland — nicht in der
 * Zeitzone des Browsers, in dem es getippt wurde. Wer aus dem Urlaub in Bangkok eine Ankündigung
 * für Sonntagabend einstellt, meint den deutschen Sonntagabend; ein `datetime-local`, das die
 * Uhrzeit des Geräts nimmt, würde daraus zwei Uhr nachts machen. Deshalb wird hier ausdrücklich
 * nach Europe/Berlin gerechnet und nicht nach der Ortszeit.
 *
 * **Warum ohne Bibliothek.** `Intl` weiß, was Berlin an einem gegebenen Tag von UTC trennt — auch
 * bei der Sommerzeit, die genau das ist, woran eine selbstgebaute „plus zwei Stunden"-Regel
 * scheitert. Der Versatz wird für den fraglichen Zeitpunkt erfragt, nicht für heute.
 *
 * **Die beiden Stunden, die aus der Reihe fallen.** In der Nacht der Umstellung gibt es eine
 * Stunde nicht und eine doppelt. Die Sprungstunde landet auf der Stunde danach; die doppelte auf
 * ihrem **zweiten** Durchgang, also nach dem Zurückstellen.
 *
 * Das ist beobachtet und aufgeschrieben, nicht erzwungen. Erzwingen ließe sich beides, und es wäre
 * zusätzliche Logik für zwei Stunden im Jahr, in denen eine Rundmail um eine Stunde später kommt
 * als gedacht — später, nicht früher, was die harmlosere Richtung ist. Sollte es einmal darauf
 * ankommen, steht der Fall im Test daneben und ist dort zu ändern.
 */

const BERLIN = 'Europe/Berlin'

/** Zerlegt einen Zeitpunkt in die Zahlen, die in Berlin auf der Uhr stehen. */
const berlinParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/**
 * Wie weit Berlin zu diesem Zeitpunkt vor UTC liegt, in Millisekunden.
 *
 * Der Trick: dieselbe Uhrzeit einmal als Berliner Wanduhr lesen und einmal als UTC deuten. Die
 * Differenz ist der Versatz, den Berlin an genau diesem Tag hatte.
 */
function offsetAt(instant: Date): number {
  const parts = berlinParts.formatToParts(instant)
  const of = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  const asIfUtc = Date.UTC(
    of('year'),
    of('month') - 1,
    of('day'),
    of('hour'),
    of('minute'),
    of('second'),
  )

  return asIfUtc - instant.getTime()
}

/**
 * Aus „2026-09-06T20:00" (Berliner Wanduhr) den Zeitpunkt in UTC.
 *
 * Zwei Durchgänge, und der zweite ist kein Übereifer: Der erste Versuch rät den Versatz anhand des
 * falsch gedeuteten Zeitpunkts, was nur dann danebenliegt, wenn die Umstellung zwischen beiden
 * liegt — also genau in den Stunden, um die es geht. Der zweite fragt mit dem berichtigten
 * Zeitpunkt noch einmal nach.
 */
export function berlinToUtc(local: string): string {
  const naive = new Date(`${local.length === 16 ? `${local}:00` : local}Z`)

  const firstGuess = new Date(naive.getTime() - offsetAt(naive))
  const corrected = new Date(naive.getTime() - offsetAt(firstGuess))

  return corrected.toISOString()
}

/**
 * Der Rückweg: aus einem UTC-Zeitpunkt die Berliner Wanduhr, in der Form, die ein
 * `datetime-local`-Feld erwartet.
 */
export function utcToBerlin(iso: string): string {
  const parts = berlinParts.formatToParts(new Date(iso))
  const of = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return `${of('year')}-${of('month')}-${of('day')}T${of('hour')}:${of('minute')}`
}

/** „So., 6. September, 20:00 Uhr" — wie es unter dem Feld und in den Listen steht. */
export function formatBerlin(iso: string): string {
  return `${new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))} Uhr`
}
