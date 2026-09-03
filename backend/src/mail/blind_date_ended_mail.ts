import { APP_NAME } from "@/src/branding.ts";
import type { Mail } from "@/src/mail/mailer.ts";

/**
 * Sent to the person whose own name appeared in the exchange thread, explaining why their
 * Blind-Date ended.
 *
 * **Matter-of-fact, not accusing.** Giving your own name away is usually a slip rather than a
 * scheme — somebody signs off with their name out of habit — and the mail is written for that
 * person, because they are the common case. It says what happened, what follows from it, and how
 * to reach somebody; it does not tell them off, and it does not repeat the name that leaked.
 *
 * It is deliberately the only place the reason is spelled out. The other person is told the
 * Blind-Date ended and nothing more, because whose slip it was is not theirs to be handed.
 */
export function blindDateEndedMail(
  { username, emailAddress }: { username: string; emailAddress: string },
): Mail {
  return {
    to: emailAddress,
    subject: `Dein Blind-Date bei ${APP_NAME} wurde beendet`,
    text: `Hallo ${username},

in eurem Thread "Gemeinsamer Austausch" ist dein Benutzername aufgetaucht. Damit war die
Anonymität aufgehoben, die ein Blind-Date ausmacht — deshalb wurde es automatisch beendet.

Was das heißt:

- Die Gruppe und alles, was ihr beide geschrieben habt, bleiben erhalten. Es wurde nichts
  gelöscht.
- Ihr schreibt weiterhin unter euren Blind-Date-Namen. Niemand wurde enthüllt.
- Für neue Blind-Dates bist du vorerst nicht mehr vorgemerkt.

Das passiert oft aus Versehen — eine Signatur, eine Gewohnheit beim Abschied. Wenn du meinst,
dass hier etwas schiefgelaufen ist, melde dich einfach beim Team; ein Mensch sieht sich das an.

Viele Grüße
${APP_NAME}
`,
  };
}
