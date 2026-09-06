<script setup lang="ts">
/**
 * Das Postfach der Administration: der eine Ort für alles, was an sie gerichtet ist.
 *
 * **Wozu.** Die Antworten auf Rundmails lagen je Rundmail vor — wer wissen wollte, ob etwas
 * zurückgekommen ist, musste Rundmail für Rundmail nachsehen. Was man nachsehen muss, geht unter.
 *
 * **Ein Verlauf je Mitglied und Absender.** Ankündigungen, Antworten darauf und alles Weitere
 * stehen darin untereinander. Getrennt wird nur nach dem Namen, unter dem die Plattform spricht —
 * eine Kunstfigur ist ein anderer Gesprächspartner, und mitten im Verlauf darf der Name nicht
 * wechseln. Deshalb steht er in jeder Zeile: Ein Mitglied kann hier zweimal auftauchen.
 *
 * **Kein Zähler in der Liste.** Was offen ist, sagt sein Wort; wie viele es sind, beantwortet keine
 * Frage, auf die jemand handelt. Die Zahl auf der Moderationskachel ist etwas anderes — die sagt,
 * ob sich das Herkommen lohnt.
 */
import { computed, ref } from 'vue'
import {
  getListAdminInboxQueryKey,
  getReadAdminInboxConversationQueryKey,
  useListAdminInbox,
  useReadAdminInboxConversation,
  useReplyInAdminInbox,
} from '@/api/moderation/moderation'
import { formatActivityTime } from '@/lib/format/formatTime'
import { failureMessage } from '@/lib/format/failure'
import { queryClient } from '@/lib/api/queryClient'
import { TEXT_LIMIT } from '@/api/textLimit'
import TeamConversation from '@/components/moderation/TeamConversation.vue'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Button from '@/components/ui/button/Button.vue'

const openConversation = ref<string | undefined>(undefined)

const draft = ref<string>('')
const error = ref<string | undefined>(undefined)

const { data, isPending } = useListAdminInbox()

const conversations = computed(() => (data.value?.status === 200 ? data.value.data.results : []))

const { data: conversationData } = useReadAdminInboxConversation(
  // Der Haken ist nur aktiv, wenn eine Kennung dasteht; der Platzhalter wird nie abgefragt.
  () => openConversation.value ?? '00000000-0000-7000-8000-000000000000',
  { query: { enabled: computed(() => openConversation.value !== undefined) } },
)

const conversation = computed(() =>
  conversationData.value?.status === 200 ? conversationData.value.data : undefined,
)

const { mutateAsync: sendReply, isPending: isSending } = useReplyInAdminInbox()

function toggle(chatGroupId: string) {
  openConversation.value = openConversation.value === chatGroupId ? undefined : chatGroupId
  // Ein angefangener Text gehört zu dem Gespräch, in dem er getippt wurde. Ihn beim Wechseln
  // stehen zu lassen hieße, ihn versehentlich an jemand anderen zu schicken.
  draft.value = ''
  error.value = undefined
}

/**
 * Schickt die Antwort ab.
 *
 * **Das Feld wird erst nach dem Erfolg geleert, nicht davor.** Andersherum ist der Text weg, wenn
 * die Anfrage scheitert, und niemand tippt ihn ein zweites Mal.
 */
async function submitReply(chatGroupId: string) {
  const text = draft.value.trim()

  if (text.length === 0) {
    return
  }

  error.value = undefined

  try {
    await sendReply({ chatGroupId, data: { text } })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht. Versuch es noch einmal.')
    return
  }

  draft.value = ''

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: getReadAdminInboxConversationQueryKey(chatGroupId),
    }),
    // Auch die Liste: Dort steht, ob noch etwas offen ist, und das hat sich gerade geändert.
    queryClient.invalidateQueries({ queryKey: getListAdminInboxQueryKey() }),
  ])
}
</script>

<template>
  <ModerationPage
    title="Postfach"
    description="Was an die Administration geschrieben wurde — Antworten auf Rundmails und Nachrichten an sie."
  >
    <p v-if="isPending" class="text-[12px] text-ink-6">Wird geladen …</p>

    <p v-else-if="conversations.length === 0" class="max-w-[70ch] text-[13px] text-ink-5">
      Hier ist nichts. Sobald jemand der Administration schreibt oder auf eine Rundmail antwortet,
      steht es an dieser Stelle.
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="entry in conversations"
        :key="entry.chatGroupId"
        class="border-t border-line-2 py-2"
      >
        <button
          type="button"
          class="flex w-full flex-col items-start text-left"
          @click="toggle(entry.chatGroupId)"
        >
          <span class="text-[13px] text-ink-3">
            {{ entry.username ?? 'Gelöschtes Konto' }}
            <!-- Unter welchem Namen dieser Faden läuft. Ohne ihn stünde dasselbe Mitglied zweimal
                 gleich aussehend in der Liste, sobald eine Kunstfigur geschrieben hat. -->
            <span class="text-ink-6">
              · {{ entry.senderUsername ?? 'Gelöschter Absender' }} ·
              {{ formatActivityTime(entry.lastMessageAt) }}
            </span>
            <!-- Gesagt, nicht gezählt. „Offen" heißt: Die letzte Nachricht ist noch vom Mitglied —
                 kein Merker, den jemand pflegen muss, sondern eine Aussage über den Verlauf. -->
            <span v-if="entry.awaitingReply" class="text-oak-deep">· offen</span>
          </span>
          <!-- Beim Aufklappen weg: Die Nachricht steht dann direkt darunter im Verlauf, und bei
               einem Gespräch mit nur einer Nachricht liest sich das doppelt wie ein Fehler. -->
          <span
            v-if="openConversation !== entry.chatGroupId"
            class="mt-0.5 max-w-[70ch] text-[12.5px] text-ink-5"
            >{{ entry.excerpt }}</span
          >
        </button>

        <template v-if="openConversation === entry.chatGroupId && conversation">
          <TeamConversation class="mt-2" :messages="conversation.messages" />

          <form
            class="mt-2 flex max-w-[70ch] flex-col gap-2 border-l-2 border-line-4 pl-3"
            @submit.prevent="submitReply(entry.chatGroupId)"
          >
            <Textarea
              v-model="draft"
              :aria-label="`Antwort an ${entry.username ?? 'das Mitglied'}`"
              placeholder="Antwort schreiben"
              :maxlength="TEXT_LIMIT.replyInAdminInbox.text.maxLength"
              rows="3"
            />

            <!-- Einmal gesagt, an der Stelle, an der es zählt: Wer hier tippt, tippt nicht unter
                 seinem Namen. Ohne den Satz merkt man das erst, wenn es draußen ist. -->
            <p class="text-[12px] text-ink-6">
              Geht raus als {{ entry.senderUsername ?? 'die Administration' }}. Das Mitglied sieht
              ein gewöhnliches Gespräch und nicht, wer geschrieben hat.
            </p>

            <p v-if="error" class="text-[12px] text-ink-3">{{ error }}</p>

            <Button
              type="submit"
              variant="outline"
              class="self-start"
              :disabled="isSending || draft.trim().length === 0"
            >
              {{ isSending ? 'Wird gesendet …' : 'Antwort senden' }}
            </Button>
          </form>
        </template>
      </li>
    </ul>
  </ModerationPage>
</template>
