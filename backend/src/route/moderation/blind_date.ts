import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { MODERATION_TAG } from "@/src/open_api_specification.ts";
import {
  BLIND_DATE_APPLICATION_SCHEMA,
  BLIND_DATE_FEEDBACK_SCHEMA,
  BLIND_DATE_OFFER_SCHEMA,
  USER_SCHEMA,
} from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { authorizedAsModerator } from "@/src/middleware/authorized_as_platform_role.ts";
import { BlindDateMatchingService } from "@/src/service/blind_date_matching_service.ts";
import { BlindDateEndingService } from "@/src/service/blind_date_ending_service.ts";
import { BlindDateNameGuardService } from "@/src/service/blind_date_name_guard_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * The team's Blind-Date tools: the queue, the pairing, the offers and the exclusion list.
 *
 * Moderator rather than administrator, unlike the word list beside it: this is casework on
 * individual members, not a standing rule about what the whole community may do.
 *
 * **Nothing here matches anybody automatically, and nothing should.** Whether two writing styles
 * will get on is the judgement the ritual rests on; the endpoint puts together the two
 * applications it was given.
 */

const MEMBER = z.object({
  id: USER_SCHEMA.shape.id,
  username: USER_SCHEMA.shape.username,
});

const PENDING_APPLICATION_RESPONSE = z.object({
  id: BLIND_DATE_APPLICATION_SCHEMA.shape.id,
  createdAt: z.iso.datetime({ offset: true }),
  user: MEMBER,
  /** Beside each application, so judging who is a regular takes no second page. */
  onlineMinutes: z.number().int(),
  offerTitle: z.string().nullable(),
  plotTitle: z.string(),
  writingStyle: BLIND_DATE_APPLICATION_SCHEMA.shape.writingStyle,
  postLength: BLIND_DATE_APPLICATION_SCHEMA.shape.postLength,
  roleGender: z.string(),
  pairing: z.string(),
  note: z.string().nullable(),
});

/**
 * Everything the team sets on an offer, shared by creating one and editing one.
 *
 * One schema rather than two, because the two forms are the same form — and a field that reached
 * only one of them would be a field nobody could correct after the fact.
 */
const OFFER_BODY = z.object({
  title: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDateOfferTitle)),
  description: notBlank(
    z.string().min(1).max(TEXT_LIMIT.blindDateOfferDescription),
  ),
  /**
   * The roles applicants choose between. May be empty — a plot the team has not cast yet is a real
   * thing to offer, and then the applicant describes the role in their own words as before.
   */
  roles: z
    .array(notBlank(z.string().min(1).max(TEXT_LIMIT.blindDateOfferRole)))
    .max(TEXT_LIMIT.blindDateOfferRoles)
    .default([]),
  /** When applying stops. Optional: „bis wir genug haben" is how most rounds run. */
  closesAt: z.iso.datetime({ offset: true }).nullish(),
  /** Which pairing the plot is written for. Optional, and then the card shows no such chip. */
  pairing: BLIND_DATE_OFFER_SCHEMA.shape.pairing.nullish(),
  /** What it feels like, in the team's own words. */
  genres: z
    .array(notBlank(z.string().min(1).max(TEXT_LIMIT.blindDateOfferGenre)))
    .max(TEXT_LIMIT.blindDateOfferGenres)
    .default([]),
});

const MATCH_BODY = z.object({
  firstApplicationId: BLIND_DATE_APPLICATION_SCHEMA.shape.id,
  secondApplicationId: BLIND_DATE_APPLICATION_SCHEMA.shape.id,
  /**
   * Chosen by the team: the two applications may name different plots, and picking between them
   * is the same kind of decision as the pairing itself.
   */
  plotTitle: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDatePlotTitle)),
  // The group's own synopsis is what this becomes, so it takes that bound. It shared the offer's
  // until the offer's was raised, which is when they stopped meaning the same thing.
  synopsis: notBlank(z.string().min(1).max(TEXT_LIMIT.groupSynopsis)),
});

const EXCLUSION_RESPONSE = z.object({
  user: MEMBER,
  reason: z.string(),
  addedBy: MEMBER.nullable(),
  addedAt: z.iso.datetime({ offset: true }),
});

