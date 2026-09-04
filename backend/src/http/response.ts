import { z } from "@hono/zod-openapi";
import { STATUS_CODE } from "@std/http/status";

/**
 * Every declared response needs a content schema. A content-less one widens the handler's
 * return type to plain `Response`, which silently disables the compile-time body and status
 * checks for the whole route.
 */
export function jsonContent<T extends z.ZodType>(schema: T) {
  return { "application/json": { schema } };
}

export const OK_RESPONSE = z.object({ ok: z.literal(true) });

/**
 * The one thing a client has to tell apart from a lost session: a 401 meaning the password it
 * just sent was wrong. This value is a contract — the message beside it is not, and may be
 * reworded freely.
 */
export const INVALID_CREDENTIALS = "invalid_credentials" as const;

export const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials" as const;

/**
 * A third meaning for a refusal the client has to tell apart. Without it a banned member is
 * simply refused, which reads as an ended session and signs them out with no explanation —
 * true, and useless to them.
 */
export const ACCOUNT_BANNED = "account_banned" as const;

/**
 * Deliberately says nothing about why. The reason an operator recorded is a note for
 * operators; what the member is told is this one sentence, the same for everybody.
 */
const ACCOUNT_BANNED_MESSAGE = "Account banned" as const;

/**
 * A fourth meaning, and deliberately not the third one: a suspension ends by itself, so what the
 * member has to be told is *when* — which a ban has no answer to.
 */
export const ACCOUNT_SUSPENDED = "account_suspended" as const;

const ACCOUNT_SUSPENDED_MESSAGE = "Account suspended" as const;

/** Its own code because the form says this on the password field, not as a form error. */
export const PASSWORD_BREACHED = "password_breached" as const;

/** Its own code for the same reason, on the email field: the address is what has to change. */
export const EMAIL_DOMAIN_BLOCKED = "email_domain_blocked" as const;
/** Its own code because the editor keeps what was typed and offers to reload, not a form error. */
export const PAGE_CHANGED = "page_changed" as const;

/** Its own code so the tree can say to empty the folder first, rather than "not possible". */
export const FOLDER_NOT_EMPTY = "folder_not_empty" as const;

/** Its own code so the tree can name the limit rather than report a generic refusal. */
export const FOLDER_TOO_DEEP = "folder_too_deep" as const;

/** A folder cannot move into itself or into something it contains. */
export const FOLDER_CYCLE = "folder_cycle" as const;

/** Machine-readable reasons, for the few a client has to act on differently. */
const ERROR_CODE = z.enum([
  INVALID_CREDENTIALS,
  ACCOUNT_BANNED,
  ACCOUNT_SUSPENDED,
  PASSWORD_BREACHED,
  EMAIL_DOMAIN_BLOCKED,
  PAGE_CHANGED,
  FOLDER_NOT_EMPTY,
  FOLDER_TOO_DEEP,
  FOLDER_CYCLE,
]);

/**
 * The single error shape for every failure the API reports. `issues` is only filled in for
 * schema violations, so that one contract covers validation errors and everything else.
 */
export const ERROR_RESPONSE = z.object({
  error: z.string(),
  issues: z.array(z.object({
    path: z.string(),
    message: z.string(),
  })).optional(),
  code: ERROR_CODE.optional(),
});

export type ErrorResponse = z.infer<typeof ERROR_RESPONSE>;

/**
 * Which budget refused the request. There are two, split by method, so a member who has spent one
 * has not necessarily spent the other — and the interface says something different for each: reads
 * exhausted means nothing works, writes exhausted means reading still does.
 */
const RATE_LIMIT_SCOPE = z.enum(["read", "write"]);

export type RateLimitScope = z.infer<typeof RATE_LIMIT_SCOPE>;

/** The 429's own body: the shared error shape plus which budget it was. */
const RATE_LIMIT_RESPONSE = ERROR_RESPONSE.extend({
  scope: RATE_LIMIT_SCOPE,
});

/**
 * The 409's own body: who wrote in the meantime, so the refusal can name them. Null when that
 * account is gone, like every other joined name.
 */
export const PAGE_CHANGED_RESPONSE = ERROR_RESPONSE.extend({
  updatedByUsername: z.string().nullable(),
});

