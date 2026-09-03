import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import {
  STRIKE_ACTION_SCHEMA,
  STRIKE_SEVERITY_SCHEMA,
  USER_SCHEMA,
} from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { StrikeService } from "@/src/service/strike_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

const USER_PARAM = z.object({ userId: USER_SCHEMA.shape.id });

/** The longest a suspension may run before it should have been a ban instead. */
const MAXIMUM_SUSPENSION_HOURS = 24 * 30;

const SUGGESTION_RESPONSE = z.object({
  priorWarnings: z.number().int(),
  priorSuspensions: z.number().int(),
  action: STRIKE_ACTION_SCHEMA,
  suggestedHours: z.number().int().nullable(),
  ladderExhausted: z.boolean(),
});

const HISTORY_ENTRY_RESPONSE = z.object({
  id: z.uuidv7(),
  severity: STRIKE_SEVERITY_SCHEMA,
  action: STRIKE_ACTION_SCHEMA,
  reason: z.string(),
  suspendedUntil: z.iso.datetime({ offset: true }).nullable(),
  issuedBy: z.object({
    id: USER_SCHEMA.shape.id,
    username: USER_SCHEMA.shape.username,
  }).nullable(),
  issuedAt: z.iso.datetime({ offset: true }),
});

// Same bound as a ban's note, for the same reason: one incident, not an essay.
const REASON = notBlank(z.string().min(1).max(TEXT_LIMIT.banReason));

const ISSUE_WARNING_BODY = z.object({
  severity: STRIKE_SEVERITY_SCHEMA,
  reason: REASON,
});

const ISSUE_SUSPENSION_BODY = z.object({
  severity: STRIKE_SEVERITY_SCHEMA,
  reason: REASON,
  hours: z.number().int().min(1).max(MAXIMUM_SUSPENSION_HOURS),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_OPERATOR_RESPONSE = {
  description: "Not an operator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

/** For the routes that act on the account, which can also refuse for what the target is. */
const ACTING_REFUSALS = {
  [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
  [STATUS_CODE.Forbidden]: {
    description:
      "Not an operator, or the target holds a platform role and cannot be given a strike",
    content: jsonContent(ERROR_RESPONSE),
  },
  [STATUS_CODE.NotFound]: {
    description: "No such account",
    content: jsonContent(ERROR_RESPONSE),
  },
} as const;

const LADDER_STANDING_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  warnings: z.number().int(),
  suspensions: z.number().int(),
  /** Set only while a suspension is still running, so the interface can say „aktuell gesperrt". */
  suspendedUntil: z.iso.datetime({ offset: true }).nullable(),
  suspensionReason: z.string().nullable(),
  bannedAt: z.iso.datetime({ offset: true }).nullable(),
  lastStrikeAt: z.iso.datetime({ offset: true }),
  /** The note from the watchlist, where the member is also on it. */
  watchlistNote: z.string().nullable(),
});

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/strike-ladder",
      tags: [MODERATION_TAG],
      summary: "Everyone with at least one strike, worst first",
      description:
        "The overview the three-strikes area is grouped by. A member with a clean record is absent rather than listed with zeroes: the page is the ladder, and a whole membership under that heading would read as an accusation of everybody. `warnings` and `suspensions` are counts rather than a rung token — which section somebody is filed under is a question the interface answers, in German.",
      operationId: "listStrikeLadder",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everyone on the ladder",
          content: jsonContent(z.array(LADDER_STANDING_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await StrikeService.listLadder(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/{userId}/strikes/suggestion",
      tags: [MODERATION_TAG],
      summary: "Suggest the next step on the three-strikes ladder",
      description:
        "Counts what was decided before and names the next rung: two warnings, then 24, 48 and 72 hours. A suggestion only — how heavily a violation weighs is a human decision, and any action may be taken regardless of what this returns, including skipping the ladder entirely.",
      operationId: "suggestNextStrikeAction",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: USER_PARAM },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The suggested next step",
          content: jsonContent(SUGGESTION_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      return c.json(
        await StrikeService.suggestNextAction(userId),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/{userId}/strikes",
      tags: [MODERATION_TAG],
      summary: "List a member's warnings and suspensions",
      operationId: "listStrikeHistory",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: USER_PARAM },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everything decided about this account, newest first",
          content: jsonContent(z.array(HISTORY_ENTRY_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      return c.json(await StrikeService.listHistory(userId), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/{userId}/strikes/warning",
      tags: [MODERATION_TAG],
      summary: "Record a warning",
      description:
        "Recorded, not enforced: a warning changes nothing about the account. It is what the next decision counts.",
      operationId: "issueWarning",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: USER_PARAM,
        body: { required: true, content: jsonContent(ISSUE_WARNING_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The warning was recorded",
          content: jsonContent(OK_RESPONSE),
        },
        ...ACTING_REFUSALS,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      const { severity, reason } = c.req.valid("json");

      const refusal = await StrikeService.issueWarning(
        userId,
        severity,
        reason,
        c.get("user").id,
      );

      switch (refusal) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "is_an_operator":
          return c.json(
            { error: "An operator cannot be given a strike" },
            STATUS_CODE.Forbidden,
          );
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/{userId}/strikes/suspension",
      tags: [MODERATION_TAG],
      summary: "Suspend an account for a fixed number of hours",
      description:
        "Ends every session and refuses the account until the moment it names, then lapses on its own with no cleanup. Deliberately not a ban: this one tells the member when it ends and why, because it is meant to correct.",
      operationId: "issueSuspension",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: USER_PARAM,
        body: { required: true, content: jsonContent(ISSUE_SUSPENSION_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The suspension is in force",
          content: jsonContent(
            z.object({ suspendedUntil: z.iso.datetime({ offset: true }) }),
          ),
        },
        ...ACTING_REFUSALS,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");
      const { severity, reason, hours } = c.req.valid("json");

      const outcome = await StrikeService.issueSuspension(
        userId,
        severity,
        reason,
        hours,
        c.get("user").id,
      );

      switch (outcome) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "is_an_operator":
          return c.json(
            { error: "An operator cannot be suspended" },
            STATUS_CODE.Forbidden,
          );
        default:
          return c.json(outcome, STATUS_CODE.OK);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/{userId}/strikes/suspension",
      tags: [MODERATION_TAG],
      summary: "Lift a suspension before it lapses",
      description:
        "Restores access now. The history keeps the entry that imposed it: what was decided happened, whatever was decided afterwards.",
      operationId: "liftSuspension",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: USER_PARAM },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The suspension is lifted",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such account, or it is not suspended",
          content: jsonContent(ERROR_RESPONSE),
        },
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const { userId } = c.req.valid("param");

      if (await StrikeService.liftSuspension(userId) === "not_found") {
        return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
      }

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  );
