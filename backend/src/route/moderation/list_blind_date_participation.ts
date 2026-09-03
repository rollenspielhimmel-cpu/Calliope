import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { listQuery } from "@/src/list/list_endpoint_query.ts";
import {
  listQuerySchema,
  listResponseSchema,
} from "@/src/list/list_endpoint.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BlindDateMatchingService } from "@/src/service/blind_date_matching_service.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";

/**
 * Who has taken part in how many Blind-Dates, and how those went.
 *
 * A file of its own rather than another route on the Blind-Date desk beside it: two `query` routes
 * on one `OpenAPIHono` leave the second one's body typed as `Record<string, unknown>`, which is a
 * silent failure rather than a loud one.
 *
 * **Operators only, and it stays that way.** These are three numbers per member with the members'
 * names beside them, ordered — a ranking, which is the one shape the design system rules out for
 * anything a member can see. Behind the gate they answer a question casework needs: whether a run
 * of endings is a pattern or a few rounds that did not work out.
 *
 * A Blind-Date ends for all sorts of ordinary reasons — no time, no spark, a life that moved on —
 * which is why the table keeps what somebody ended themselves apart from what ended around them.
 * The distinction is the whole point of reading it.
 */

const PARTICIPATION_RESPONSE = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
  /** Seen through to the reveal. */
  revealed: z.number().int(),
  /** Ended without a reveal, whatever the reason. */
  ended: z.number().int(),
  /**
   * Of those, the ones this member ended themselves. The rest were ended by the other person or
   * by the name guard — being left is not the same as leaving, and the table would say the wrong
   * thing about somebody without this.
   */
  endedByThem: z.number().int(),
  /** Neither yet. At most one, but counted rather than assumed. */
  running: z.number().int(),
  /**
   * Why the ended ones ended, each reason once. Empty where nothing ended. Read beside the number:
   * „zwei abgebrochen" means something different when the name guard ended them than when the two
   * of them agreed to stop.
   */
  endedReasons: z.array(z.string()),
  lastMatchedAt: z.iso.datetime({ offset: true }).nullable(),
});

/**
 * Broken-off first by default, because that is the question the page is opened with. The other
 * orders are there so the same list answers „who has done the most" and „who was matched last"
 * without a second endpoint.
 */
const SORT_ATTRIBUTE = z
  .enum([
    "endedByThem",
    "ended",
    "revealed",
    "running",
    "lastMatchedAt",
    "username",
  ])
  .default("endedByThem");

const LIST_BLIND_DATE_PARTICIPATION_BODY = listQuerySchema(
  SORT_ATTRIBUTE,
  {},
  "desc",
);

export default new OpenAPIHono().openapi(
  createRoute({
    method: "query",
    path: "/blind-date/participation",
    tags: [MODERATION_TAG],
    summary: "How each member's Blind-Dates have gone",
    description:
      "One row per member who has been in at least one Blind-Date, with how many they saw through to the reveal, how many ended without one, how many of those they ended themselves, and how many are still running. Sorted by the ones they ended themselves, first: being left is not the same as leaving, and only the second is a pattern about this member. Operators only — the same figures next to one another are a ranking, which members are deliberately never shown.",
    operationId: "listBlindDateParticipation",
    middleware: [authenticated, authorizedAsModerator] as const,
    request: {
      body: {
        required: true,
        content: jsonContent(LIST_BLIND_DATE_PARTICIPATION_BODY),
      },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "A page of members and how their Blind-Dates went",
        content: jsonContent(listResponseSchema(PARTICIPATION_RESPONSE)),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "Not an operator",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const page = await BlindDateMatchingService.listParticipation(
      listQuery(c.req.valid("json")),
    );

    return c.json(page, STATUS_CODE.OK);
  },
);
