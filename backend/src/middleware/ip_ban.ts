import { createMiddleware } from "hono/factory";
import { STATUS_CODE } from "@std/http/status";
import { clientAddress } from "@/src/util/client_address.ts";
import { IpModerationService } from "@/src/service/ip_moderation_service.ts";
import type { ErrorResponse } from "@/src/http/response.ts";

/**
 * Registered before both rate limiters (see `app.ts`): a banned address should not spend its own
 * request budget before being turned away.
 *
 * One database query per request rather than a Redis set, as a deliberately plain first draft.
 * The rate limiter already keeps its state in Redis, and moving this there is the next step if
 * the extra query ever shows up in the response time.
 */
export default createMiddleware(async (c, next) => {
  const address = clientAddress(c);

  if (address !== undefined && await IpModerationService.isIpBanned(address)) {
    return c.json(
      { error: "Forbidden" } satisfies ErrorResponse,
      STATUS_CODE.Forbidden,
    );
  }

  await next();
  return;
});
