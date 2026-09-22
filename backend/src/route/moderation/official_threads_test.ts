import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  deleteUsers,
  getUserId,
  postBody,
  registerUser,
  request,
  scopedTestData,
} from "@/src/test/support.ts";
import { borrowPrimordialSeat } from "@/src/test/primordial_seat.ts";
import { clearForum, createForumFolder } from "@/src/test/forum.ts";
import { OfficialThreadService } from "@/src/service/official_thread_service.ts";

/**
 * Offizielle Forum-Threads.
 *
 * **Der wichtigste Test hier sucht den Namen und die Kennung des Schreibers im rohen Text jeder
 * Antwort, die ein Mitglied bekommt** — Baum, Einzelansicht, Beiträge, Suche —, nicht in den
 * Feldern, die man dafür erwarten würde. Außen steht der Absender; wer geschrieben hat, darf in
 * keiner Antwort an ein Mitglied stehen.
 */

const ROOT = "ot-root";
const ADMIN = "ot-admin";
const MOD = "ot-mod";
const MEMBER = "ot-member";
const FLAMINGO = "ot-flamingo";

const USERS = [ROOT, ADMIN, MOD, MEMBER, FLAMINGO];

// Nur in dieser Datei, damit die Suche im rohen Text nichts Fremdes findet.
const TITLE = "ot-offizielle-ankuendigung";
const TEXT = "ot-der-eroeffnungsbeitrag";

const data = scopedTestData({
  users: USERS,
  seat: ROOT,
  remove: async (transaction) => {
    const ids = transaction
      .selectFrom("user")
      .select("id")
      .where("username", "in", USERS);

    await transaction.deleteFrom("officialRevision")
      .where("editedBy", "in", ids)
      .execute();
    await transaction.deleteFrom("publication").where("writtenBy", "in", ids)
      .execute();
  },
});

async function setRole(
  username: string,
  role: "administrator" | "moderator" | null,
) {
  await db
    .updateTable("user")
    .set({ platformRole: role })
    .where("username", "=", username)
    .execute();
}

function fixture() {
  return data.freshly(async () => {
    const cookies = {
      root: await registerUser(ROOT),
      admin: await registerUser(ADMIN),
      mod: await registerUser(MOD),
      member: await registerUser(MEMBER),
      flamingo: await registerUser(FLAMINGO),
    };

    await setRole(ROOT, "administrator");
    await setRole(ADMIN, "administrator");
    await setRole(MOD, "moderator");

    await db
      .insertInto("broadcastSender")
      .values({ userId: await getUserId(FLAMINGO) })
      .execute();

    await borrowPrimordialSeat(ROOT);
    const granted = await request(
      "PUT",
      `/api/moderation/broadcast/senders/${await getUserId(
        FLAMINGO,
      )}/roles/moderator`,
      cookies.root,
    );
    assertEquals(granted.status, STATUS_CODE.OK);

    return cookies;
  });
}

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(async () => {
  await clearForum(USERS);
  await data.cleanUp();
});

async function submit(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  return await request("POST", "/api/moderation/official-threads", cookie, {
    title: TITLE,
    text: TEXT,
    folderId: null,
    sendAsUserId: await getUserId(FLAMINGO),
    scheduledFor: null,
    ...overrides,
  });
}

async function submitted(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await submit(cookie, overrides);
  assertEquals(response.status, STATUS_CODE.Created);
  return await response.json() as {
    publicationId: string;
    threadId: string;
    status: string;
  };
}

/** Alles, was ein Mitglied über den Thread zu lesen bekommt, als ein roher Text. */
async function whatAMemberReads(cookie: string, threadId: string) {
  const tree = await (await request("GET", "/api/forum/threads", cookie))
    .text();
  const one = await request("GET", `/api/forum/threads/${threadId}`, cookie);
  const posts = await request(
    "QUERY",
    `/api/forum/threads/${threadId}/posts`,
    cookie,
    { limit: 50, offset: 0 },
  );
  const search = await (await request("QUERY", "/api/search", cookie, {
    search: TITLE,
  })).text();
  return {
    tree,
    oneStatus: one.status,
    one: await one.text(),
    postsStatus: posts.status,
    posts: await posts.text(),
    search,
  };
}

