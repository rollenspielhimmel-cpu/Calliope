import { db } from "@/src/database/client.ts";
import {
  type ListQuery,
  type ListResults,
  listResultsWithCount,
  searchPattern,
} from "@/src/list/list_endpoint_query.ts";

/**
 * What moderation may know about the addresses behind an account — deliberately separate from
 * the session list a member sees of their own: the same rows, but a different reader, and a
 * cross-account question no member would ever ask about themselves.
 */

export type IpAddressEntry = {
  ipAddress: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Other accounts seen from the same address. Empty means nothing to flag. */
  sharedWith: { id: string; username: string }[];
};

async function listIpAddressesForUser(
  userId: string,
): Promise<IpAddressEntry[]> {
  const rows = await db
    .selectFrom("userSession")
    .select("ipAddress")
    .select((eb) => eb.fn.min("createdAt").as("firstSeenAt"))
    .select((eb) => eb.fn.max("createdAt").as("lastSeenAt"))
    .where("userId", "=", userId)
    .where("ipAddress", "is not", null)
    .groupBy("ipAddress")
    .orderBy("lastSeenAt", "desc")
    .execute();

  const addresses = rows.map((row) => row.ipAddress as string);

  if (addresses.length === 0) {
    return [];
  }

  // One query for every address rather than one per address: a long-lived account can have
  // dozens, and this list is read while somebody waits on a profile page.
  const shared = await db
    .selectFrom("userSession")
    .innerJoin("user", "user.id", "userSession.userId")
    .select(["userSession.ipAddress", "user.id", "user.username"])
    .distinct()
    .where("userSession.ipAddress", "in", addresses)
    .where("userSession.userId", "!=", userId)
    .execute();

  const sharedByAddress = new Map<string, { id: string; username: string }[]>();

  for (const row of shared) {
    const address = row.ipAddress as string;
    const accounts = sharedByAddress.get(address) ?? [];
    accounts.push({ id: row.id, username: row.username });
    sharedByAddress.set(address, accounts);
  }

  return rows.map((row) => ({
    ipAddress: row.ipAddress as string,
    // Already ISO strings: the driver parses timestamptz on the way out (see postgres_types.ts).
    firstSeenAt: row.firstSeenAt as string,
    lastSeenAt: row.lastSeenAt as string,
    sharedWith: sharedByAddress.get(row.ipAddress as string) ?? [],
  }));
}

/** An account seen from an address, as all three tabs name one. */
export type SeenAccount = {
  id: string;
  username: string;
  emailAddress: string;
};

/**
 * Every account that has ever held a session from each of these addresses.
 *
 * One query for all of them rather than one per address — the tabs that call this read dozens at
 * a time, and a query per row is how a page of twenty becomes twenty round trips.
 */
async function accountsByAddress(
  addresses: string[],
): Promise<Map<string, SeenAccount[]>> {
  const byAddress = new Map<string, SeenAccount[]>();

  if (addresses.length === 0) {
    return byAddress;
  }

  const rows = await db
    .selectFrom("userSession")
    .innerJoin("user", "user.id", "userSession.userId")
    .select([
      "userSession.ipAddress",
      "user.id",
      "user.username",
      "user.emailAddress",
    ])
    .distinct()
    .where("userSession.ipAddress", "in", addresses)
    .orderBy("user.username", "asc")
    .execute();

  for (const row of rows) {
    const address = row.ipAddress as string;
    const accounts = byAddress.get(address) ?? [];
    accounts.push({
      id: row.id,
      username: row.username,
      emailAddress: row.emailAddress,
    });
    byAddress.set(address, accounts);
  }

  return byAddress;
}

/**
 * One row per member for the overview tab: who they are, which addresses they have been seen
 * from, and which *other* accounts share any of them.
 *
 * Members with no session yet are in the list with nothing beside them, deliberately — the tab is
 * "every member", and leaving out the ones with no address would quietly make it another question.
 */
export type MemberIpOverview = {
  id: string;
  username: string;
  emailAddress: string;
  bannedAt: string | null;
  ipAddresses: string[];
  /** Other accounts sharing any of those addresses. Empty means nothing to look at. */
  possibleAlts: { id: string; username: string }[];
};

