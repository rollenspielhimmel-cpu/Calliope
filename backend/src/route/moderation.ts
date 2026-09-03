import { OpenAPIHono } from "@hono/zod-openapi";
import ipBans from "./moderation/ip_bans.ts";
import ipOverview from "./moderation/ip_overview.ts";
import watchlist from "./moderation/watchlist.ts";
import blockedEmailDomains from "./moderation/blocked_email_domains.ts";
import blockedWords from "./moderation/blocked_words.ts";
import blindDate from "./moderation/blind_date.ts";
import operators from "./moderation/operators.ts";
import broadcast from "./moderation/broadcast.ts";
import invitations from "./moderation/invitations.ts";
import strikes from "./moderation/strikes.ts";
import listIpAddressesForMember from "./moderation/list_ip_addresses_for_member.ts";
import listBlindDateParticipation from "./moderation/list_blind_date_participation.ts";
import blindDateManagers from "./moderation/blind_date_managers.ts";

/**
 * The operators' own tools. Guarded as moderator except for the blocked email domains, the
 * broadcast and granting a role, which are an administrator's: those change the platform itself
 * — who may register, what everybody is told, who is on the team — rather than what happens to
 * one account.
 *
 * The literal segments are mounted before the parameterised ones, or `/ip-bans`, `/watchlist`
 * and `/blocked-email-domains` all become candidates for `/{userId}`.
 */
export default new OpenAPIHono()
  .route("/", ipBans)
  .route("/", ipOverview)
  .route("/", watchlist)
  .route("/", blockedEmailDomains)
  .route("/", blockedWords)
  // Before the desk itself: `/blind-date/managers` is a literal segment, and the desk's own
  // `/blind-date/offers/{offerId}` would otherwise be a candidate for it.
  .route("/", blindDateManagers)
  .route("/", blindDate)
  .route("/", listBlindDateParticipation)
  .route("/", operators)
  .route("/", broadcast)
  .route("/", invitations)
  .route("/", strikes)
  .route("/", listIpAddressesForMember);