Deno.test("vor der Freigabe steht der Thread für niemanden im Forum, nur in der Warteschlange", async () => {
  const cookies = await fixture();

  const { threadId, status } = await submitted(cookies.mod);
  assertEquals(status, "awaiting_approval");

  for (const cookie of [cookies.member, cookies.mod, cookies.admin]) {
    // deno-lint-ignore no-await-in-loop -- drei Blickwinkel, nacheinander
    const read = await whatAMemberReads(cookie, threadId);
    assert(!read.tree.includes(TITLE), "nicht im Baum");
    assertEquals(read.oneStatus, STATUS_CODE.NotFound);
    assertEquals(read.postsStatus, STATUS_CODE.NotFound);
    assert(!read.search.includes(TITLE), "nicht in der Suche");
  }

  const queue = await (await request(
    "GET",
    "/api/moderation/official-threads/queue",
    cookies.admin,
  )).text();
  assert(queue.includes(TITLE), "aber in der Warteschlange");

  // Und auch nicht zum Merken.
  assertEquals(
    (await request(
      "PUT",
      `/api/favourites/writing_thread/${threadId}`,
      cookies.member,
    )).status,
    STATUS_CODE.NotFound,
  );
});

/**
 * **Außen der Absender, innen der Schreiber.** Nach der Freigabe steht Infoflamingo da — und der
 * Mod, der geschrieben hat, in keiner Antwort an ein Mitglied, weder als Name noch als Kennung.
 */
Deno.test("nach der Freigabe steht der Absender da, und der Schreiber nirgends", async () => {
  const cookies = await fixture();
  const { publicationId, threadId } = await submitted(cookies.mod);

  assertEquals(
    (await request(
      "POST",
      `/api/moderation/official-threads/${publicationId}/approval`,
      cookies.admin,
    )).status,
    STATUS_CODE.OK,
  );

  const read = await whatAMemberReads(cookies.member, threadId);
  assert(read.tree.includes(TITLE), "jetzt im Baum");
  assertEquals(read.oneStatus, STATUS_CODE.OK);
  assert(read.posts.includes(TEXT), "der Eröffnungsbeitrag ist da");
  assert(read.search.includes(TITLE), "und in der Suche");

  const writerId = await getUserId(MOD);
  for (const [where, raw] of Object.entries(read)) {
    if (typeof raw !== "string") continue;
    assert(!raw.includes(MOD), `der Name des Schreibers steht in ${where}`);
    assert(
      !raw.includes(writerId),
      `die Kennung des Schreibers steht in ${where}`,
    );
  }

  const post = (JSON.parse(read.posts) as {
    results: Array<
      { createdByUsername: string; createdBy: string; isOfficial: boolean }
    >;
  }).results[0];
  assertEquals(post?.createdByUsername, FLAMINGO);
  assertEquals(post?.createdBy, await getUserId(FLAMINGO));
  assertEquals(post?.isOfficial, true);

  const thread = JSON.parse(read.one) as {
    createdByUsername: string;
    isOfficial: boolean;
  };
  assertEquals(thread.createdByUsername, FLAMINGO);
  assertEquals(thread.isOfficial, true);
});

