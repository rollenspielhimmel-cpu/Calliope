import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { db } from "@/src/database/client.ts";
import { verifyPassword } from "@/src/util/password.ts";
import {
  ensureRootAdmin,
  ROOT_ADMIN_USERNAME,
} from "@/src/service/root_admin_service.ts";

/**
 * The account is created by the running application before these tests, so each of them puts the
 * existing one aside, exercises the bootstrap against an empty seat, and puts it back.
 */

const PASSWORD = "a-bootstrap-test-password";
const STANDIN = "root-admin-test-standin";

async function withoutTheRealRootAdmin<T>(body: () => Promise<T>): Promise<T> {
  // Renamed rather than deleted: it owns rows elsewhere. The address moves with the name,
  // because that column is UNIQUE too and the bootstrap would otherwise collide with it.
  await db
    .updateTable("user")
    .set({
      username: STANDIN,
      emailAddress: `${STANDIN}@example.invalid`,
      isPrimordialAdmin: false,
    })
    .where("username", "=", ROOT_ADMIN_USERNAME)
    .execute();

  try {
    return await body();
  } finally {
    await db
      .deleteFrom("user")
      .where("username", "=", ROOT_ADMIN_USERNAME)
      .execute();

    await db
      .updateTable("user")
      .set({
        username: ROOT_ADMIN_USERNAME,
        emailAddress: "admin@rollenspielhimmel.invalid",
        isPrimordialAdmin: true,
      })
      .where("username", "=", STANDIN)
      .execute();
  }
}

Deno.test("the first start creates an administrator that can sign in unverified", async () => {
  await withoutTheRealRootAdmin(async () => {
    Deno.env.set("ROOT_ADMIN_PASSWORD", PASSWORD);
    await ensureRootAdmin();

    const created = await db
      .selectFrom("user")
      .selectAll()
      .where("username", "=", ROOT_ADMIN_USERNAME)
      .executeTakeFirst();

    assertExists(created, "no administrator was created");
    assertEquals(created.platformRole, "administrator");
    assertEquals(created.isPrimordialAdmin, true);

    // What lets it sign in without ever confirming an address: it satisfies the existing gate
    // rather than being excused from it, so there is no second way through `authenticated`.
    assertNotEquals(created.emailAddressVerifiedAt, null);

    // Hashed by the application, never stored as given.
    assertNotEquals(created.hashedPassword, PASSWORD);
    assertEquals(await verifyPassword(PASSWORD, created.hashedPassword), true);
  });
});

Deno.test("a later start neither duplicates the account nor resets its password", async () => {
  await withoutTheRealRootAdmin(async () => {
    Deno.env.set("ROOT_ADMIN_PASSWORD", PASSWORD);
    await ensureRootAdmin();

    // Editing the variable must not silently change a live credential on the next restart.
    Deno.env.set("ROOT_ADMIN_PASSWORD", "a-different-password");
    await ensureRootAdmin();

    const accounts = await db
      .selectFrom("user")
      .select("hashedPassword")
      .where("username", "=", ROOT_ADMIN_USERNAME)
      .execute();

    assertEquals(accounts.length, 1);
    assertExists(accounts[0]);
    assertEquals(
      await verifyPassword(PASSWORD, accounts[0].hashedPassword),
      true,
    );

    Deno.env.set("ROOT_ADMIN_PASSWORD", PASSWORD);
  });
});

Deno.test("without the variable no account is created", async () => {
  await withoutTheRealRootAdmin(async () => {
    Deno.env.delete("ROOT_ADMIN_PASSWORD");
    await ensureRootAdmin();

    const created = await db
      .selectFrom("user")
      .select("username")
      .where("username", "=", ROOT_ADMIN_USERNAME)
      .executeTakeFirst();

    assertEquals(created, undefined);
    Deno.env.set("ROOT_ADMIN_PASSWORD", PASSWORD);
  });
});
