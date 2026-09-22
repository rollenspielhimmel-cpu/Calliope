import { assert, assertEquals } from "@std/assert";
import { STATUS_CODE } from "@std/http/status";
import { db } from "@/src/database/client.ts";
import {
  clearRateLimits,
  createGroup,
  deleteUsers,
  getUserId,
  postBody,
  registerUser,
  request,
} from "@/src/test/support.ts";
import {
  clearForum,
  createForumPost,
  createForumThread,
} from "@/src/test/forum.ts";

/**
 * **Gehört das Kind zum Elternteil aus der Adresse?** — für jede Adresse mit zwei Kennungen.
 *
 * Bis September 2026 lasen die drei Routen für einzelne Gruppenbeiträge den Beitrag nur über den
 * Thread. Wer Mitglied irgendeiner Gruppe war, las, änderte und löschte damit fremde Beiträge,
 * indem er die eigene Gruppe in die Adresse schrieb. Seitdem prüft `belongs_to_parent.ts` das vor
 * jedem Teilbaum.
 *
 * Diese Datei hält zweierlei fest:
 *
 * 1. **Das Inventar.** Jede Adresse mit zwei oder mehr Kennungen in `open-api.json` ist entweder
 *    durch ein solches Mittelstück gedeckt oder hier mit Grund ausgenommen. Eine neue, die keines
 *    von beidem ist, lässt den Lauf scheitern — wie `person_field_inventory_test.ts`.
 * 2. **Die Probe.** Jede gedeckte Adresse, jede Methode, wird mit fremden Kennungen über die eigene
 *    Gruppe aufgerufen und muss 404 antworten; danach ist an den fremden Daten nichts geändert.
 *    Nicht die erwarteten Routen werden probiert, sondern alle, die die Beschreibung kennt.
 */

/** Adressen, vor deren Teilbaum ein `belongsToParent` hängt. */
const COVERED: ReadonlyArray<{ pattern: RegExp; guard: string }> = [
  {
    pattern: /^\/api\/groups\/\{groupId\}\/threads\/\{threadId\}(\/|$)/,
    guard: "threadBelongsToGroup (+ postBelongsToThread darunter)",
  },
  {
    pattern: /^\/api\/groups\/\{groupId\}\/folders\/\{folderId\}(\/|$)/,
    guard: "folderBelongsToGroup",
  },
  {
    pattern: /^\/api\/groups\/\{groupId\}\/pages\/\{pageId\}(\/|$)/,
    guard: "pageBelongsToGroup",
  },
  {
    pattern: /^\/api\/groups\/\{groupId\}\/steps\/\{stepId\}(\/|$)/,
    guard: "stepBelongsToGroup",
  },
  {
    pattern: /^\/api\/forum\/threads\/\{threadId\}\/posts\/\{postId\}(\/|$)/,
    guard: "postBelongsToThread",
  },
];

/** Adressen mit zwei Kennungen, die keine Eltern-Kind-Beziehung sind — mit Grund. */
const EXEMPT: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: "/api/groups/{groupId}/memberships/{userId}",
    reason:
      "Kein Kind: eine Mitgliedschaft ist das Paar (Gruppe, Konto), und der Dienst liest und schreibt sie nur über beide.",
  },
  {
    path: "/api/favourites/{targetType}/{targetId}",
    reason:
      "Art und Kennung, kein Elternteil: `resolveVisibleTarget` sucht die Kennung in der Tabelle der Art und prüft die Sichtbarkeit.",
  },
  {
    path: "/api/forum/permissions/{targetType}/{targetId}",
    reason:
      "Art und Kennung: `ForumService.setPermission` schreibt nur Zeilen mit `writing_group_id IS NULL`.",
  },
  {
    path: "/api/moderation/role-permissions/{role}/{permission}",
    reason: "Zwei Aufzählungswerte, keine Datensätze.",
  },
  {
    path: "/api/moderation/broadcast/senders/{senderId}/roles/{role}",
    reason:
      "Ein Absender und eine Rolle; der Dienst prüft, dass es den Absender gibt.",
  },
  {
    path: "/api/moderation/broadcast/senders/{senderId}/people/{userId}",
    reason:
      "Zwei eigenständige Konten, kein Elternteil; der Dienst prüft beide.",
  },
];

