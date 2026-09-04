/**
 * Every response that can name a person, and what was decided about each.
 *
 * **This file exists because a checklist written from memory misses things.** A group's pages
 * arrived from upstream, returned both Blind-Date partners' real usernames, and nothing noticed —
 * least of all the leak test, which asked only about the endpoints somebody had thought to list in
 * it. The entries below are not written by hand either: `person_field_inventory_test.ts` derives
 * them from `open-api.json`, which is generated from the routes themselves, and fails when the two
 * disagree.
 *
 * So a new endpoint returning `createdBy` cannot arrive quietly. The test names it, the run stops,
 * and somebody writes down which reason applies. **That decision is the point.** Masking is not
 * always the right answer — a status update names its author on purpose — and „public, deliberately"
 * is worth being able to read back three months later.
 *
 * **After adding or changing a route:** run `deno task person-fields:inventory`. It prints the
 * inventory as it now stands; paste it in and give anything new a reason. Do not paste without
 * reading it — the reading is the whole mechanism.
 */

/**
 * Why a response may carry a person field.
 *
 * `masked-by-middleware` — under `/groups/{groupId}`, where `mask_pseudonymous_group.ts` blanks
 * every person field on the way out. Nothing for the route's author to do, which is the point of
 * putting it there.
 *
 * `masked-by-service` — the group list and creation, which sit beside that subtree rather than
 * inside it. `writing_group_service.ts` masks them.
 *
 * `masked-by-handler` — search, the one place that reads group content from outside the subtree.
 * The middleware cannot see it, so it masks for itself.
 *
 * `not-group-content` — chats, story ideas, status updates, the forum. None of them has a
 * pseudonymous mode: what is written there is written under one's own name and read under it.
 *
 * `moderation-only` — behind `authorizedAsModerator`. Moderation has to see who did what, a
 * Blind-Date included; that is the work, not a leak.
 */
export type Reason =
  | "masked-by-middleware"
  | "masked-by-service"
  | "masked-by-handler"
  | "not-group-content"
  | "moderation-only";

export type InventoryEntry = {
  /** `METHOD /path`, exactly as `open-api.json` spells it. */
  route: string;
  /** The person fields this response can carry, sorted. */
  fields: readonly string[];
  reason: Reason;
};

export const PERSON_FIELD_INVENTORY: readonly InventoryEntry[] = [
  {
    route: "GET /api/groups/{groupId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/folders",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/memberships",
    fields: ["invitedBy", "userId"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/pages",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/pages/{pageId}",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/steps",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/threads",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/threads/{threadId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/groups/{groupId}/threads/{threadId}/posts/{postId}",
    fields: ["createdBy", "editedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "GET /api/moderation/invitations/pending",
    fields: ["invitedBy"],
    reason: "moderation-only",
  },
  {
    route: "GET /api/status-updates/{statusUpdateId}/comments",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "GET /api/story-ideas/{ideaId}",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "PATCH /api/groups/{groupId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PATCH /api/groups/{groupId}/memberships/{userId}",
    fields: ["invitedBy", "userId"],
    reason: "masked-by-middleware",
  },
  {
    route: "PATCH /api/groups/{groupId}/steps/{stepId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PATCH /api/groups/{groupId}/threads/{threadId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PATCH /api/groups/{groupId}/threads/{threadId}/posts/{postId}",
    fields: ["createdBy", "editedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PATCH /api/story-ideas/{ideaId}",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/chats",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/chats/{chatId}/memberships",
    fields: ["userId"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/chats/{chatId}/memberships/me/accept",
    fields: ["userId"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/chats/{chatId}/messages",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/groups",
    fields: ["createdBy"],
    reason: "masked-by-service",
  },
  {
    route: "POST /api/groups/{groupId}/conversations",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/folders",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/memberships",
    fields: ["invitedBy", "userId"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/memberships/me/accept",
    fields: ["invitedBy", "userId"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/pages",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/steps",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/threads",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/groups/{groupId}/threads/{threadId}/posts",
    fields: ["createdBy", "editedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "POST /api/status-updates",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/status-updates/{statusUpdateId}/comments",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/story-ideas",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "POST /api/story-ideas/{ideaId}/conversations",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "PUT /api/groups/{groupId}/folders/{folderId}",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PUT /api/groups/{groupId}/folders/{folderId}/parent",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PUT /api/groups/{groupId}/pages/{pageId}",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PUT /api/groups/{groupId}/pages/{pageId}/folder",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "PUT /api/groups/{groupId}/threads/{threadId}/folder",
    fields: ["createdBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "QUERY /api/chats",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/chats/{chatId}/memberships",
    fields: ["userId"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/chats/{chatId}/messages",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/forum/threads/{threadId}/posts",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/groups",
    fields: ["createdBy"],
    reason: "masked-by-service",
  },
  {
    route: "QUERY /api/groups/{groupId}/threads/{threadId}/posts",
    fields: ["createdBy", "editedBy"],
    reason: "masked-by-middleware",
  },
  {
    route: "QUERY /api/search",
    fields: ["createdBy", "updatedBy"],
    reason: "masked-by-handler",
  },
  {
    route: "QUERY /api/status-updates",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/story-ideas",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
  {
    route: "QUERY /api/story-ideas/carousel",
    fields: ["createdBy"],
    reason: "not-group-content",
  },
];
