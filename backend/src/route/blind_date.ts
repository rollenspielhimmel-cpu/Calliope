import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";
import { BLIND_DATE_TAG } from "@/src/open_api_specification.ts";
import {
  BLIND_DATE_APPLICATION_SCHEMA,
  BLIND_DATE_FEEDBACK_SCHEMA,
  BLIND_DATE_OFFER_SCHEMA,
} from "@/src/database/schema.ts";
import { TEXT_LIMIT } from "@/src/text_limit.ts";
import { notBlank } from "@/src/http/request_schema.ts";
import authenticated from "@/src/middleware/authenticated.ts";
import { BlindDateService } from "@/src/service/blind_date_service.ts";
import { BlindDateEndingService } from "@/src/service/blind_date_ending_service.ts";
import { BlindDateRevealService } from "@/src/service/blind_date_reveal_service.ts";
import { assertUnreachable } from "@/src/util/assert_unreachable.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
} from "@/src/http/response.ts";

/**
 * The member's half of Blind-Date: what is on offer, whether they may take part, and their own
 * application.
 *
 * The matching, the exclusion list and the offers' administration are moderation's and live under
 * `/moderation`. Nothing here reveals anybody: an application says what somebody wants to write,
 * never who they end up with, and the pairing is not visible from this side at all.
 */

const OFFER_RESPONSE = z.object({
  id: BLIND_DATE_OFFER_SCHEMA.shape.id,
  title: z.string(),
  description: z.string(),
  /** The roles to choose between. Empty where the team named none, and then the field is prose. */
  roles: z.array(z.string()),
  /**
   * When applying stops, or null for „until we have enough“. An offer past its date stays in this
   * list on purpose — see `listOpenOffers` — and the page says so rather than losing the plot.
   */
  closesAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * Why somebody may not apply, as a token the interface turns into a sentence. `excluded` says
 * only that — the reason the team wrote down is theirs, not something to read back to the member.
 */
const INELIGIBILITY = z.enum([
  "excluded",
  "already_applied",
  "already_matched",
  "not_enough_online_time",
]);

const ELIGIBILITY_RESPONSE = z.object({
  reason: INELIGIBILITY.nullable(),
  onlineMinutes: z.number().int(),
  requiredOnlineMinutes: z.number().int(),
  /**
   * True while the launch grace period runs, when nobody has had time to collect the minutes and
   * the condition deliberately does not apply. The interface says so rather than showing a rule
   * that is not in force.
   */
  inGracePeriod: z.boolean(),
});

/**
 * The Blind-Date this member has not been asked about yet.
 *
 * `wasRevealed` is here so the form can open with the right sentence — „ihr habt euch zu erkennen
 * gegeben“ and „es ist ohne Enthüllung zu Ende gegangen“ are two different things to be asked
 * about, and a form that opens with the wrong one reads as a form nobody checked.
 */
const FEEDBACK_INVITATION_RESPONSE = z.object({
  pairId: BLIND_DATE_FEEDBACK_SCHEMA.shape.pairId,
  plotTitle: z.string(),
  wasRevealed: z.boolean(),
  endedAt: z.iso.datetime({ offset: true }),
});

/**
 * Both answers, or neither.
 *
 * Neither is „nein danke“, recorded so the page stops asking — the one thing a voluntary form must
 * be able to do. A note without the two answers is refused rather than stored: it would be an
 * answer in disguise, and the form does not offer that combination.
 */
const FEEDBACK_BODY = z
  .object({
    pairId: BLIND_DATE_FEEDBACK_SCHEMA.shape.pairId,
    worked: BLIND_DATE_FEEDBACK_SCHEMA.shape.worked.nullish(),
    again: BLIND_DATE_FEEDBACK_SCHEMA.shape.again.nullish(),
    note: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDateFeedbackNote))
      .nullish(),
  })
  .refine(
    (body) =>
      (body.worked === null || body.worked === undefined) ===
        (body.again === null || body.again === undefined),
    {
      error: "Beide Antworten zusammen, oder keine von beiden.",
      path: ["again"],
    },
  )
  .refine(
    (body) =>
      body.worked !== null && body.worked !== undefined
        ? true
        : body.note === null || body.note === undefined,
    { error: "Ohne Antworten auch keine Anmerkung.", path: ["note"] },
  );

