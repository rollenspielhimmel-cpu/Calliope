import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { CHAT_MEMBERSHIP_RESPONSE } from "@/src/http/response_schema.ts";
import { CHATS_TAG } from "@/src/open_api_specification.ts";
import { STATUS_CODE } from "@std/http/status";
import authenticated from "@/src/middleware/authenticated.ts";
import { BanService } from "@/src/service/ban_service.ts";
import { BlockService } from "@/src/service/block_service.ts";
import { UserInChatGroupService } from "@/src/service/user_in_chat_group_service.ts";
import { ChatGroupService } from "@/src/service/chat_group_service.ts";
import { AdminInboxService } from "@/src/service/admin_inbox_service.ts";
import { isTheAdministration } from "@/src/service/root_admin_service.ts";
import { userExists } from "@/src/service/user_in_writing_group_service.ts";
import { checkJoinedChatMember } from "@/src/route/chats/chat/chat_membership.ts";
import {
  BAD_REQUEST_RESPONSE,
  COMMON_RESPONSES,
  ERROR_RESPONSE,
  jsonContent,
} from "@/src/http/response.ts";
import { CHAT_GROUP_SCHEMA, USER_SCHEMA } from "@/src/database/schema.ts";

const CHAT_PARAMS = z.object({ chatId: CHAT_GROUP_SCHEMA.shape.id });
const INVITE_BODY = z.object({ userId: USER_SCHEMA.shape.id });

export default new OpenAPIHono().openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: [CHATS_TAG],
    summary: "Invite somebody to a chat",
    description:
      "Anybody already in the chat may invite. The invited member has to accept before they are part of the conversation.",
    operationId: "inviteToChat",
    middleware: authenticated,
    request: {
      params: CHAT_PARAMS,
      body: { required: true, content: jsonContent(INVITE_BODY) },
    },
    responses: {
      [STATUS_CODE.Created]: {
        description: "The invitation",
        content: jsonContent(CHAT_MEMBERSHIP_RESPONSE),
      },
      // Keine Einladung, sondern der Faden mit der Administration: Bei Admin nimmt niemand an.
      [STATUS_CODE.OK]: {
        description:
          "Writing to the administration: the conversation to use, instead of an invitation",
        content: jsonContent(
          z.object({ chatGroupId: CHAT_GROUP_SCHEMA.shape.id }),
        ),
      },
      [STATUS_CODE.Unauthorized]: {
        description: "No valid session",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Forbidden]: {
        description: "The invitation has not been accepted",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.NotFound]: {
        description: "No such chat, or no such user",
        content: jsonContent(ERROR_RESPONSE),
      },
      [STATUS_CODE.Conflict]: {
        description: "Already invited or already in the chat",
        content: jsonContent(ERROR_RESPONSE),
      },
      ...BAD_REQUEST_RESPONSE,
      ...COMMON_RESPONSES,
    },
  }),
  async (c) => {
    const { chatId } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const user = c.get("user");

    const access = await checkJoinedChatMember(user, chatId);
    if (!access.allowed) {
      return access.reason === "not-found"
        ? c.json({ error: access.error }, STATUS_CODE.NotFound)
        : c.json({ error: access.error }, STATUS_CODE.Forbidden);
    }

    if (!await userExists(userId)) {
      return c.json({ error: "User not found" }, STATUS_CODE.NotFound);
    }

    // Neutral on purpose: it does not say who blocked whom, only that this cannot happen.
    // A ban refuses contact the same way, and answers the same neutral refusal: an inviter
    // must not learn that a moderation action was taken against somebody else.
    //
    // **A running Blind-Date used to refuse here too, and deliberately no longer does.** The
    // pseudonymity is a property of the Blind-Date group: inside it the two write as
    // „Blind-Date-Partner 1" and „2" and there is no private chat between those two labels.
    // Outside it they are ordinary members who may write to each other like anybody else —
    // asking somebody for a role-play by message is the platform working, and two accounts
    // happening to share a Blind-Date is no reason to prevent it.
    //
    // The cost was weighed and accepted: a member who suspects who their partner is could write
    // to that person and compare. Neither of them knows the other is the same person, so neither
    // notices the comparison being made — and the guard against a real name reaching the group
    // is the masking, not this refusal.
    if (
      await BlockService.isBlockedBetween(user.id, userId) ||
      await BanService.isBanned(userId)
    ) {
      return c.json(
        { error: "Contact is not possible" },
        STATUS_CODE.Forbidden,
      );
    }

    /**
     * **In eine Rundmail lädt man niemanden ein.**
     *
     * Dort sitzt nur das Mitglied, und genau das ist die Zusage: Niemand sieht die Antwort eines
     * anderen. Wer hier eine dritte Person hineinholte, gäbe ihr den ganzen Verlauf zu lesen — und
     * für das Team sähe ein Rundmail-Gespräch plötzlich aus wie eines mit zwei Mitgliedern.
     *
     * Die Oberfläche zeigt den Knopf dort nicht. Das ist ein Vorschlag; verbindlich ist das hier.
     */
    const chat = await ChatGroupService.selectChatGroup(user, chatId);

    if (chat?.isFromAdministration === true) {
      return c.json(
        { error: "Zu einer Rundmail lässt sich niemand einladen." },
        STATUS_CODE.Forbidden,
      );
    }

    /**
     * **Bei Admin nimmt niemand an, also wird aus der Einladung keine.**
     *
     * Das Konto der Administration existiert und wird angeschrieben, aber es meldet sich kaum
     * jemand darin an — eine Einladung bliebe für immer offen, und die Nachricht käme nie an.
     * Wer Admin benennt, sagt damit „ich will der Administration schreiben", und die Antwort
     * darauf ist der Faden, der diese Unterhaltung *ist*. Liegen dort schon Rundmails, liegen sie
     * gleich mit darin.
     *
     * Für das Mitglied ändert sich nichts: Es legt ein Gespräch an und benennt Admin wie jedes
     * andere Konto. Die Umleitung passiert hier, nicht in seinem Kopf.
     *
     * Wer die Administration in einen Raum holen will, in dem schon jemand sitzt oder geschrieben
     * wurde, bekommt ein Nein — siehe `isTheAdministration`.
     */
    if (await isTheAdministration(userId)) {
      const opened = await AdminInboxService.openThreadInsteadOfInviting(
        user.id,
        chatId,
      );

      if (opened.ok) {
        return c.json({ chatGroupId: opened.chatGroupId }, STATUS_CODE.OK);
      }

      return c.json(
        {
          error: opened.reason === "not_a_fresh_chat"
            ? "Admin lässt sich nicht in ein Gespräch holen. Leg ein neues an, um der Administration zu schreiben."
            : "Die Administration ist gerade nicht erreichbar.",
        },
        STATUS_CODE.Forbidden,
      );
    }

    const invitation = await UserInChatGroupService.insertInvitation(
      chatId,
      userId,
      user.id,
    );

    if (invitation === undefined) {
      return c.json(
        { error: "The user is already invited to or in the chat" },
        STATUS_CODE.Conflict,
      );
    }

    return c.json(invitation, STATUS_CODE.Created);
  },
);
