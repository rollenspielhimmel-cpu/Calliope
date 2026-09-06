<script setup lang="ts">
/**
 * Wer auf eine Rundmail geantwortet hat, und was.
 *
 * **Die Antworten hängen an der Rundmail, nicht an einem Konto.** Antwortete jemand dem Ur-Admin,
 * läge die Antwort in einem Postfach, in das niemand sieht; antwortete er einer Kunstfigur, in
 * einem, das es nur an Weihnachten gibt. Also liest das Team sie hier.
 *
 * Lesen darf die ganze Moderation, antworten wird die Administration dürfen — das Antwortfeld
 * kommt mit dem nächsten Schritt.
 *
 * Aufgeklappt statt sofort geladen: Die meisten Rundmails bekommen keine Antwort, und eine Anfrage
 * je gesendeter Rundmail beim Öffnen der Liste wäre Arbeit für nichts.
 */
import { computed, ref } from 'vue'
import { useListBroadcastReplies, useReadBroadcastConversation } from '@/api/moderation/moderation'
import { formatActivityTime } from '@/lib/format/formatTime'

const { broadcastId } = defineProps<{ broadcastId: string }>()

const open = ref<boolean>(false)
const openConversation = ref<string | undefined>(undefined)

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

function toggleConversation(chatGroupId: string) {
  openConversation.value = openConversation.value === chatGroupId ? undefined : chatGroupId
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
              <span class="text-ink-6">· {{ formatActivityTime(reply.lastActivityAt) }}</span>
            </span>
            <span class="mt-0.5 max-w-[70ch] text-[12px] text-ink-5">{{ reply.excerpt }}</span>
          </button>

          <ul
            v-if="openConversation === reply.chatGroupId && conversation"
            class="mt-2 flex flex-col gap-2 border-l-2 border-line-4 pl-3"
          >
            <li v-for="message in conversation.messages" :key="message.id">
              <p class="text-[12px] text-ink-6">
                {{ message.fromTeam ? 'Team' : (message.username ?? 'Gelöschtes Konto') }} ·
                {{ formatActivityTime(message.createdAt) }}
              </p>
              <p class="max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-3">
                {{ message.text }}
              </p>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </div>
</template>