const APPLICATION_BODY = z.object({
  /** Null for a proactive application, which names an official plot of its own instead. */
  offerId: BLIND_DATE_OFFER_SCHEMA.shape.id.nullish(),
  plotTitle: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDatePlotTitle)),
  writingStyle: BLIND_DATE_APPLICATION_SCHEMA.shape.writingStyle,
  postLength: BLIND_DATE_APPLICATION_SCHEMA.shape.postLength,
  roleGender: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDatePreference)),
  pairing: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDatePreference)),
  note: notBlank(z.string().min(1).max(TEXT_LIMIT.blindDateApplicationNote))
    .nullish(),
});

const OWN_APPLICATION_RESPONSE = APPLICATION_BODY.extend({
  id: BLIND_DATE_APPLICATION_SCHEMA.shape.id,
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * What everybody may see of a running Blind-Date. Deliberately four fields: a plot, a count, a
 * date and an ordinal for reading. No names, no ids — that is the whole point of the ritual, and
 * this list is the place it would be easiest to give away by accident.
 */
const ACTIVE_BLIND_DATE_RESPONSE = z.object({
  number: z.number().int(),
  plotTitle: z.string(),
  posts: z.number().int(),
  lastActivityAt: z.iso.datetime({ offset: true }),
});

/**
 * The member's own running Blind-Date. `otherAgreed` is not a leak — it is the person they are
 * already writing with, and knowing somebody is waiting on you is the whole social half of the
 * moment. It says nothing about who that is.
 */
const OWN_BLIND_DATE_RESPONSE = z.object({
  writingGroupId: z.uuidv7(),
  plotTitle: z.string(),
  matchedAt: z.iso.datetime({ offset: true }),
  /**
   * Posts in the RPG thread, and how many it takes. Both, so the interface can name what is
   * missing rather than only greying the button out — counted on that thread alone, because the
   * other three are organisation and talking is not writing together.
   */
  rpgPosts: z.number().int(),
  postsBeforeReveal: z.number().int(),
  mayReveal: z.boolean(),
  iAgreed: z.boolean(),
  otherAgreed: z.boolean(),
});

const NO_BLIND_DATE_RESPONSE = {
  description: "This member is not in a Blind-Date",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const NO_SESSION_RESPONSE = {
  description: "No valid session",
  content: jsonContent(ERROR_RESPONSE),
} as const;

const MAY_NOT_APPLY_RESPONSE = {
  description:
    "Excluded, already applied, already in a Blind-Date, or not enough online time",
  content: jsonContent(
    z.object({ error: z.string(), reason: INELIGIBILITY }),
  ),
} as const;

export default new OpenAPIHono()
  .openapi(
    createRoute({
      method: "get",
      path: "/offers",
      tags: [BLIND_DATE_TAG],
      summary: "The plots the team is offering right now",
      description:
        "Typically two at a time. A closed offer is history and stays out; applying to one is not the only way in, because a member may name any official RSH plot themselves.",
      operationId: "listBlindDateOffers",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every open offer, newest first",
          content: jsonContent(z.array(OFFER_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(await BlindDateService.listOpenOffers(), STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/active",
      tags: [BLIND_DATE_TAG],
      summary: "The Blind-Dates that are running, without saying whose",
      description:
        "How alive Blind-Date is right now, which is what makes people apply. A plot, how much has been written and when it last was — no names, no ids, and only the ones not yet revealed.",
      operationId: "listActiveBlindDates",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Every running Blind-Date, oldest first",
          content: jsonContent(z.array(ACTIVE_BLIND_DATE_RESPONSE)),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      return c.json(
        await BlindDateService.listActiveBlindDates(),
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/mine",
      tags: [BLIND_DATE_TAG],
      summary: "The Blind-Date this member is in, if any",
      description:
        "Only while it is still a Blind-Date: once revealed it is an ordinary group and answers 404 here. Carries whether each side has agreed to be revealed — never who the other is.",
      operationId: "getOwnBlindDate",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The running Blind-Date",
          content: jsonContent(OWN_BLIND_DATE_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NO_BLIND_DATE_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const mine = await BlindDateRevealService.selectOwnBlindDate(
        c.get("user").id,
      );

      return mine === undefined
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json(mine, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/reveal",
      tags: [BLIND_DATE_TAG],
      summary: "Agree to be revealed",
      description:
        "Refused until the two have written enough posts in the RPG thread together — the anonymity is meant to last long enough to be worth something. Both have to agree, and each says so for themselves. The second yes lifts the pseudonyms on the group — the same group, every post kept, nothing migrated. It does **not** make the group public: whether the writing is published stays the pair's own decision.",
      operationId: "agreeToBlindDateReveal",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description:
            "Recorded. The outcome says whether that was the second yes.",
          content: jsonContent(
            z.object({ outcome: z.enum(["waiting", "revealed"]) }),
          ),
        },
        [STATUS_CODE.Conflict]: {
          description:
            "The two have not written enough together yet. How many are still missing is on getOwnBlindDate.",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NO_BLIND_DATE_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const outcome = await BlindDateRevealService.agreeToReveal(
        c.get("user").id,
      );

      switch (outcome) {
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        // Checked on the server as well as in the interface: a greyed-out button is a courtesy,
        // and the rule has to hold for anybody reaching the endpoint another way.
        case "too_few_posts":
          return c.json({ error: "too_few_posts" }, STATUS_CODE.Conflict);
        case "waiting":
        case "revealed":
          return c.json({ outcome }, STATUS_CODE.OK);
        default:
          return assertUnreachable(outcome);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/reveal",
      tags: [BLIND_DATE_TAG],
      summary: "Take that back",
      description:
        "While it can still be taken back — once both have agreed the group is already revealed. Nothing records that somebody withdrew: the question is only ever whether they want to now.",
      operationId: "withdrawBlindDateRevealConsent",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The consent is withdrawn",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: NO_BLIND_DATE_RESPONSE,
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateRevealService.withdrawRevealConsent(
        c.get("user").id,
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/eligibility",
      tags: [BLIND_DATE_TAG],
      summary: "Whether this member may apply, and what they have",
      description:
        "Asked before the form is shown, so it can explain itself rather than only refusing. It is not a permission: `createBlindDateApplication` checks the same thing again, because a check that only ran here is one anybody could skip.",
      operationId: "getBlindDateEligibility",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "Where this member stands",
          content: jsonContent(ELIGIBILITY_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const eligibility = await BlindDateService.eligibilityFor(
        c.get("user").id,
      );

      return c.json(
        { ...eligibility, reason: eligibility.reason ?? null },
        STATUS_CODE.OK,
      );
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/applications/mine",
      tags: [BLIND_DATE_TAG],
      summary: "This member's own open application",
      description:
        "Only their own, and only while it is open: an application that has been answered is the team's record rather than something to show back.",
      operationId: "getOwnBlindDateApplication",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The open application",
          content: jsonContent(OWN_APPLICATION_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No open application",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const application = await BlindDateService.selectOwnPendingApplication(
        c.get("user").id,
      );

      return application === undefined
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json(application, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/applications",
      tags: [BLIND_DATE_TAG],
      summary: "Apply for a Blind-Date",
      description:
        "Either taking up one of the offers or naming an official plot of one's own. One open application at a time, and one Blind-Date at a time — both refused here rather than left to the matching.",
      operationId: "createBlindDateApplication",
      middleware: authenticated,
      request: {
        body: { required: true, content: jsonContent(APPLICATION_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "The application is in the queue",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.Forbidden]: MAY_NOT_APPLY_RESPONSE,
        [STATUS_CODE.NotFound]: {
          description: "No such open offer",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description:
            "The offer no longer takes applications, or the role is not one it names",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      const refusal = await BlindDateService.apply(c.get("user").id, {
        offerId: body.offerId ?? null,
        plotTitle: body.plotTitle,
        writingStyle: body.writingStyle,
        postLength: body.postLength,
        roleGender: body.roleGender,
        pairing: body.pairing,
        note: body.note ?? null,
      });

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "no_such_offer":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        // Both mean the offer moved on while the form was open — a deadline that passed, or a role
        // list that was edited. A conflict rather than a bad request: the form was right when it
        // was rendered, and telling somebody they filled it in wrongly would be untrue.
        case "offer_expired":
          return c.json(
            { error: "Die Bewerbungsfrist für diese Handlung ist abgelaufen." },
            STATUS_CODE.Conflict,
          );
        case "role_not_offered":
          return c.json(
            {
              error:
                "Diese Rolle steht für diese Handlung nicht mehr zur Auswahl. Lade die Seite neu.",
            },
            STATUS_CODE.Conflict,
          );
        case "excluded":
        case "already_applied":
        case "already_matched":
        case "not_enough_online_time":
          return c.json(
            { error: "Forbidden", reason: refusal },
            STATUS_CODE.Forbidden,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/applications/mine",
      tags: [BLIND_DATE_TAG],
      summary: "Withdraw the open application",
      description:
        "Recorded as withdrawn rather than deleted: who applied and thought better of it is part of what the queue says, and the team asked to keep every application.",
      operationId: "withdrawBlindDateApplication",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The application is withdrawn",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No open application to withdraw",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateService.withdraw(c.get("user").id);

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/mine",
      tags: [BLIND_DATE_TAG],
      summary: "End one's own Blind-Date without revealing",
      description:
        "Either of the two may end it, alone — unlike revealing, which needs both. Staying is not something either of them owes, and a way out that depended on the other person agreeing would depend on the person one is trying to get away from. Nothing is deleted: the group, its threads and everything both wrote stay as they are and stay pseudonymous. The other side is told that it ended, and nothing more.",
      operationId: "endOwnBlindDate",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "The Blind-Date is over and both seats are free",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No running Blind-Date to end",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const refusal = await BlindDateEndingService.endOwnBlindDate(
        c.get("user").id,
      );

      return refusal === "not_found"
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json({ ok: true } as const, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/feedback/pending",
      tags: [BLIND_DATE_TAG],
      summary: "The Blind-Date this member has not been asked about yet",
      description:
        "The most recent one that is over, revealed or not, where this member has neither answered nor declined. Only the most recent: somebody coming back after three of them is asked about the one they remember rather than handed a queue of forms. 404 where there is nothing to ask about, which is the ordinary case.",
      operationId: "getPendingBlindDateFeedback",
      middleware: authenticated,
      responses: {
        [STATUS_CODE.OK]: {
          description: "A Blind-Date that has not been asked about",
          content: jsonContent(FEEDBACK_INVITATION_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "Nothing to ask about",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const invitation = await BlindDateEndingService.selectPendingFeedback(
        c.get("user").id,
      );

      return invitation === undefined
        ? c.json({ error: "Not found" }, STATUS_CODE.NotFound)
        : c.json(invitation, STATUS_CODE.OK);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/feedback",
      tags: [BLIND_DATE_TAG],
      summary: "Answer the three questions, or decline them",
      description:
        "Voluntary. Both answers together, or neither — sending neither is „nein danke“, which is recorded so the page stops asking. The questions are about the format and never about the other person; a complaint about somebody belongs in a report, which this is not. Answers reach the team and never the other member.",
      operationId: "submitBlindDateFeedback",
      middleware: authenticated,
      request: {
        body: { required: true, content: jsonContent(FEEDBACK_BODY) },
      },
      responses: {
        [STATUS_CODE.OK]: {
          description: "Recorded",
          content: jsonContent(OK_RESPONSE),
        },
        [STATUS_CODE.NotFound]: {
          description: "No such finished Blind-Date of this member's",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Conflict]: {
          description: "This member has already answered about this one",
          content: jsonContent(ERROR_RESPONSE),
        },
        [STATUS_CODE.Unauthorized]: NO_SESSION_RESPONSE,
        ...BAD_REQUEST_RESPONSE,
        ...COMMON_RESPONSES,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");

      const refusal = await BlindDateEndingService.submitFeedback(
        c.get("user").id,
        body.pairId,
        {
          worked: body.worked ?? null,
          again: body.again ?? null,
          note: body.note ?? null,
        },
      );

      switch (refusal) {
        case undefined:
          return c.json({ ok: true } as const, STATUS_CODE.OK);
        case "not_found":
          return c.json({ error: "Not found" }, STATUS_CODE.NotFound);
        case "already_answered":
          return c.json(
            { error: "Du hast dazu schon geantwortet." },
            STATUS_CODE.Conflict,
          );
        default:
          return assertUnreachable(refusal);
      }
    },
  );
