import { db } from "@/src/database/client.ts";
import { hashPassword } from "@/src/util/password.ts";
import { getOptionalEnvVariable } from "@/src/util/env.ts";
import { logger } from "@/src/logging.ts";

/**
 * The first administrator, created at startup so that a fresh deployment has somebody who can
 * appoint everybody else.
 *
 * **Not a migration.** The password is hashed by `util/password.ts`, which is application code —
 * and a hash written into SQL would be a credential committed to a public repository. It comes
 * from the environment for the same reason, and `.env` is gitignored.
 */

export const ROOT_ADMIN_USERNAME = "Admin";

/**
 * `.invalid` is reserved by RFC 2606 and can never be registered or delivered to, which is what
 * makes it honest here: `email_address` is UNIQUE and NOT NULL, so this account needs *an*
 * address, and it must not be one somebody could own or one that could receive a reset link.
 *
 * The account never verifies it — see below — so nothing is ever sent there.
 */
const ROOT_ADMIN_EMAIL_ADDRESS = "admin@rollenspielhimmel.invalid";

/**
 * Creates the account if there is none. Idempotent: every later start finds it and does nothing,
 * and it does not reset the password of an account that already exists — otherwise editing the
 * variable would silently change a live credential on the next restart.
 *
 * Deleting the account is therefore self-healing: the next start makes it again.
 */
export async function ensureRootAdmin(): Promise<void> {
  const password = getOptionalEnvVariable("ROOT_ADMIN_PASSWORD");

  const existing = await db
    .selectFrom("user")
    .select("username")
    .where("isPrimordialAdmin", "=", true)
    .executeTakeFirst();

  if (existing !== undefined) {
    return;
  }

  // Optional rather than required: `open-api.json` is generated with nothing but `.example.env`
  // set, and a required variable would make that fail. A deployment that has not set one simply
  // has no root administrator yet, which the log says plainly.
  if (password === undefined) {
    logger.warn(
      "No ROOT_ADMIN_PASSWORD is set, so no administrator was created",
      { username: ROOT_ADMIN_USERNAME },
    );
    return;
  }

  const created = await db
    .insertInto("user")
    .values({
      username: ROOT_ADMIN_USERNAME,
      hashedPassword: await hashPassword(password),
      emailAddress: ROOT_ADMIN_EMAIL_ADDRESS,
      platformRole: "administrator",
      isPrimordialAdmin: true,
      // Marked verified at creation, which is what lets this account sign in without ever
      // confirming an address. The gate in `authenticated.ts` is untouched: this account
      // satisfies it rather than being excused from it, so there is no second code path in
      // which a member could reach the application unverified.
      emailAddressVerifiedAt: Temporal.Now.instant().toString(),
    })
    // Another instance starting at the same moment wins the unique index rather than throwing.
    // The username and the address are unique too, so an account already holding either also
    // lands here — which is why what happened is read back rather than assumed.
    .onConflict((conflict) => conflict.doNothing())
    .returning("id")
    .executeTakeFirst();

  if (created === undefined) {
    logger.warn(
      "No administrator was created: the username or the address is already taken",
      { username: ROOT_ADMIN_USERNAME, emailAddress: ROOT_ADMIN_EMAIL_ADDRESS },
    );
    return;
  }

  logger.info("Created the first administrator", {
    username: ROOT_ADMIN_USERNAME,
  });
}
