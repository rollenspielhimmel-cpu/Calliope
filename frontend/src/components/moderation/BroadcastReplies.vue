<script setup lang="ts">
/**
 * Wer auf eine Rundmail geantwortet hat, und was — und die Antwort der Administration darauf.
 *
 * **Die Antworten hängen an der Rundmail, nicht an einem Konto.** Antwortete jemand dem Ur-Admin,
 * läge die Antwort in einem Postfach, in das niemand sieht; antwortete er einer Kunstfigur, in
 * einem, das es nur an Weihnachten gibt. Also liest das Team sie hier.
 *
 * **Zurückgeschrieben wird unter dem Absender, unter dem die Rundmail lief.** Für das Mitglied ist
 * es ein gewöhnliches Gespräch, und wer wirklich getippt hat, erfährt es nicht — festgehalten ist
 * es trotzdem, in `written_by`. Diese Datei entscheidet davon nichts: Der Server liest den Absender
 * vom Gespräch ab, damit mitten in einem Verlauf nicht plötzlich ein anderer Name steht.
 *
 * Aufgeklappt statt sofort geladen: Die meisten Rundmails bekommen keine Antwort, und eine Anfrage
 * je gesendeter Rundmail beim Öffnen der Liste wäre Arbeit für nichts.
 */
import { computed, ref } from 'vue'
import {
  getListBroadcastRepliesQueryKey,
  getReadBroadcastConversationQueryKey,
  useListBroadcastReplies,
  useReadBroadcastConversation,
  useReplyToBroadcast,
} from '@/api/moderation/moderation'
import { formatActivityTime } from '@/lib/format/formatTime'
import { failureMessage } from '@/lib/format/failure'
import { queryClient } from '@/lib/api/queryClient'
import { TEXT_LIMIT } from '@/api/textLimit'
import TeamConversation from '@/components/moderation/TeamConversation.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Button from '@/components/ui/button/Button.vue'

const { broadcastId } = defineProps<{ broadcastId: string }>()

const open = ref<boolean>(false)
const openConversation = ref<string | undefined>(undefined)

const draft = ref<string>('')
const error = ref<string | undefined>(undefined)

const { data: repliesData, isPending } = useListBroadcastReplies(() => broadcastId, {
  query: { enabled: computed(() => open.value) },
})

const replies = computed(() =>
  repliesData.value?.status === 200 ? repliesData.value.data.results : [],
)

const { data: conversationData } = useReadBroadcastConversation(
  () => broadcastId,
  // Der Haken ist nur aktiv, wenn eine Kennung dasteht; der Platzhalter wird nie abgefragt.
  () => openConversation.value ?? broadcastId,
  { query: { enabled: computed(() => openConversation.value !== undefined) } },
)

const conversation = computed(() =>
  conversationData.value?.status === 200 ? conversationData.value.data : undefined,
)

const { mutateAsync: sendReply, isPending: isSending } = useReplyToBroadcast()

function toggleConversation(chatGroupId: string) {
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
    await sendReply({ broadcastId, chatGroupId, data: { text } })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht. Versuch es noch einmal.')
    return
  }

  draft.value = ''

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: getReadBroadcastConversationQueryKey(broadcastId, chatGroupId),
    }),
    // Auch die Liste: Dort steht, wann zuletzt etwas geschrieben wurde, und das war gerade jetzt.
    queryClient.invalidateQueries({ queryKey: getListBroadcastRepliesQueryKey(broadcastId) }),
  ])
}
</script>

<template>
  <div class="mt-2">
    <button
      type="button"
      class="flex min-h-11 items-center text-[12px] text-ink-5 hover:text-oak-deep md:min-h-0"
      @click="open = !open"
    >
      {{ open ? 'Antworten ausblenden' : 'Antworten' }}
    </button>

    <template v-if="open">
      <p v-if="isPending" class="mt-1 text-[12px] text-ink-6">Wird geladen …</p>

      <!-- Keine Zahl, keine Marke: „wie viele haben geantwortet" ist nichts, worauf jemand
           handelt, und Zähler kommen in dieser Oberfläche nicht vor. -->
      <p v-else-if="replies.length === 0" class="mt-1 text-[12px] text-ink-6">
        Auf diese Rundmail hat noch niemand geantwortet.
      </p>

      <ul v-else class="mt-1 flex flex-col">
        <li v-for="reply in replies" :key="reply.chatGroupId" class="border-t border-line-2 py-2">
          <button
            type="button"
            class="flex w-full flex-col items-start text-left"
            @click="toggleConversation(reply.chatGroupId)"
          >
            <span class="text-[12.5px] text-ink-3">
              {{ reply.username ?? 'Gelöschtes Konto' }}
              <span class="text-ink-6">· {{ formatActivityTime(reply.lastReplyAt) }}</span>
            </span>
            <!-- Beim Aufklappen weg: Die Nachricht steht dann im Verlauf direkt darunter. -->
            <span
              v-if="openConversation !== reply.chatGroupId"
              class="mt-0.5 max-w-[70ch] text-[12px] text-ink-5"
              >{{ reply.excerpt }}</span
            >
          </button>

          <!-- **Der Weg zum Arbeiten.** Gelesen wird an beiden Orten, gearbeitet nur im Postfach —
               ohne diesen Verweis wäre „ich will darauf antworten" hier eine Sackgasse. -->
          <RouterLink
            :to="{ name: 'moderationInbox', query: { conversation: reply.chatGroupId } }"
            class="mt-1 inline-flex min-h-11 items-center text-[12px] text-ink-5 hover:text-oak-deep md:min-h-0"
          >
            Im Postfach öffnen
          </RouterLink>

          <template v-if="openConversation === reply.chatGroupId && conversation">
            <!-- Dasselbe Bauteil wie im Postfach der Administration: Zwei Fassungen desselben
                 Verlaufs driften auseinander, sobald jemand nur eine anfasst. -->
            <TeamConversation class="mt-2" :messages="conversation.messages" />

            <form
              class="mt-2 flex max-w-[70ch] flex-col gap-2 border-l-2 border-line-4 pl-3"
              @submit.prevent="submitReply(reply.chatGroupId)"
            >
              <Textarea
                v-model="draft"
                :aria-label="`Antwort an ${reply.username ?? 'das Mitglied'}`"
                placeholder="Antwort schreiben"
                :maxlength="TEXT_LIMIT.replyToBroadcast.text.maxLength"
                rows="3"
              />

              <!-- Einmal gesagt, an der Stelle, an der es zählt: Wer hier tippt, tippt nicht unter
                   seinem Namen. Ohne den Satz merkt man das erst, wenn es draußen ist. -->
              <p class="text-[12px] text-ink-6">
                Geht raus unter dem Absender der Rundmail. Das Mitglied sieht ein gewöhnliches
                Gespräch und nicht, wer geschrieben hat.
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
    </template>
  </div>
</template>
