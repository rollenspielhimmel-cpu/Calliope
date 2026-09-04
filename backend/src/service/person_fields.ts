/**
 * Which fields in a response name a person, and how to blank them.
 *
 * One definition, used by everything that has to hide an author: the middleware in front of
 * `/groups/:groupId`, the search, and the test that reads `open-api.json` and asks whether every
 * field of this shape is accounted for. Three places agreeing by accident is how the last gap
 * happened; they agree by construction now.
 */

/**
 * The convention this codebase follows: an id `xBy` travels beside an `xByUsername`, and a row
 * that *is* about somebody names them in the bare `userId` / `username` pair.
 *
 * Listed rather than derived from the field name. A rule clever enough to spot `createdBy` would
 * also have to leave `writingGroupId` and `folderId` alone, and the failure mode of getting that
 * wrong is silent in both directions — an unmasked author, or a blanked field the interface needs.
 * The list is short, and the derived test is what notices a seventh entry arriving.
 */
export const PERSON_FIELDS: ReadonlyArray<
  { id: string; username: string; avatar?: string }
> = [
  { id: "createdBy", username: "createdByUsername" },
  { id: "editedBy", username: "editedByUsername" },
  { id: "updatedBy", username: "updatedByUsername" },
  { id: "invitedBy", username: "invitedByUsername" },
  { id: "actorId", username: "actorUsername" },
  { id: "userId", username: "username", avatar: "avatarUrl" },
];

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** What a masked author looks like: a label, and no picture to recognise them by. */
export type Label = (userId: string | null) => { username: string };

/**
 * Replaces every person this reader is not, in place, however deep it sits.
 *
 * **The reader's own id survives.** Every check the interface makes with it asks „is this mine" —
 * may I edit, may I delete, is the report button for me — and answering that about oneself
 * discloses nothing. Everybody else's becomes `null`, which each of these fields is already
 * allowed to be, so this is a value the client was built to handle rather than a hole in the shape.
 *
 * In place, on a body that was just parsed and belongs to nobody else.
 */
export function maskPersonFields(
  value: Json,
  readerId: string,
  label: Label,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      maskPersonFields(entry, readerId, label);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const field of PERSON_FIELDS) {
    const id = value[field.id];

    if (typeof id !== "string") {
      continue;
    }

    // **The name goes for everybody, the reader included.** Inside a Blind-Date the reader is
    // „Blind-Date-Partner 1" to themselves as well: seeing one real name and one pseudonym side
    // by side would say which of the two labels is the other person. A test caught this — the
    // reader's own username reached the search in the clear while everything else was masked.
    //
    // The name first: once the id is gone there is nothing left to look the label up by.
    if (field.username in value) {
      value[field.username] = label(id).username;
    }

    if (field.avatar !== undefined && field.avatar in value) {
      value[field.avatar] = null;
    }

    // **The id, however, only for other people.** Every check the interface makes with it asks
    // „is this mine" — may I edit, may I delete, is the report button for me — and answering
    // that about oneself discloses nothing.
    if (id !== readerId) {
      value[field.id] = null;
    }
  }

  for (const entry of Object.values(value)) {
    maskPersonFields(entry, readerId, label);
  }
}
