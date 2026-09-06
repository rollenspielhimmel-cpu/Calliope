<script setup lang="ts">
/**
 * Das Postfach der Administration: der eine Ort für alles, was an sie gerichtet ist.
 *
 * **Wozu.** Die Antworten auf Rundmails lagen je Rundmail vor — wer wissen wollte, ob etwas
 * zurückgekommen ist, musste Rundmail für Rundmail nachsehen. Was man nachsehen muss, geht unter.
 *
 * **Die Liste unter „Gesendete" bleibt trotzdem stehen**, und das ist kein Widerspruch. Sie
 * beantwortet, was dieses Postfach nicht kann: „Ist diese eine Ankündigung angekommen." Zwei Orte
 * werden erst dann zum Problem, wenn beide zum *Handeln* einladen — geantwortet wird nur hier.
 *
 * **Kein Zähler in der Liste.** Was offen ist, steht oben und trägt eine Kante; wie viele es sind,
 * beantwortet keine Frage, auf die jemand handelt.
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useListAdminInbox, useReadAdminInboxConversation } from '@/api/moderation/moderation'
import { formatActivityTime } from '@/lib/format/formatTime'
import TeamConversation from '@/components/moderation/TeamConversation.vue'
import ModerationPage from '@/components/moderation/ModerationPage.vue'

const route = useRoute()

/**
 * Aufgeschlagen, wenn die Adresse ein Gespräch nennt.
 *
 * Unter „Gesendete" steht bei jeder Antwort ein Verweis hierher. Ohne ihn wäre „ich will darauf
 * antworten" dort eine Sackgasse: Man sieht die Antwort, das Feld steht woanders, und niemand sagt
 * einem, wo.
 *
 * Nur beim Aufschlagen gelesen und danach nicht mehr — wer hier weiterklickt, soll nicht bei jedem
 * Klick zurück auf das Gespräch aus der Adresse springen.
 */
const openConversation = ref<string | undefined>(
  typeof route.query.conversation === 'string' ? route.query.conversation : undefined,
)

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

function toggle(chatGroupId: string) {
  openConversation.value = openConversation.value === chatGroupId ? undefined : chatGroupId
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
            <span class="text-ink-6">· {{ formatActivityTime(entry.lastMessageAt) }}</span>
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

        <TeamConversation
          v-if="openConversation === entry.chatGroupId && conversation"
          class="mt-2"
          :messages="conversation.messages"
        />
      </li>
    </ul>
  </ModerationPage>
</template>
