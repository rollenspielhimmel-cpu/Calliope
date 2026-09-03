import { db } from "@/src/database/client.ts";

/**
 * Which email domains may not register, kept in the database rather than in the code: new
 * throwaway-mail providers appear constantly, and a deploy per provider is the wrong cost for
 * something the operators already know.
 *
 * Only ever an exact domain match. Matching a suffix would be the obvious next step and is
 * deliberately not done: `mail.com` would then take `gmail.com` with it.
 */

/** The part after the `@`, lower-cased. Undefined for anything that is not an address. */
function domainOf(emailAddress: string): string | undefined {
  return emailAddress.split("@")[1]?.toLowerCase();
}

async function isBlocked(emailAddress: string): Promise<boolean> {
  const domain = domainOf(emailAddress);

  if (domain === undefined) {
    return false;
  }

  const row = await db
    .selectFrom("blockedEmailDomain")
    .select("domain")
    .where("domain", "=", domain)
    .executeTakeFirst();

  return row !== undefined;
}

export type BlockedDomain = {
  domain: string;
  addedBy: { id: string; username: string } | null;
  addedAt: string;
  note: string | null;
};

/** Alphabetical: this is a list somebody reads to find out whether something is on it. */
async function listBlocked(): Promise<BlockedDomain[]> {
  const rows = await db
    .selectFrom("blockedEmailDomain")
    .leftJoin("user", "user.id", "blockedEmailDomain.addedBy")
    .select([
      "blockedEmailDomain.domain",
      "blockedEmailDomain.addedAt",
      "blockedEmailDomain.note",
      "user.id as addedById",
      "user.username as addedByUsername",
    ])
    .orderBy("blockedEmailDomain.domain", "asc")
    .execute();

  return rows.map((row) => ({
    domain: row.domain,
    addedBy: row.addedById === null || row.addedByUsername === null
      ? null
      : { id: row.addedById, username: row.addedByUsername },
    addedAt: row.addedAt,
    note: row.note,
  }));
}

/** Adding one already on the list updates its note rather than failing. */
async function addBlocked(
  domain: string,
  addedBy: string,
  note: string | undefined,
): Promise<void> {
  await db
    .insertInto("blockedEmailDomain")
    .values({ domain: domain.toLowerCase(), addedBy, note: note ?? null })
    .onConflict((conflict) =>
      conflict.column("domain").doUpdateSet({ note: note ?? null, addedBy })
    )
    .execute();
}

async function removeBlocked(domain: string): Promise<void> {
  await db
    .deleteFrom("blockedEmailDomain")
    .where("domain", "=", domain.toLowerCase())
    .execute();
}

export const BlockedEmailDomainService = {
  isBlocked,
  listBlocked,
  addBlocked,
  removeBlocked,
};