async function pathsWithTwoIds(): Promise<
  Array<{ path: string; methods: string[] }>
> {
  const spec = JSON.parse(
    await Deno.readTextFile(new URL("../../open-api.json", import.meta.url)),
  ) as { paths: Record<string, Record<string, unknown>> };

  return Object.entries(spec.paths)
    .filter(([path]) => (path.match(/\{[^}]+\}/g) ?? []).length >= 2)
    .map(([path, operations]) => ({
      path,
      methods: Object.keys(operations)
        .filter((key) => key !== "parameters")
        .map((method) => method.toUpperCase()),
    }));
}

Deno.test("jede Adresse mit zwei Kennungen ist gedeckt oder begründet ausgenommen", async () => {
  const undecided = (await pathsWithTwoIds())
    .map(({ path }) => path)
    .filter((path) =>
      !COVERED.some(({ pattern }) => pattern.test(path)) &&
      !EXEMPT.some((exempt) => exempt.path === path)
    );

  assertEquals(
    undecided,
    [],
    "Diese Adressen nennen zwei Kennungen und sind weder durch `belongs_to_parent.ts` gedeckt noch hier begründet ausgenommen.",
  );
});

// ── Die Probe ───────────────────────────────────────────────────────────────────────────────

const OUTSIDER = "scope-outsider";
const VICTIM = "scope-victim";
const SECRET = "Privater Text der fremden Gruppe";

Deno.test.beforeEach(clearRateLimits);
Deno.test.afterEach(async () => {
  await clearForum([OUTSIDER, VICTIM]);
  await deleteUsers([OUTSIDER, VICTIM]);
});

/** Zwei Gruppen: die eigene und eine fremde mit allem, was eine Adresse als Kind nennen kann. */
async function twoGroups() {
  const victim = await registerUser(VICTIM);
  const foreign = await createGroup(victim, "Fremde Gruppe");
  const base = `/api/groups/${foreign.id}`;

  const json = async (response: Response) => {
    assert(response.ok, `${response.status} ${await response.clone().text()}`);
    return await response.json();
  };

  const thread = await json(
    await request("POST", `${base}/threads`, victim, { title: "Geheim" }),
  );
  const post = await json(
    await request(
      "POST",
      `${base}/threads/${thread.id}/posts`,
      victim,
      postBody(SECRET),
    ),
  );
  const folder = await json(
    await request("POST", `${base}/folders`, victim, { title: "Ordner" }),
  );
  const page = await json(
    await request("POST", `${base}/pages`, victim, {
      title: "Seite",
      document: postBody(SECRET).document,
    }),
  );
  const step = await json(
    await request("POST", `${base}/steps`, victim, {
      text: "Nächster Schritt",
    }),
  );

  const outsider = await registerUser(OUTSIDER);
  const own = await createGroup(outsider, "Eigene Gruppe");
  const ownThread = await json(
    await request("POST", `/api/groups/${own.id}/threads`, outsider, {
      title: "Eigener Thread",
    }),
  );

  // Das Forum: ein Beitrag in Thread Y, angesprochen über Thread X.
  const forumX = await createForumThread("Forum X");
  const forumY = await createForumThread("Forum Y");
  const forumPost = await createForumPost(
    forumY.id,
    SECRET,
    await getUserId(VICTIM),
  );

  return {
    outsider,
    ids: {
      ownGroup: own.id,
      ownThread: ownThread.id,
      thread: thread.id,
      post: post.id,
      folder: folder.id,
      page: page.id,
      step: step.id,
      forumX: forumX.id,
      forumPost: forumPost.id,
    },
  };
}

type Ids = Awaited<ReturnType<typeof twoGroups>>["ids"];

