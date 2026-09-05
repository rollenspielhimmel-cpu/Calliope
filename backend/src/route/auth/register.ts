import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { TEXT_LIMIT, TEXT_MINIMUM } from "@/src/text_limit.ts";
import { AUTH_TAG } from "@/src/open_api_specification.ts";
import { STATUS_CODE } from "@std/http/status";
import { BlockedEmailDomainService } from "@/src/service/blocked_email_domain_service.ts";
import { BreachedPasswordService } from "@/src/service/breached_password_service.ts";
import { UserService } from "@/src/service/user_service.ts";
import { sessionProvenance } from "@/src/util/session_provenance.ts";
import { USER_SCHEMA } from "@/src/database/schema.ts";
import { SessionCookieService } from "@/src/service/session_cookie_service.ts";
import { EmailAddressVerificationService } from "@/src/service/email_address_verification_service.ts";
import { EMAIL_ADDRESS_SCHEMA, notBlank } from "@/src/http/request_schema.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  EMAIL_DOMAIN_BLOCKED_BODY,
  ERROR_RESPONSE,
  jsonContent,
  OK_RESPONSE,
  PASSWORD_BREACHED_BODY,
} from "@/src/http/response.ts";

/**
 * **Noch offen: die Zustimmung vor der Registrierung.**
 *
 * Sie fehlt, weil es noch nichts gibt, dem man zustimmen könnte — die Nutzungsbedingungen sind
 * ungeschrieben, und ihr Text kommt von der Betreiberin, nicht aus dem Code. Sobald er dasteht,
 * gehört die Zustimmung hierher: als Feld am Registrierungskörper, das die Anmeldung verweigert,
 * wenn es fehlt.
 *
 * **Wie festgehalten wird, ist entschieden** und steht hier, damit die Frage beim nächsten
 * Anfassen nicht noch einmal aufgemacht wird. Protokolliert wird *wer*, *wann* und *welcher
 * Fassung* — und die Fassung als **Prüfsumme des Textes plus Datum**, wobei **der zugestimmte
 * Text selbst mit aufbewahrt wird**.
 *
 * Warum nicht anders:
 *
 * - Nur ein Datum wäre billig, aber zwei Änderungen am selben Tag wären nicht unterscheidbar.
 * - Eine Versionsnummer, die jemand beim Bearbeiten hochzählt, ist verlässlich, solange jemand
 *   daran denkt — und genau das ist die Annahme, die nach zwei Jahren nicht mehr trägt.
 * - Eine Prüfsumme entsteht von selbst und lässt sich nicht nachträglich zurechtlegen. Aber
 *   „hat Fassung a3f8b1… zugestimmt" beantwortet vor Gericht nichts, solange niemand sagen kann,
 *   was in a3f8b1… stand. Deshalb der Text dazu: Ohne ihn ist die Prüfsumme wertlos.
 */

const REGISTER_BODY = USER_SCHEMA
  .pick({ username: true, emailAddress: true })
  .extend({
    // A name is what everybody else sees; „   " is three characters and so passed the minimum,
    // and a member registered under a name that renders as nothing anywhere it appears.
    username: notBlank(
      USER_SCHEMA.shape.username
        .min(TEXT_MINIMUM.username)
        .max(TEXT_LIMIT.username),
    ),
    emailAddress: EMAIL_ADDRESS_SCHEMA,
    // Never stored as given, so it has no column of its own.
    password: z.string().min(TEXT_MINIMUM.password).max(TEXT_LIMIT.password),
    // Who invited them, from the link they followed. A username, because that is already the
    // public handle members share with one another. Optional, and a name that matches nobody is
    // ignored rather than refused: a stale link must never stop somebody joining.
    invitedBy: USER_SCHEMA.shape.username.optional(),
  });

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/register",
    tags: [AUTH_TAG],
    summary: "Register a user and start a session",
    description:
      "Creates a user and immediately starts a session for them. The username and the email address must both be unused; the address is compared case-insensitively.",
    operationId: "registerUser",
    request: {
      body: { required: true, content: jsonContent(REGISTER_BODY) },
    },
    responses: {
      [STATUS_CODE.OK]: {
        description: "User registered",
        content: jsonContent(OK_RESPONSE),
      },
      [STATUS_CODE.UnprocessableEntity]: {
        description:
          "The password appears in known breaches, or the email domain is blocked from registering",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Conflict]: {
        description: "Username or email address already in use",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { username, password, emailAddress, invitedBy } = c.req.valid("json");

    if (await BreachedPasswordService.isBreached(password)) {
      return c.json(PASSWORD_BREACHED_BODY, STATUS_CODE.UnprocessableEntity);
    }

    // Beside the password check and answering the same way, because it is the same kind of
    // refusal: the request is well formed, and what it asks for is not allowed.
    if (await BlockedEmailDomainService.isBlocked(emailAddress)) {
      return c.json(
        EMAIL_DOMAIN_BLOCKED_BODY,
        STATUS_CODE.UnprocessableEntity,
      );
    }

    const user = await UserService.insertUser(
      username,
      password,
      emailAddress,
      invitedBy === undefined
        ? undefined
        : await UserService.selectInviterId(invitedBy),
    );

    if (user === undefined) {
      return c.json(
        { error: "Username or email address already in use" },
        STATUS_CODE.Conflict,
      );
    }

    // A session is started even though the address is unverified: without one there is no
    // way back in to correct a typo, and the account would be orphaned by a single slip.
    const sessionToken = await UserService.insertSessionForUser(
      user,
      sessionProvenance(c),
    );
    SessionCookieService.setUserSession(c, sessionToken);

    EmailAddressVerificationService.sendVerificationMail(user);

    return c.json({ ok: true } as const, STATUS_CODE.OK);
  },
);