/**
 * The body for a wrong password — signing in, or re-authenticating with a valid session. Always
 * this constant: the frontend signs a member out on any 401 it cannot account for, so answering
 * one without the code closes their dialog and loses what they typed.
 *
 * A constant rather than a helper returning `c.json(...)`, because a helper's `Response` widens
 * the handler's return type and switches off the body and status checks for the whole route.
 */
export const INVALID_CREDENTIALS_BODY = {
  error: INVALID_CREDENTIALS_MESSAGE,
  code: INVALID_CREDENTIALS,
} as const;

/**
 * The body for a banned account, wherever it is refused: signing in, and any request carrying a
 * session that outlived the ban. **403, not 401** — signing in got the password right, and a
 * live session is perfectly valid, so "unauthenticated" would be false in both places and would
 * send the member back to a sign-in page that cannot help them.
 *
 * A constant for the same reason as the one above: a helper returning `c.json(...)` widens the
 * handler's return type and switches off the route's body and status checks.
 */
export const ACCOUNT_BANNED_BODY = {
  error: ACCOUNT_BANNED_MESSAGE,
  code: ACCOUNT_BANNED,
} as const;

/**
 * The 403 for a suspended account. Unlike the ban above it carries both the moment it ends and
 * the reason, **and this difference is deliberate**: a suspension is meant to correct, so the
 * member has to know what to change and how long it lasts, while a ban is final and its note is
 * written for operators. Do not make the two agree.
 *
 * One flat shape with two optional fields rather than a union of the two bodies, which is the
 * exception to the rule a few lines up: Orval generates the `code` enum from a single branch of
 * a union, so the union quietly emitted a `LoginUser403Code` missing `account_suspended` — and
 * that constant is precisely what the sign-in form reads, so renaming a code has to break
 * compilation there rather than fall through to a generic failure.
 */
export const ACCOUNT_SUSPENDED_RESPONSE = ERROR_RESPONSE.extend({
  suspendedUntil: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().optional(),
});

/**
 * A function rather than a constant, because both values differ per account — but still a plain
 * object rather than a `c.json(...)` helper, for the same reason the constants above are: a
 * helper returning a `Response` widens the handler's return type and switches off the route's
 * body and status checks.
 */
export function accountSuspendedBody(suspendedUntil: string, reason: string) {
  return {
    error: ACCOUNT_SUSPENDED_MESSAGE,
    code: ACCOUNT_SUSPENDED,
    suspendedUntil,
    reason,
  } as const;
}

/** A constant for the same reason as the two above: a helper widens the return type. */
export const PASSWORD_BREACHED_BODY = {
  error: "That password appears in known breaches",
  code: PASSWORD_BREACHED,
} as const;

/**
 * A constant for the same reason. Deliberately says the domain rather than the address is the
 * problem: what somebody has to do is register with a different provider, not fix a typo.
 */
export const EMAIL_DOMAIN_BLOCKED_BODY = {
  error: "That email provider cannot be used to register",
  code: EMAIL_DOMAIN_BLOCKED,
} as const;

/**
 * Produced by the body limit, the rate limiter and the global error handler, so every route
 * can return them regardless of what its own handler does.
 */
export const COMMON_RESPONSES = {
  [STATUS_CODE.ContentTooLarge]: {
    description: "Request body too large",
    content: jsonContent(ERROR_RESPONSE),
  },
  [STATUS_CODE.TooManyRequests]: {
    description: "Rate limit exceeded",
    content: jsonContent(RATE_LIMIT_RESPONSE),
  },
  [STATUS_CODE.InternalServerError]: {
    description: "Unexpected failure",
    content: jsonContent(ERROR_RESPONSE),
  },
} as const;

/**
 * Returned by the session middleware when the address behind an otherwise good session has
 * not been verified. Routes that also refuse for a reason of their own declare their own 403
 * with a description saying which, and do not spread this.
 */
export const FORBIDDEN_RESPONSE = {
  [STATUS_CODE.Forbidden]: {
    description: "Email address not verified",
    content: jsonContent(ERROR_RESPONSE),
  },
} as const;

/** Returned by the validator whenever a request fails its schema. */
export const BAD_REQUEST_RESPONSE = {
  [STATUS_CODE.BadRequest]: {
    description: "Invalid request",
    content: jsonContent(ERROR_RESPONSE),
  },
} as const;
