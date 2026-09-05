import type { ListNotifications200ResultsItem } from '@/api/models'
import type { RouteLocationRaw } from 'vue-router'
import { assertUnreachable } from '@/lib/assertUnreachable'

/**
 * A notification is stored as the event, never as the sentence, so the sentence is written
 * here. Group and thread titles come from the response, joined at read time, which is why a
 * renamed group reads correctly in an old notification.
 */

/**
 * What the role lets you do, as a clause. The member list's labels („Admin", „Schreibt",
 * „Liest") are column headings and read badly mid-sentence — „geändert: Liest." Verbs also
 * keep this neutral, where a noun would force a guess at somebody's gender.
 */
const ROLE_CLAUSES: Record<string, string> = {
  administrator: 'Du verwaltest die Gruppe.',
  writer: 'Du schreibst mit.',
  reader: 'Du liest mit.',
}

/** The writing survives the account, so a notification about it has to as well. */
function actorOf(notification: ListNotifications200ResultsItem): string {
  return notification.actorUsername ?? 'Gelöschtes Konto'
}

export function notificationText(notification: ListNotifications200ResultsItem): string {
  const actor = actorOf(notification)

  // Narrowed by `type`, so each sentence can only reach for what its own kind carries.
  switch (notification.type) {
    case 'blind_date_matched':
      // **The one sentence here with no actor in it, and it must stay that way.** A Blind-Date is
      // arranged by the team, and naming anybody would answer the question the whole thing exists
      // to hold back — before the recipient has even opened it. The plot is named because that is
      // what somebody wants to know and it gives nothing away.
      return `Dein Blind-Date ist arrangiert: „${notification.writingGroupTitle}“. Wer mit dir schreibt, erfährst du erst, wenn ihr euch beide zu erkennen gebt.`
    case 'blind_date_ended':
      // Says that it ended and nothing about why. Whose slip it was belongs to that person, who
      // is told by mail — putting it here would set one member in front of the other.
      return `Dein Blind-Date „${notification.writingGroupTitle}“ wurde beendet. Die Gruppe und alles Geschriebene bleiben erhalten.`
    case 'blind_date_reveal_requested':
      // No actor here either: there is exactly one other person it could be, and naming them
      // would answer the question the reveal exists to ask together.
      return `In „${notification.writingGroupTitle}“ möchte sich die andere Person zu erkennen geben. Es passiert erst, wenn du es auch möchtest.`
    case 'invited_to_writing_group':
      return `${actor} hat dich zu „${notification.writingGroupTitle}“ eingeladen.`
    case 'invitation_accepted':
      return `${actor} ist „${notification.writingGroupTitle}“ beigetreten.`
    case 'visibility_changed_in_writing_group':
      // Named plainly, because it changes who can read what everybody has written.
      return notification.visibility === 'public'
        ? `${actor} hat „${notification.writingGroupTitle}“ öffentlich gemacht. Alle können jetzt mitlesen.`
        : `${actor} hat „${notification.writingGroupTitle}“ auf privat gestellt. Nur Mitglieder können mitlesen.`
    case 'role_changed_in_writing_group':
      return `${actor} hat deine Rolle in „${notification.writingGroupTitle}“ geändert: ${
        ROLE_CLAUSES[notification.role] ?? notification.role
      }`
    case 'new_writing_thread':
      return `${actor} hat das Thema „${notification.writingThreadTitle}“ in „${notification.writingGroupTitle}“ angelegt.`
    case 'new_writing_post':
      // Both names: somebody in several groups cannot place a thread title on its own.
      return `${actor} hat in „${notification.writingThreadTitle}“ in „${notification.writingGroupTitle}“ geschrieben.`
    case 'new_writing_page':
      return `${actor} hat die Seite „${notification.writingPageTitle}“ in „${notification.writingGroupTitle}“ angelegt.`
    case 'invited_to_chat_group':
      // The two invitations are different things and land in different places.
      return `${actor} hat dich zum Chat „${notification.chatGroupTitle}“ eingeladen.`
    case 'broadcast_received':
      // **Der Sprung wird angesagt.** Steht die Rundmail im Forum, führt das Anklicken dorthin, wo
      // womöglich schon jemand geantwortet hat — und in einem Faden zu landen, wenn man eine
      // Mitteilung erwartet hat, ist eine Überraschung, die ein halber Satz erspart.
      return notification.broadcastArchiveThreadId === null
        ? `Rundmail „${notification.broadcastSubject}“.`
        : `Rundmail „${notification.broadcastSubject}“ — im Forum ansehen.`
    default:
      return assertUnreachable(notification)
  }
}

/**
 * Where the notification takes you. Not a route in every case: a chat lives in the Chats
 * dialog rather than at a URL, so this is a verdict the caller acts on rather than something
 * that can be handed to `RouterLink`.
 */
export type NotificationAction =
  | { kind: 'route'; to: RouteLocationRaw }
  | { kind: 'chat'; chatGroupId: string }

export function notificationAction(
  notification: ListNotifications200ResultsItem,
): NotificationAction {
  switch (notification.type) {
    case 'new_writing_thread':
    case 'new_writing_post':
      return {
        kind: 'route',
        to: {
          name: 'thread',
          params: {
            groupId: notification.writingGroupId,
            threadId: notification.writingThreadId,
          },
        },
      }
    case 'new_writing_page':
      return {
        kind: 'route',
        to: {
          name: 'page',
          params: {
            groupId: notification.writingGroupId,
            pageId: notification.writingPageId,
          },
        },
      }
    case 'blind_date_matched':
    case 'blind_date_reveal_requested':
    case 'blind_date_ended':
    case 'invited_to_writing_group':
    case 'invitation_accepted':
    case 'visibility_changed_in_writing_group':
    case 'role_changed_in_writing_group':
      // An invitation lands on the group page, which is where accepting it lives — and so does a
      // Blind-Date, which is a group from the first moment.
      return {
        kind: 'route',
        to: { name: 'group', params: { groupId: notification.writingGroupId } },
      }
    case 'invited_to_chat_group':
      return { kind: 'chat', chatGroupId: notification.chatGroupId }
    case 'broadcast_received':
      // Der Text steht an genau einer Stelle: im Forum, wenn er dort abgelegt wurde, sonst auf
      // seiner eigenen Seite. Zwei Ziele, aber nie zwei Kopien.
      return notification.broadcastArchiveThreadId === null
        ? {
            kind: 'route',
            to: { name: 'broadcast', params: { broadcastId: notification.broadcastId } },
          }
        : {
            kind: 'route',
            to: {
              name: 'forumThread',
              params: { threadId: notification.broadcastArchiveThreadId },
            },
          }
    default:
      // A new notification type reaches here as a compile error, not a silent fallthrough to
      // some group page that may not be what it was about.
      return assertUnreachable(notification)
  }
}
