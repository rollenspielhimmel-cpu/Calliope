import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "@/src/database/client.ts";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsAdministrator } from "@/src/middleware/authorized_as_platform_role.ts";
import { AdminInboxFolderService } from "@/src/service/admin_inbox_folder_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Ordner im Postfach der Administration — zum Aufbewahren, unabhängig von offen und erledigt. Was
 * sie sind und warum sie so geschnitten sind, steht in `admin_inbox_folder_service.ts`.
 *
 * **Nur die Administration**, wie das Postfach selbst: Was darin liegt, ist an sie geschrieben.
 */

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_ADMINISTRATOR_RESPONSE = {
  description: "Not an administrator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SUCH_FOLDER = "Diesen Ordner gibt es nicht.";

const TITLE_TAKEN = "Einen Ordner mit diesem Namen gibt es schon.";

const TITLE = notBlank(z.string().min(1).max(TEXT_LIMIT.inboxFolderTitle));

const FOLDER = z.object({
  id: z.uuidv7(),
  title: z.string(),
  conversationCount: z.number().int(),
  messageCount: z.number().int(),
});

const ITEM_COMMON = {
  id: z.uuidv7(),
  chatGroupId: z.uuidv7(),
  username: z.string().nullable(),
  senderUsername: z.string().nullable(),
  addedByUsername: z.string().nullable(),
  addedAt: z.iso.datetime({ offset: true }),
};

const ITEM = z.discriminatedUnion("kind", [
  z.object({ ...ITEM_COMMON, kind: z.literal("conversation") }),
  z.object({
    ...ITEM_COMMON,
    kind: z.literal("message"),
    message: z.object({
      id: z.uuidv7(),
      text: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
      authorUsername: z.string().nullable(),
      fromTeam: z.boolean(),
    }),
  }),
]);

const FOLDER_PARAMS = z.object({ folderId: z.uuidv7() });

const OK = z.object({ ok: z.literal(true) });

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/inbox/folders",
      tags: [MODERATION_TAG],
      summary: "The inbox folders, in their order",
      description:
        "One order for every administrator. Counts say what lies in each: whole conversations and single messages.",
      operationId: "listAdminInboxFolders",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The folders",
          content: jsonContent(z.array(FOLDER)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await AdminInboxFolderService.listFolders(), STATUS_CODE.OK),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/inbox/folders",
      tags: [MODERATION_TAG],
      summary: "Create an inbox folder",
      description: "Added at the bottom. Two folders may not share a name.",
      operationId: "createAdminInboxFolder",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: {
          required: true,
          content: jsonContent(z.object({ title: TITLE })),
        },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "Created",
          content: jsonContent(z.object({ id: z.uuidv7() })),
        },
        [STATUS_CODE.Conflict]: {
          description: "A folder with this name exists",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const outcome = await AdminInboxFolderService.createFolder(
        c.req.valid("json").title,
        c.get("user"),
      );

      if (typeof outcome !== "string") {
        return c.json({ id: outcome.id }, STATUS_CODE.Created);
      }
      return c.json({ error: TITLE_TAKEN }, STATUS_CODE.Conflict);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/inbox/folders/order",
      tags: [MODERATION_TAG],
      summary: "Set the order of the inbox folders",
      description:
        "The whole order as the administrator sees it. If a folder was created or deleted meanwhile, it no longer matches and is refused rather than guessed at.",
      operationId: "reorderAdminInboxFolders",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        body: {
          required: true,
          content: jsonContent(
            z.object({ folderIds: z.array(z.uuidv7()).max(500) }),
          ),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Reordered",
          content: jsonContent(OK),
        },
        [STATUS_CODE.Conflict]: {
          description: "The list does not match the folders there are",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      await AdminInboxFolderService.reorderFolders(
          c.req.valid("json").folderIds,
        ) === undefined
        ? c.json({ ok: true as const }, STATUS_CODE.OK)
        : c.json(
          {
            error:
              "Die Ordner haben sich inzwischen geändert. Lade die Seite neu und verschieb noch einmal.",
          },
          STATUS_CODE.Conflict,
        ),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/inbox/folders/{folderId}",
      tags: [MODERATION_TAG],
      summary: "Rename an inbox folder",
      operationId: "renameAdminInboxFolder",
      description: "Two folders may not share a name.",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: FOLDER_PARAMS,
        body: {
          required: true,
          content: jsonContent(z.object({ title: TITLE })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Renamed",
          content: jsonContent(OK),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such folder",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "A folder with this name exists",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await AdminInboxFolderService.renameFolder(
        c.req.valid("param").folderId,
        c.req.valid("json").title,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true as const }, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: NO_SUCH_FOLDER }, STATUS_CODE.NotFound);
        case "title_taken":
          return c.json({ error: TITLE_TAKEN }, STATUS_CODE.Conflict);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/inbox/folders/{folderId}",
      tags: [MODERATION_TAG],
      summary: "Delete an inbox folder",
      description:
        "Takes away the sorting, nothing else: the conversations and messages in it stay in the inbox.",
      operationId: "deleteAdminInboxFolder",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: FOLDER_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Deleted",
          content: jsonContent(OK),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such folder",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      await db.transaction().execute((transaction) =>
          AdminInboxFolderService.deleteFolder(
            transaction,
            c.req.valid("param").folderId,
          )
        ) === undefined
        ? c.json({ ok: true as const }, STATUS_CODE.OK)
        : c.json({ error: NO_SUCH_FOLDER }, STATUS_CODE.NotFound),
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/inbox/folders/{folderId}/items",
      tags: [MODERATION_TAG],
      summary: "What lies in an inbox folder",
      description:
        "Whole conversations and single messages, the most recently added first. Each names the conversation it belongs to.",
      operationId: "listAdminInboxFolderItems",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: FOLDER_PARAMS },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The contents",
          content: jsonContent(z.array(ITEM)),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such folder",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const items = await AdminInboxFolderService.listItems(
        c.req.valid("param").folderId,
      );
      return items === undefined
        ? c.json({ error: NO_SUCH_FOLDER }, STATUS_CODE.NotFound)
        : c.json(items, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/inbox/folders/{folderId}/items",
      tags: [MODERATION_TAG],
      summary: "Put a conversation or a single message into an inbox folder",
      description:
        "Only what lies in the inbox: without that check this would pull a private chat between two members into a folder of the administration.",
      operationId: "addToAdminInboxFolder",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: {
        params: FOLDER_PARAMS,
        body: {
          required: true,
          content: jsonContent(
            z.union([
              z.object({ chatGroupId: z.uuidv7() }).strict(),
              z.object({ chatMessageId: z.uuidv7() }).strict(),
            ]),
          ),
        },
      },
      responses: {
        [STATUS_CODE.Created]: {
          description: "Put in",
          content: jsonContent(z.object({ id: z.uuidv7() })),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such folder, or nothing like it in the inbox",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Already in this folder",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const outcome = await AdminInboxFolderService.addItem(
        c.req.valid("param").folderId,
        c.req.valid("json"),
        c.get("user"),
      );

      if (typeof outcome !== "string") {
        return c.json({ id: outcome.id }, STATUS_CODE.Created);
      }

      switch (outcome) {
        case "folder_not_found":
          return c.json({ error: NO_SUCH_FOLDER }, STATUS_CODE.NotFound);
        case "not_in_the_inbox":
          return c.json(
            { error: "Das liegt nicht im Postfach." },
            STATUS_CODE.NotFound,
          );
        case "already_there":
          return c.json(
            { error: "Das liegt schon in diesem Ordner." },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(outcome);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/inbox/folder-items/{itemId}",
      tags: [MODERATION_TAG],
      summary: "Take something out of an inbox folder",
      description:
        "Only the sorting goes; the conversation or message stays in the inbox.",
      operationId: "removeFromAdminInboxFolder",
      middleware: [authenticated, authorizedAsAdministrator] as const,
      request: { params: z.object({ itemId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Taken out",
          content: jsonContent(OK),
        },
        [STATUS_CODE.NotFound]: {
          description: "Not in a folder",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_ADMINISTRATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) =>
      await db.transaction().execute((transaction) =>
          AdminInboxFolderService.removeItem(
            transaction,
            c.req.valid("param").itemId,
          )
        ) ===
          undefined
        ? c.json({ ok: true as const }, STATUS_CODE.OK)
        : c.json(
          { error: "Das liegt in keinem Ordner." },
          STATUS_CODE.NotFound,
        ),
  );