/** Die Adresse mit fremden Kindern — und, wo ein Beitrag vorkommt, auch mit eigenem Thread. */
function attacks(path: string, ids: Ids): string[] {
  if (path.startsWith("/api/forum/")) {
    return [
      path.replace("{threadId}", ids.forumX).replace("{postId}", ids.forumPost),
    ];
  }

  const fill = (threadId: string) =>
    path
      .replace("{groupId}", ids.ownGroup)
      .replace("{threadId}", threadId)
      .replace("{postId}", ids.post)
      .replace("{folderId}", ids.folder)
      .replace("{pageId}", ids.page)
      .replace("{stepId}", ids.step);

  // Der eigene Thread mit dem fremden Beitrag prüft `postBelongsToThread` für sich allein; der
  // fremde Thread wird schon eine Ebene höher abgewiesen.
  return path.includes("{postId}")
    ? [fill(ids.thread), fill(ids.ownThread)]
    : [fill(ids.thread)];
}

Deno.test("jede gedeckte Adresse weist fremde Kinder mit 404 ab, für jede Methode", async () => {
  const { outsider, ids } = await twoGroups();
  const covered = (await pathsWithTwoIds()).filter(({ path }) =>
    COVERED.some(({ pattern }) => pattern.test(path))
  );
  assert(covered.length > 0, "die Beschreibung nennt keine gedeckte Adresse");

  const leaks: string[] = [];
  let probes = 0;

  for (const { path, methods } of covered) {
    for (const url of attacks(path, ids)) {
      for (const method of methods) {
        probes++;
        // deno-lint-ignore no-await-in-loop -- nacheinander: ein Löschen darf das nächste nicht vorwegnehmen
        const response = await request(
          method,
          url,
          outsider,
          method === "GET" ? undefined : {},
        );
        // deno-lint-ignore no-await-in-loop -- dasselbe
        const body = await response.text();
        if (response.status !== STATUS_CODE.NotFound || body.includes(SECRET)) {
          leaks.push(`${method} ${path} → ${response.status}`);
        }
      }
    }
  }

  assertEquals(leaks, [], "Diese Anfragen kamen an fremde Kinder heran.");
  assert(probes >= 20, `nur ${probes} Anfragen — wurde überhaupt probiert?`);

  // Und nichts ist geändert: Die fremden Daten stehen, wie sie waren.
  const post = await db.selectFrom("writingPost").select("text")
    .where("id", "=", ids.post).executeTakeFirst();
  assertEquals(post?.text, SECRET, "der fremde Beitrag ist unverändert da");
  const forumPost = await db.selectFrom("writingPost").select("text")
    .where("id", "=", ids.forumPost).executeTakeFirst();
  assertEquals(forumPost?.text, SECRET, "der Forumsbeitrag ist unverändert da");
  for (
    const [table, id] of [
      ["writingThread", ids.thread],
      ["writingFolder", ids.folder],
      ["writingPage", ids.page],
      ["writingGroupNextStep", ids.step],
    ] as const
  ) {
    // deno-lint-ignore no-await-in-loop -- vier Tabellen, nacheinander
    const row = await db.selectFrom(table).select("id").where("id", "=", id)
      .executeTakeFirst();
    assert(row !== undefined, `${table} ist noch da`);
  }
});

/** Die Gegenrichtung: Im eigenen Zusammenhang geht alles weiter wie vorher. */
Deno.test("das Eigene erreicht man weiter", async () => {
  const { outsider, ids } = await twoGroups();

  const created = await request(
    "POST",
    `/api/groups/${ids.ownGroup}/threads/${ids.ownThread}/posts`,
    outsider,
    postBody("Eigener Beitrag"),
  );
  assertEquals(created.status, STATUS_CODE.Created);
  const { id } = await created.json();

  assertEquals(
    (await request(
      "GET",
      `/api/groups/${ids.ownGroup}/threads/${ids.ownThread}/posts/${id}`,
      outsider,
    )).status,
    STATUS_CODE.OK,
  );
});