/** Mit dem Erscheinen bekommt er die Uhrzeit der Veröffentlichung, nicht die des Schreibens. */
Deno.test("der Thread trägt die Zeit seines Erscheinens", async () => {
  const cookies = await fixture();
  const { publicationId, threadId } = await submitted(cookies.mod);

  // Das Schreiben liegt eine Stunde zurück.
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.updateTable("writingThread").set({ createdAt: anHourAgo })
    .where("id", "=", threadId).execute();
  await db.updateTable("writingPost").set({ createdAt: anHourAgo })
    .where("writingThreadId", "=", threadId).execute();

  const before = Date.now();
  await request(
    "POST",
    `/api/moderation/official-threads/${publicationId}/approval`,
    cookies.admin,
  );

  const thread = await db.selectFrom("writingThread").select("createdAt")
    .where("id", "=", threadId).executeTakeFirstOrThrow();
  const post = await db.selectFrom("writingPost").select("createdAt")
    .where("writingThreadId", "=", threadId).executeTakeFirstOrThrow();

  assert(
    Date.parse(thread.createdAt) >= before - 1000,
    "der Thread ist frisch",
  );
  assert(Date.parse(post.createdAt) >= before - 1000, "der Beitrag auch");
});

Deno.test("von einer Administration erscheint er ohne Termin sofort, mit Termin erst zur Zeit", async () => {
  const cookies = await fixture();

  const now = await submitted(cookies.admin);
  assertEquals(now.status, "released");

  const later = await submitted(cookies.admin, {
    title: `${TITLE}-spaeter`,
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  assertEquals(later.status, "approved");
  assertEquals(await OfficialThreadService.releaseDue(), 0, "noch nicht");
  assertEquals(
    (await request(
      "GET",
      `/api/forum/threads/${later.threadId}`,
      cookies.member,
    ))
      .status,
    STATUS_CODE.NotFound,
  );

  // Der Termin ist erreicht.
  await db.updateTable("publication")
    .set({ scheduledFor: new Date(Date.now() - 1000).toISOString() })
    .where("id", "=", later.publicationId).execute();
  assertEquals(await OfficialThreadService.releaseDue(), 1);
  assertEquals(
    (await request(
      "GET",
      `/api/forum/threads/${later.threadId}`,
      cookies.member,
    ))
      .status,
    STATUS_CODE.OK,
  );
});

/** Der Termin allein veröffentlicht nichts: Was niemand freigegeben hat, bleibt verborgen. */
Deno.test("ein fälliger, aber nicht freigegebener Thread bleibt verborgen", async () => {
  const cookies = await fixture();
  const { threadId } = await submitted(cookies.mod, {
    scheduledFor: new Date(Date.now() - 1000).toISOString(),
  });

  assertEquals(await OfficialThreadService.releaseDue(), 0);
  assertEquals(
    (await request("GET", `/api/forum/threads/${threadId}`, cookies.member))
      .status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("ein verworfener Thread erscheint nie", async () => {
  const cookies = await fixture();
  const { publicationId, threadId } = await submitted(cookies.mod);

  assertEquals(
    (await request(
      "DELETE",
      `/api/moderation/official-threads/${publicationId}`,
      cookies.mod,
    )).status,
    STATUS_CODE.OK,
  );
  assertEquals(await OfficialThreadService.releaseDue(), 0);
  assertEquals(
    (await request("GET", `/api/forum/threads/${threadId}`, cookies.member))
      .status,
    STATUS_CODE.NotFound,
  );
});

/**
 * **Nach der Veröffentlichung gehört er der Administration.** Nicht dem Mod, der ihn geschrieben
 * hat, nicht einem Mitglied — und nicht dem, der sich als das Absender-Konto anmeldet: Für die
 * Rechte zählt nicht, wer außen als Autor steht.
 */
Deno.test("einen offiziellen Beitrag ändert und löscht nur die Administration", async () => {
  const cookies = await fixture();
  const { publicationId, threadId } = await submitted(cookies.mod);
  await request(
    "POST",
    `/api/moderation/official-threads/${publicationId}/approval`,
    cookies.admin,
  );
  const { id: postId } = await db.selectFrom("writingPost").select("id")
    .where("writingThreadId", "=", threadId).executeTakeFirstOrThrow();
  const path = `/api/forum/threads/${threadId}/posts/${postId}`;

  for (const cookie of [cookies.mod, cookies.member, cookies.flamingo]) {
    // deno-lint-ignore no-await-in-loop -- drei, nacheinander
    const changed = await request("PATCH", path, cookie, postBody("Anders."));
    assertEquals(changed.status, STATUS_CODE.Forbidden);
    // deno-lint-ignore no-await-in-loop -- dasselbe
    const removed = await request("DELETE", path, cookie);
    assertEquals(removed.status, STATUS_CODE.Forbidden);
  }

  assertEquals(
    (await request("PATCH", path, cookies.admin, {
      ...postBody("Korrigiert."),
      reason: "Tippfehler",
    })).status,
    STATUS_CODE.OK,
  );

  // Mitglieder sehen „bearbeitet", aber nicht, welche Administration es war: Ihr Name daneben
  // hieße, sie als Verfasserin zu zeigen.
  const read = await whatAMemberReads(cookies.member, threadId);
  assert(read.posts.includes("Korrigiert."), "die Korrektur ist da");
  assert(
    !read.posts.includes(ADMIN),
    "der Name der Administration steht nicht da",
  );
  assert(
    !read.posts.includes(await getUserId(ADMIN)),
    "ihre Kennung auch nicht",
  );
});

/** Wird das angezeigte Konto gelöscht, heißt der Beitrag „gelöschtes Konto" — nie der Schreiber. */
Deno.test("ohne das angezeigte Konto fällt der Beitrag nicht auf den Schreiber zurück", async () => {
  const cookies = await fixture();
  const { publicationId, threadId } = await submitted(cookies.mod);
  await request(
    "POST",
    `/api/moderation/official-threads/${publicationId}/approval`,
    cookies.admin,
  );

  await deleteUsers([FLAMINGO]);

  const read = await whatAMemberReads(cookies.member, threadId);
  const post = (JSON.parse(read.posts) as {
    results: Array<
      { createdByUsername: string | null; createdBy: string | null }
    >;
  }).results[0];
  assertEquals(post?.createdByUsername, null);
  assertEquals(post?.createdBy, null);
  assert(!read.posts.includes(MOD), "der Schreiber steht nicht da");
});

/** Antworten darunter stehen unter dem eigenen Namen. */
Deno.test("Antworten unter einem offiziellen Thread tragen den eigenen Namen", async () => {
  const cookies = await fixture();
  // In einem Unterforum, in dem Mitglieder schreiben: Ganz oben dürfen sie nur lesen, das ist die
  // Regel des Forums, nicht dieser Datei.
  const open = await createForumFolder("ot-offen", "write");
  const { threadId } = await submitted(cookies.admin, { folderId: open.id });

  const reply = await request(
    "POST",
    `/api/forum/threads/${threadId}/posts`,
    cookies.member,
    postBody("Eine Antwort."),
  );
  assertEquals(reply.status, STATUS_CODE.Created);
  const body = await reply.json() as {
    createdByUsername: string;
    isOfficial: boolean;
  };
  assertEquals(body.createdByUsername, MEMBER);
  assertEquals(body.isOfficial, false);
});

Deno.test("in ein Unterforum, das Mitglieder nicht sehen, darf er nicht", async () => {
  const cookies = await fixture();
  const hidden = await createForumFolder("ot-verborgen", "hidden");

  assertEquals(
    (await submit(cookies.admin, { folderId: hidden.id })).status,
    STATUS_CODE.NotFound,
  );
});

Deno.test("ohne Administration nur unter den eigenen Absendern, und nur das Eigene ändern", async () => {
  const cookies = await fixture();

  assertEquals(
    (await submit(cookies.member)).status,
    STATUS_CODE.Forbidden,
    "ein Mitglied bereitet nichts vor",
  );

  const { publicationId } = await submitted(cookies.admin, {
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/official-threads/${publicationId}`,
      cookies.mod,
      {
        title: TITLE,
        text: "Untergeschoben.",
        folderId: null,
        sendAsUserId: null,
        scheduledFor: null,
      },
    )).status,
    STATUS_CODE.Forbidden,
    "ein Mod ändert nicht, was die Administration eingereicht hat",
  );
});

/** Was ein Mod bearbeitet, wartet wieder; was eine Administration bearbeitet, ist freigegeben. */
Deno.test("die Bearbeitung eines Mods nimmt die Freigabe zurück", async () => {
  const cookies = await fixture();
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { publicationId } = await submitted(cookies.mod, {
    scheduledFor: later,
  });

  await request(
    "POST",
    `/api/moderation/official-threads/${publicationId}/approval`,
    cookies.admin,
  );

  const edited = await request(
    "PUT",
    `/api/moderation/official-threads/${publicationId}`,
    cookies.mod,
    {
      title: TITLE,
      text: "Doch etwas anderes.",
      folderId: null,
      sendAsUserId: await getUserId(FLAMINGO),
      scheduledFor: later,
    },
  );
  assertEquals(edited.status, STATUS_CODE.OK);
  assertEquals((await edited.json()).status, "awaiting_approval");
});

// ── 2b: nachträglich offiziell, und das Protokoll ───────────────────────────────────────────

/** Ein gewöhnlicher Forum-Thread mit Eröffnungsbeitrag, von dieser Person eröffnet. */
async function ordinaryThread(cookie: string, folderId: string) {
  const created = await request("POST", "/api/forum/threads", cookie, {
    title: `${TITLE}-gewoehnlich`,
    folderId,
  });
  assertEquals(created.status, STATUS_CODE.Created);
  const { id: threadId } = await created.json() as { id: string };

  const opening = await request(
    "POST",
    `/api/forum/threads/${threadId}/posts`,
    cookie,
    postBody(`${TEXT}-eroeffnung`),
  );
  assertEquals(opening.status, STATUS_CODE.Created);
  return { threadId };
}

async function postsAsSeenBy(cookie: string, threadId: string) {
  const posts = await (await request(
    "QUERY",
    `/api/forum/threads/${threadId}/posts`,
    cookie,
    { limit: 50, offset: 0 },
  )).json() as {
    results: Array<{ createdByUsername: string | null; isOfficial: boolean }>;
  };
  return posts.results;
}

async function makeOfficial(cookie: string, threadId: string) {
  return await request(
    "POST",
    "/api/moderation/official-threads/existing",
    cookie,
    { threadId, sendAsUserId: await getUserId(FLAMINGO) },
  );
}

/**
 * **Nachträglich offiziell:** Bis zur Freigabe bleibt der eigene Name stehen, danach steht der
 * Absender am Eröffnungsbeitrag — und spätere Antworten derselben Person bleiben unter ihrem Namen.
 */
Deno.test("nachträglich offiziell: bis zur Freigabe der eigene Name, danach nur der Eröffnungsbeitrag unter dem Absender", async () => {
  const cookies = await fixture();
  const open = await createForumFolder("ot-offen-2b", "write");
  const { threadId } = await ordinaryThread(cookies.mod, open.id);

  const submittedLater = await makeOfficial(cookies.mod, threadId);
  assertEquals(submittedLater.status, STATUS_CODE.Created);
  const { publicationId, status } = await submittedLater.json() as {
    publicationId: string;
    status: string;
  };
  assertEquals(status, "awaiting_approval");

  const before = await postsAsSeenBy(cookies.member, threadId);
  assertEquals(before[0]?.createdByUsername, MOD, "bis zur Freigabe");
  assertEquals(before[0]?.isOfficial, false);

  // Eine Antwort derselben Person, noch vor der Freigabe: Die Freigabe darf nur den
  // Eröffnungsbeitrag umbenennen, nicht alles, was sie im Thread geschrieben hat.
  await request(
    "POST",
    `/api/forum/threads/${threadId}/posts`,
    cookies.mod,
    postBody("Eine spätere Antwort."),
  );

  assertEquals(
    (await request(
      "POST",
      `/api/moderation/official-threads/${publicationId}/approval`,
      cookies.admin,
    )).status,
    STATUS_CODE.OK,
  );

  const after = await postsAsSeenBy(cookies.member, threadId);
  assertEquals(after[0]?.createdByUsername, FLAMINGO, "der Eröffnungsbeitrag");
  assertEquals(after[0]?.isOfficial, true);
  assertEquals(after[1]?.createdByUsername, MOD, "die Antwort bleibt beim Mod");
  assertEquals(after[1]?.isOfficial, false);

  const thread = await (await request(
    "GET",
    `/api/forum/threads/${threadId}`,
    cookies.member,
  )).text();
  assert(!thread.includes(MOD), "am Thread steht der Mod auch nicht mehr");
  assert(thread.includes(`${TITLE}-gewoehnlich`), "Überschrift unverändert");
});

Deno.test("nachträglich offiziell macht nur der Eröffner oder die Administration", async () => {
  const cookies = await fixture();
  const open = await createForumFolder("ot-offen-2b", "write");
  const { threadId } = await ordinaryThread(cookies.mod, open.id);

  // Ein anderer aus dem Team, mit demselben Absender — aber nicht der Eröffner.
  await db.updateTable("user").set({ platformRole: "moderator" })
    .where("username", "=", MEMBER).execute();
  assertEquals(
    (await makeOfficial(cookies.member, threadId)).status,
    STATUS_CODE.Forbidden,
  );

  const byAdmin = await makeOfficial(cookies.admin, threadId);
  assertEquals(byAdmin.status, STATUS_CODE.Created);
  assertEquals(
    (await byAdmin.json() as { status: string }).status,
    "released",
    "von der Administration sofort",
  );
  assertEquals(
    (await postsAsSeenBy(cookies.flamingo, threadId))[0]?.createdByUsername,
    FLAMINGO,
  );
});

/** Einem Mitglied lassen sich keine Worte als offizielle Aussage unterschieben. */
Deno.test("nachträglich offiziell nur, wenn der Eröffnungsbeitrag heute aus dem Team stammt", async () => {
  const cookies = await fixture();
  const open = await createForumFolder("ot-offen-2b", "write");
  const { threadId } = await ordinaryThread(cookies.member, open.id);

  assertEquals(
    (await makeOfficial(cookies.admin, threadId)).status,
    STATUS_CODE.Forbidden,
    "von einem Mitglied",
  );

  // Wer das Team verlassen hat: dessen alte Beiträge bleiben unter dem eigenen Namen.
  const { threadId: fromFormerMod } = await ordinaryThread(
    cookies.mod,
    open.id,
  );
  await setRole(MOD, null);
  assertEquals(
    (await makeOfficial(cookies.admin, fromFormerMod)).status,
    STATUS_CODE.Forbidden,
    "von jemandem, der nicht mehr im Team ist",
  );
});

/** Die Einreichung tauscht nur den Namen: Titel und Text lassen sich darin nicht ändern. */
Deno.test("nachträglich offiziell: Titel und Text sind in der Einreichung nicht änderbar", async () => {
  const cookies = await fixture();
  const open = await createForumFolder("ot-offen-2b", "write");
  const { threadId } = await ordinaryThread(cookies.mod, open.id);
  const { publicationId } = await (await makeOfficial(cookies.mod, threadId))
    .json() as { publicationId: string };
  const path = `/api/moderation/official-threads/${publicationId}`;

  const body = {
    title: `${TITLE}-gewoehnlich`,
    text: `${TEXT}-eroeffnung`,
    folderId: open.id,
    sendAsUserId: await getUserId(FLAMINGO),
    scheduledFor: null,
  };

  assertEquals(
    (await request("PUT", path, cookies.mod, { ...body, text: "Anders." }))
      .status,
    STATUS_CODE.Conflict,
    "anderer Text",
  );
  assertEquals(
    (await request("PUT", path, cookies.mod, { ...body, title: "Anders" }))
      .status,
    STATUS_CODE.Conflict,
    "andere Überschrift",
  );
  assertEquals(
    (await request("PUT", path, cookies.mod, body)).status,
    STATUS_CODE.OK,
    "derselbe Inhalt, anderes nicht",
  );
  assertEquals(
    (await makeOfficial(cookies.mod, threadId)).status,
    STATUS_CODE.Conflict,
    "zweimal einreichen nicht",
  );
});

/** Ein erschienener offizieller Thread und die Kennung seines Eröffnungsbeitrags. */
async function releasedOfficial(cookies: Awaited<ReturnType<typeof fixture>>) {
  const { threadId } = await submitted(cookies.admin);
  const { id: postId } = await db.selectFrom("writingPost").select("id")
    .where("writingThreadId", "=", threadId).executeTakeFirstOrThrow();
  return { threadId, postId };
}

type Revision = {
  kind: string;
  reason: string;
  editedByUsername: string | null;
  titleBefore: string | null;
  titleAfter: string | null;
  textBefore: string | null;
  textAfter: string | null;
};

async function revisions(cookie: string, threadId: string) {
  return await request(
    "GET",
    `/api/moderation/official-threads/threads/${threadId}/revisions`,
    cookie,
  );
}

async function revisionsOf(cookies: { admin: string }, threadId: string) {
  return await (await revisions(cookies.admin, threadId)).json() as Revision[];
}

/** Eine freigegebene Aussage ändert sich nicht ohne Grund, und nicht ohne Spur. */
Deno.test("einen offiziellen Beitrag ändern: nur mit Grund, Text vorher und nachher im Protokoll", async () => {
  const cookies = await fixture();
  const { threadId, postId } = await releasedOfficial(cookies);
  const path = `/api/forum/threads/${threadId}/posts/${postId}`;

  assertEquals(
    (await request("PATCH", path, cookies.admin, postBody("Ohne Grund.")))
      .status,
    STATUS_CODE.BadRequest,
    "ohne Grund",
  );
  assertEquals(
    (await request("PATCH", path, cookies.admin, {
      ...postBody("Ohne Grund."),
      reason: "   ",
    })).status,
    STATUS_CODE.BadRequest,
    "mit leerem Grund",
  );
  assertEquals((await revisionsOf(cookies, threadId)).length, 0);

  assertEquals(
    (await request("PATCH", path, cookies.admin, {
      ...postBody("Korrigiert."),
      reason: "Tippfehler im Datum",
    })).status,
    STATUS_CODE.OK,
  );

  const log = await revisionsOf(cookies, threadId);
  assertEquals(log.length, 1);
  assertEquals(log[0]?.kind, "post_edited");
  assertEquals(log[0]?.reason, "Tippfehler im Datum");
  assertEquals(log[0]?.textBefore, TEXT);
  assertEquals(log[0]?.textAfter, "Korrigiert.");
  assertEquals(log[0]?.editedByUsername, ADMIN);
});

Deno.test("die Überschrift ändert die Administration, mit Grund und im Protokoll", async () => {
  const cookies = await fixture();
  const { threadId } = await releasedOfficial(cookies);
  const path = `/api/moderation/official-threads/threads/${threadId}/title`;

  assertEquals(
    (await request("PUT", path, cookies.mod, {
      title: "Vom Mod",
      reason: "Weil",
    })).status,
    STATUS_CODE.Forbidden,
    "nicht der Mod",
  );
  assertEquals(
    (await request("PUT", path, cookies.admin, { title: "Neu" })).status,
    STATUS_CODE.BadRequest,
    "nicht ohne Grund",
  );
  assertEquals(
    (await request("PUT", path, cookies.admin, {
      title: `${TITLE}-neu`,
      reason: "Klarer",
    })).status,
    STATUS_CODE.OK,
  );

  const thread = await (await request(
    "GET",
    `/api/forum/threads/${threadId}`,
    cookies.member,
  )).json() as { title: string };
  assertEquals(thread.title, `${TITLE}-neu`);

  const log = await revisionsOf(cookies, threadId);
  assertEquals(log.length, 1);
  assertEquals(log[0]?.kind, "title_changed");
  assertEquals(log[0]?.titleBefore, TITLE);
  assertEquals(log[0]?.titleAfter, `${TITLE}-neu`);
  assertEquals(log[0]?.reason, "Klarer");
});

Deno.test("die Überschrift eines gewöhnlichen Threads ändert dieser Weg nicht", async () => {
  const cookies = await fixture();
  const open = await createForumFolder("ot-offen-2b", "write");
  const { threadId } = await ordinaryThread(cookies.mod, open.id);

  assertEquals(
    (await request(
      "PUT",
      `/api/moderation/official-threads/threads/${threadId}/title`,
      cookies.admin,
      { title: "Übernommen", reason: "Weil" },
    )).status,
    STATUS_CODE.Conflict,
  );
});

Deno.test("einen offiziellen Beitrag löschen: nur mit Grund, der gelöschte Text steht im Protokoll", async () => {
  const cookies = await fixture();
  const { threadId, postId } = await releasedOfficial(cookies);
  const path = `/api/forum/threads/${threadId}/posts/${postId}`;

  assertEquals(
    (await request("DELETE", path, cookies.admin)).status,
    STATUS_CODE.BadRequest,
    "ohne Grund",
  );
  assert(
    await db.selectFrom("writingPost").select("id").where("id", "=", postId)
      .executeTakeFirst() !== undefined,
    "noch da",
  );

  assertEquals(
    (await request(
      "DELETE",
      `${path}?reason=${encodeURIComponent("Doppelt veröffentlicht")}`,
      cookies.admin,
    )).status,
    STATUS_CODE.OK,
  );
  assertEquals(
    await db.selectFrom("writingPost").select("id").where("id", "=", postId)
      .executeTakeFirst(),
    undefined,
    "der Beitrag ist weg",
  );

  const log = await revisionsOf(cookies, threadId);
  assertEquals(log.length, 1);
  assertEquals(log[0]?.kind, "post_deleted");
  assertEquals(log[0]?.reason, "Doppelt veröffentlicht");
  assertEquals(log[0]?.textBefore, TEXT, "der Text bleibt im Protokoll");
  assertEquals(log[0]?.textAfter, null);
});

Deno.test("das Protokoll lesen nur Administrationen", async () => {
  const cookies = await fixture();
  const { threadId } = await releasedOfficial(cookies);

  for (const cookie of [cookies.mod, cookies.member, cookies.flamingo]) {
    // deno-lint-ignore no-await-in-loop -- drei, nacheinander
    const read = await revisions(cookie, threadId);
    assertEquals(read.status, STATUS_CODE.Forbidden);
  }
  assertEquals(
    (await revisions(cookies.admin, threadId)).status,
    STATUS_CODE.OK,
  );
});

/** Die Datenbank selbst lässt keinen Eintrag ohne Grund und ohne Inhalt zu. */
Deno.test("die Datenbank verlangt Grund und Inhalt im Protokoll", async () => {
  await fixture();
  let refused = 0;
  for (
    const values of [
      { kind: "title_changed", reason: " ", titleBefore: "a", titleAfter: "b" },
      { kind: "title_changed", reason: "x", titleBefore: "a" },
      { kind: "post_edited", reason: "x", textBefore: "a" },
      { kind: "post_deleted", reason: "x", textBefore: "a", textAfter: "b" },
    ] as const
  ) {
    try {
      // deno-lint-ignore no-await-in-loop -- jeder für sich
      await db.insertInto("officialRevision").values(values).execute();
    } catch {
      refused++;
    }
  }
  assertEquals(refused, 4);
});
