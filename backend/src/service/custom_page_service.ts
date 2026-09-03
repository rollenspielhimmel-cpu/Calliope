import { db } from "@/src/database/client.ts";

/**
 * Fixed text pages the operators write themselves — the rules, an FAQ. Markdown rather than a
 * rich-text document: nothing else in this product takes formatted input, and storing whatever
 * an editor produced would commit the project to that editor.
 */

export type CustomPage = {
  slug: string;
  title: string;
  body: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  lastEditedBy: { id: string; username: string } | null;
};

/** Without the body: a list of pages is read to pick one, not to read them all. */
export type CustomPageSummary = Omit<CustomPage, "body">;

async function listPages(): Promise<CustomPageSummary[]> {
  const rows = await db
    .selectFrom("customPage")
    .leftJoin("user", "user.id", "customPage.lastEditedBy")
    .select([
      "customPage.slug",
      "customPage.title",
      "customPage.isPublic",
      "customPage.createdAt",
      "customPage.updatedAt",
      "user.id as editorId",
      "user.username as editorUsername",
    ])
    .orderBy("customPage.title", "asc")
    .execute();

  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEditedBy: row.editorId === null || row.editorUsername === null
      ? null
      : { id: row.editorId, username: row.editorUsername },
  }));
}

async function selectPage(slug: string): Promise<CustomPage | undefined> {
  const row = await db
    .selectFrom("customPage")
    .leftJoin("user", "user.id", "customPage.lastEditedBy")
    .select([
      "customPage.slug",
      "customPage.title",
      "customPage.body",
      "customPage.isPublic",
      "customPage.createdAt",
      "customPage.updatedAt",
      "user.id as editorId",
      "user.username as editorUsername",
    ])
    .where("customPage.slug", "=", slug)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return {
    slug: row.slug,
    title: row.title,
    body: row.body,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastEditedBy: row.editorId === null || row.editorUsername === null
      ? null
      : { id: row.editorId, username: row.editorUsername },
  };
}

/**
 * One call for creating and for editing: the slug is the identity, so writing to one that does
 * not exist yet is how a page is made. `updatedAt` is set here rather than by a trigger, because
 * no other table in this schema has one and adding the first would be a convention change.
 */
async function upsertPage(
  page: {
    slug: string;
    title: string;
    body: string;
    isPublic: boolean;
  },
  editedBy: string,
): Promise<void> {
  const now = Temporal.Now.instant().toString();

  await db
    .insertInto("customPage")
    .values({ ...page, lastEditedBy: editedBy, updatedAt: now })
    .onConflict((conflict) =>
      conflict.column("slug").doUpdateSet({
        title: page.title,
        body: page.body,
        isPublic: page.isPublic,
        lastEditedBy: editedBy,
        updatedAt: now,
      })
    )
    .execute();
}

async function deletePage(slug: string): Promise<"not_found" | undefined> {
  const deleted = await db
    .deleteFrom("customPage")
    .where("slug", "=", slug)
    .returning("slug")
    .executeTakeFirst();

  return deleted === undefined ? "not_found" : undefined;
}

export const CustomPageService = {
  listPages,
  selectPage,
  upsertPage,
  deletePage,
};