async function listMemberIpOverview(
  query: ListQuery,
): Promise<ListResults<MemberIpOverview>> {
  const page = await listResultsWithCount(
    db
      .selectFrom("user")
      .select([
        "user.id",
        "user.username",
        "user.emailAddress",
        "user.bannedAt",
      ])
      .$if(
        query.search !== undefined,
        (builder) =>
          // deno-lint-ignore no-non-null-assertion -- the `$if` only runs this when it is set
          builder.where("user.username", "ilike", searchPattern(query.search!)),
      ),
    query,
  );

  const memberIds = page.results.map((member) => member.id);

  if (memberIds.length === 0) {
    return { ...page, results: [] };
  }

  // Only this page's members: the session table is large, and nothing off the page is shown.
  const sessions = await db
    .selectFrom("userSession")
    .select(["userId", "ipAddress"])
    .distinct()
    .where("userId", "in", memberIds)
    .where("ipAddress", "is not", null)
    .orderBy("ipAddress", "asc")
    .execute();

  const addressesByMember = new Map<string, string[]>();

  for (const row of sessions) {
    const held = addressesByMember.get(row.userId) ?? [];
    held.push(row.ipAddress as string);
    addressesByMember.set(row.userId, held);
  }

  const accounts = await accountsByAddress([
    ...new Set(sessions.map((row) => row.ipAddress as string)),
  ]);

  return {
    ...page,
    results: page.results.map((member) => {
      const addresses = addressesByMember.get(member.id) ?? [];

      // De-duplicated across the member's addresses: two accounts sharing two addresses with
      // this one are two names here, not four.
      const alts = new Map<string, { id: string; username: string }>();

      for (const address of addresses) {
        for (const account of accounts.get(address) ?? []) {
          if (account.id !== member.id) {
            alts.set(account.id, {
              id: account.id,
              username: account.username,
            });
          }
        }
      }

      return {
        ...member,
        ipAddresses: addresses,
        possibleAlts: [...alts.values()],
      };
    }),
  };
}

/**
 * The addresses more than one account has been seen from, which is the whole of the third tab.
 *
 * The same fact the overview carries per member, asked the other way round: grouped by address,
 * and only where there is something to look at. Sorted by how many accounts share one, because
 * four accounts on an address is a different thing from two.
 *
 * **This is a question, not an answer.** A household, a phone network behind CGNAT and a school
 * all put unrelated people on one address; the interface says so rather than calling these alts.
 */
export type SharedIpAddress = {
  /** The address is the row's identity — every list sorts on `id` last. */
  id: string;
  ipAddress: string;
  accountCount: number;
  accounts: SeenAccount[];
};

async function listSharedIpAddresses(
  query: ListQuery,
): Promise<ListResults<SharedIpAddress>> {
  const page = await listResultsWithCount(
    db
      .selectFrom("userSession")
      .select((eb) => [
        eb.ref("userSession.ipAddress").$castTo<string>().as("id"),
        eb.ref("userSession.ipAddress").$castTo<string>().as("ipAddress"),
        eb.fn.count<number>("userSession.userId").distinct().as("accountCount"),
      ])
      .where("userSession.ipAddress", "is not", null)
      .groupBy("userSession.ipAddress")
      .having((eb) => eb.fn.count("userSession.userId").distinct(), ">=", 2),
    query,
  );

  const accounts = await accountsByAddress(
    page.results.map((row) => row.ipAddress),
  );

  return {
    ...page,
    results: page.results.map((row) => ({
      ...row,
      accountCount: Number(row.accountCount),
      accounts: accounts.get(row.ipAddress) ?? [],
    })),
  };
}

export type BannedIp = {
  ipAddress: string;
  bannedAt: string;
  bannedBy: { id: string; username: string } | null;
  reason: string;
  /**
   * Who was ever seen from it. An address is banned rather than an account, so this is the only
   * thing that says who a ban originally reached — and it can be empty, because an address may
   * be banned that no account here has ever used.
   */
  accounts: SeenAccount[];
};

async function listBannedIps(): Promise<BannedIp[]> {
  const rows = await db
    .selectFrom("bannedIp")
    .leftJoin("user", "user.id", "bannedIp.bannedBy")
    .select([
      "bannedIp.ipAddress",
      "bannedIp.bannedAt",
      "bannedIp.reason",
      "user.id as bannedById",
      "user.username as bannedByUsername",
    ])
    .orderBy("bannedIp.bannedAt", "desc")
    .execute();

  const accounts = await accountsByAddress(rows.map((row) => row.ipAddress));

  return rows.map((row) => ({
    ipAddress: row.ipAddress,
    bannedAt: row.bannedAt,
    bannedBy: row.bannedById === null || row.bannedByUsername === null
      ? null
      : { id: row.bannedById, username: row.bannedByUsername },
    reason: row.reason,
    accounts: accounts.get(row.ipAddress) ?? [],
  }));
}

async function banIp(
  ipAddress: string,
  bannedBy: string,
  reason: string,
): Promise<void> {
  await db
    .insertInto("bannedIp")
    .values({ ipAddress, bannedBy, reason })
    // Banning an address twice is the same as banning it once; only the reason and who decided
    // it are refreshed, in case a second incident names something the first did not.
    .onConflict((conflict) =>
      conflict.column("ipAddress").doUpdateSet({ reason, bannedBy })
    )
    .execute();
}

async function unbanIp(ipAddress: string): Promise<void> {
  await db.deleteFrom("bannedIp").where("ipAddress", "=", ipAddress).execute();
}

/** Checked on every request by `middleware/ip_ban.ts`. */
async function isIpBanned(ipAddress: string): Promise<boolean> {
  const row = await db
    .selectFrom("bannedIp")
    .select("ipAddress")
    .where("ipAddress", "=", ipAddress)
    .executeTakeFirst();

  return row !== undefined;
}

export const IpModerationService = {
  listIpAddressesForUser,
  listMemberIpOverview,
  listSharedIpAddresses,
  listBannedIps,
  banIp,
  unbanIp,
  isIpBanned,
};
