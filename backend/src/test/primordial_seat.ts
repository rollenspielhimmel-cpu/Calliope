import { db } from "@/src/database/client.ts";
import { ROOT_ADMIN_USERNAME } from "@/src/service/root_admin_service.ts";

/**
 * Borrowing the one primordial-administrator seat, for tests that need a session holding it.
 *
 * **There is exactly one**, enforced by `user_one_primordial_admin_idx`, and the suite runs its
 * files in parallel. A file that frees the seat and takes it for its own fixture is therefore
 * taking it from whoever else is mid-test — which is how three green files became five red ones the
 * moment a third wanted it.
 *
 * `blind_date_access_test.ts` avoids this by only ever reading who holds it, and says so: taking it
 * there „would make the *other* file fail instead". That works when you need an id. It does not
 * work when you need to be signed in as the holder, because a session needs an account whose
 * password the test knows.
 *
 * So this waits instead. The take is one transaction — free the current holder, claim it — and the
 * unique index decides who wins when two files reach for it at the same moment; the loser sees the
 * constraint fail and tries again. That makes the seat a real lock rather than a convention, and
 * the next file that wants it has something to reach for.
 */

const ATTEMPTS = 100;
const PAUSE_MILLISECONDS = 50;

async function claim(username: string): Promise<boolean> {
  try {
    await db.transaction().execute(async (transaction) => {
      // Freeing first and claiming second: between the two statements nobody holds it, which the
      // partial unique index allows. The other order would have two holders for an instant and
      // fail every time.
      await transaction
        .updateTable("user")
        .set({ isPrimordialAdmin: false })
        .where("isPrimordialAdmin", "=", true)
        .execute();

      await transaction
        .updateTable("user")
        .set({ isPrimordialAdmin: true })
        .where("username", "=", username)
        .execute();
    });

    return true;
  } catch {
    // Somebody else claimed it between our read and our write. Nothing is wrong; wait and retry.
    return false;
  }
}

/**
 * Waits until the seat is held by the bootstrapped account — meaning no other file is using it —
 * and then moves it to `username`. Pair every call with `returnPrimordialSeat`.
 */
export async function borrowPrimordialSeat(username: string): Promise<void> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // deno-lint-ignore no-await-in-loop -- sequential is the point: this waits for a lock
    const holder = await db
      .selectFrom("user")
      .select("username")
      .where("isPrimordialAdmin", "=", true)
      .executeTakeFirst();

    // Only `Admin` means free. Any other holder is another file's fixture, and taking it from
    // there is the bug this helper exists to stop.
    // deno-lint-ignore no-await-in-loop -- one attempt at a time, by definition
    if (holder?.username === ROOT_ADMIN_USERNAME && await claim(username)) {
      return;
    }

    // deno-lint-ignore no-await-in-loop -- the pause between attempts
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MILLISECONDS));
  }

  throw new Error(
    `the primordial seat did not come free within ${
      (ATTEMPTS * PAUSE_MILLISECONDS) / 1000
    } seconds`,
  );
}

/**
 * Gives the seat back to the bootstrapped account.
 *
 * Must run even when the test failed, or every later file waits five seconds and then fails too —
 * so it belongs in an `afterEach`, not at the end of a test body.
 */
export async function returnPrimordialSeat(): Promise<void> {
  await claim(ROOT_ADMIN_USERNAME);
}
