import { APP_NAME } from "@/src/branding.ts";
import type { Mail } from "@/src/mail/mailer.ts";

/**
 * A message the operators write themselves, sent to many members at once. Text only, like every
 * other mail here: one copy of the words to keep in step.
 *
 * The body is passed through as written rather than wrapped in a template — an operator typing
 * a greeting and a sign-off is writing the whole message, and a second greeting added around it
 * would read as a mistake. What is added is the closing line saying where it came from, because
 * a mail with no attribution is the one that reads as spam.
 */
export function broadcastMail(
  { emailAddress, subject, body }: {
    emailAddress: string;
    subject: string;
    body: string;
  },
): Mail {
  return {
    to: emailAddress,
    subject,
    text: `${body}

—
Diese Nachricht wurde vom Team von ${APP_NAME} an alle Mitglieder verschickt.
`,
  };
}