const OFFER_RESPONSE = z.object({
  id: BLIND_DATE_OFFER_SCHEMA.shape.id,
  title: z.string(),
  description: z.string(),
  roles: z.array(z.string()),
  /** The application deadline the team set, or null where it set none. */
  closesAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * The two things a card shows before anybody reads the plot: what kind of pairing it is, and
   * what it feels like. The pairing is a closed question so the chips read the same on every card
   * and can be scanned; the genres are the team's own words, because that list is never finished.
   */
  pairing: BLIND_DATE_OFFER_SCHEMA.shape.pairing,
  genres: BLIND_DATE_OFFER_SCHEMA.shape.genres,
  /** When the team closed it by hand. Unrelated to the deadline above, which closes nothing. */
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * A name the guard found, waiting for a human.
 *
 * It carries the post and both people so an operator can read the sentence in context before
 * deciding — a username may be an ordinary German word, and that is exactly what the decision is
 * about.
 */
const SUSPICION_RESPONSE = z.object({
  id: z.uuidv7(),
  reportId: z.uuidv7(),
  writingGroupId: z.uuidv7(),
  writingPostId: z.uuidv7().nullable(),
  suspected: MEMBER,
  excerpt: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * One member's answers about one Blind-Date, as the team reads them.
 *
 * Both answers null is a decline — somebody was asked and said no thank you, which is recorded so
 * the page stops asking and is worth counting on its own.
 */
const FEEDBACK_RESPONSE = z.object({
  id: BLIND_DATE_FEEDBACK_SCHEMA.shape.id,
  pairId: BLIND_DATE_FEEDBACK_SCHEMA.shape.pairId,
  plotTitle: z.string(),
  username: USER_SCHEMA.shape.username,
  worked: BLIND_DATE_FEEDBACK_SCHEMA.shape.worked,
  again: BLIND_DATE_FEEDBACK_SCHEMA.shape.again,
  note: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_AN_OPERATOR_RESPONSE = {
  description: "Not an operator",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NOT_FOUND_RESPONSE = {
  description: "No such application, offer or account",
  content: jsonContent(ERROR_RESPONSE),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/applications",
      tags: [MODERATION_TAG],
      summary: "The queue of open Blind-Date applications",
      description:
        "Oldest first: whoever has waited longest is who the team should be looking at. Each row carries the preferences a pairing is judged on and the applicant's online time over the last thirty days.",
      operationId: "listBlindDateApplications",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every open application",
          content: jsonContent(z.array(PENDING_APPLICATION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateMatchingService.listPendingApplications(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blind-date/matches",
      tags: [MODERATION_TAG],
      summary: "Put two applications together",
      description:
        "Creates the group, both memberships, the first thread carrying the plot, and the pair — all in one transaction, so a half-made Blind-Date cannot exist. The group is private and its authors pseudonymous; revealing is the pair's own decision later.",
      operationId: "matchBlindDateApplications",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        body: { required: true, content: jsonContent(MATCH_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The two are matched and the group exists",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description:
            "One of them is already in a Blind-Date, excluded since applying, or both applications are the same member",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      const refusal = await BlindDateMatchingService.matchApplications(
        body.firstApplicationId,
        body.secondApplicationId,
        body.plotTitle,
        body.synopsis,
        c.get("user").id,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "same_member":
        case "already_matched":
        case "excluded":
          return c.json({ error: refusal }, STATUS_CODE.Conflict);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blind-date/applications/{applicationId}/decline",
      tags: [MODERATION_TAG],
      summary: "Decline an application",
      description:
        "Kept as a declined row rather than deleted, like every other answer: who applied and how often is what the old spreadsheet carried implicitly. The note is for the team and is not shown to the applicant.",
      operationId: "declineBlindDateApplication",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({
          applicationId: BLIND_DATE_APPLICATION_SCHEMA.shape.id,
        }),
        body: {
          required: true,
          content: jsonContent(z.object({
            note: notBlank(
              z.string().min(1).max(TEXT_LIMIT.blindDateApplicationNote),
            ).nullish(),
          })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The application is declined",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateMatchingService.declineApplication(
        c.req.valid("param").applicationId,
        c.get("user").id,
        c.req.valid("json").note ?? null,
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/suspicions",
      tags: [MODERATION_TAG],
      summary: "Name suspicions waiting for a decision",
      description:
        "Raised automatically when one of the two usernames appears in a Blind-Date's exchange thread. **Nothing has happened yet**: the post is shown as written, both keep writing, and every consequence waits for confirmBlindDateSuspicion. A username can be an ordinary word, which is the whole reason a human decides.",
      operationId: "listBlindDateSuspicions",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every open suspicion, oldest first",
          content: jsonContent(z.array(SUSPICION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateNameGuardService.listOpenSuspicions(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blind-date/suspicions/{suspicionId}/confirm",
      tags: [MODERATION_TAG],
      summary: "Confirm that somebody did give their name away",
      description:
        "Only now do the consequences land: the Blind-Date ends, both seats are freed, the author is excluded and told by mail, and the other is told it ended without being told why. **Nothing is deleted** — the group, its threads and every post stay, and the two names are masked from then on.",
      operationId: "confirmBlindDateSuspicion",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ suspicionId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The Blind-Date is ended and the consequences applied",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Somebody has already decided this one",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateNameGuardService.confirm(
        c.req.valid("param").suspicionId,
        c.get("user").id,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_resolved":
          return c.json({ error: refusal }, STATUS_CODE.Conflict);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blind-date/suspicions/{suspicionId}/dismiss",
      tags: [MODERATION_TAG],
      summary: "It was nothing",
      description:
        "A username that happens to be an ordinary word, a coincidence. Nothing happens to anybody: the notice beside the post disappears and the Blind-Date carries on.",
      operationId: "dismissBlindDateSuspicion",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ suspicionId: z.uuidv7() }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The suspicion is dismissed and nothing follows from it",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "Somebody has already decided this one",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateNameGuardService.dismiss(
        c.req.valid("param").suspicionId,
        c.get("user").id,
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_resolved":
          return c.json({ error: refusal }, STATUS_CODE.Conflict);
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/exclusions",
      tags: [MODERATION_TAG],
      summary: "Who may not take part in Blind-Date",
      description:
        "Its own list, deliberately not a flag on the watchlist: that list says of itself that it is neither an incident nor a consequence, and an exclusion is a consequence.",
      operationId: "listBlindDateExclusions",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Everyone excluded, by name",
          content: jsonContent(z.array(EXCLUSION_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateMatchingService.listExclusions(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/blind-date/exclusions/{userId}",
      tags: [MODERATION_TAG],
      summary: "Exclude a member from Blind-Date",
      description:
        "Also withdraws whatever they have waiting: an application in the queue that can never be matched would be read again at every round. A Blind-Date already running is untouched — this lifts the bar for the next one, it does not end the current one.",
      operationId: "excludeFromBlindDate",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({ userId: USER_SCHEMA.shape.id }),
        body: {
          required: true,
          content: jsonContent(z.object({
            // Required, unlike a watchlist note: this one stops somebody taking part.
            reason: notBlank(
              z.string().min(1).max(TEXT_LIMIT.blindDateExclusionReason),
            ),
          })),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The member is excluded",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateMatchingService.exclude(
        c.req.valid("param").userId,
        c.req.valid("json").reason,
        c.get("user").id,
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/blind-date/exclusions/{userId}",
      tags: [MODERATION_TAG],
      summary: "Let a member take part again",
      operationId: "removeBlindDateExclusion",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: { params: z.object({ userId: USER_SCHEMA.shape.id }) },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The exclusion is lifted",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      await BlindDateMatchingService.removeExclusion(
        c.req.valid("param").userId,
      );

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/offers",
      tags: [MODERATION_TAG],
      summary: "Every offer, closed ones included",
      description:
        "Unlike the members' own list, which shows only what is open: the team needs to see what it has already run.",
      operationId: "listAllBlindDateOffers",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every offer, open ones first",
          content: jsonContent(z.array(OFFER_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateMatchingService.listAllOffers(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/blind-date/offers",
      tags: [MODERATION_TAG],
      summary: "Offer a plot to apply for",
      description:
        "Typically two are open at a time. Applying to one is not the only way in — a member may name any official RSH plot themselves.",
      operationId: "createBlindDateOffer",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        body: {
          required: true,
          content: jsonContent(OFFER_BODY),
        },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The offer is open",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      await BlindDateMatchingService.createOffer(
        {
          title: body.title,
          description: body.description,
          roles: body.roles,
          closesAt: body.closesAt ?? null,
          pairing: body.pairing ?? null,
          genres: body.genres,
        },
        c.get("user").id,
      );

      return c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/blind-date/offers/{offerId}",
      tags: [MODERATION_TAG],
      summary: "Change an offer that is still open",
      description:
        "Every field at once, the same ones creating it takes. Only an open offer: a closed one is what somebody applied to and has to keep saying so. Applications keep the role text they chose, so editing the list cannot rewrite what anybody applied for.",
      operationId: "updateBlindDateOffer",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({ offerId: BLIND_DATE_OFFER_SCHEMA.shape.id }),
        body: { required: true, content: jsonContent(OFFER_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The offer is changed",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      const refusal = await BlindDateMatchingService.updateOffer(
        c.req.valid("param").offerId,
        {
          title: body.title,
          description: body.description,
          roles: body.roles,
          closesAt: body.closesAt ?? null,
          pairing: body.pairing ?? null,
          genres: body.genres,
        },
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/blind-date/offers/{offerId}",
      tags: [MODERATION_TAG],
      summary: "Close an offer",
      description:
        "Closed rather than deleted: applications point at it, and a closed offer still has to say what somebody applied for months later.",
      operationId: "closeBlindDateOffer",
      middleware: [authenticated, authorizedAsModerator] as const,
      request: {
        params: z.object({ offerId: BLIND_DATE_OFFER_SCHEMA.shape.id }),
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The offer is closed",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NOT_FOUND_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateMatchingService.closeOffer(
        c.req.valid("param").offerId,
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/blind-date/feedback",
      tags: [MODERATION_TAG],
      summary: "What members said about their Blind-Dates",
      description:
        "The voluntary three-question form, newest first, with names — the point of reading it is to be able to ask somebody about what they wrote. Declines are in here too, with both answers empty: a form most people decline says something the answers cannot. The questions are about the format and never about the other person, so nothing here is a complaint about a member; those arrive as reports.",
      operationId: "listBlindDateFeedback",
      middleware: [authenticated, authorizedAsModerator] as const,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every answer and every decline, newest first",
          content: jsonContent(z.array(FEEDBACK_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        [STATUS_CODE.Forbidden]: NOT_AN_OPERATOR_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateEndingService.listFeedback(),
        STATUS_CODE.OK,
      );
    },
  );
