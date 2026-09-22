<script setup lang="ts">
/**
 * Das Postfach der Administration: der eine Ort für alles, was an sie gerichtet ist.
 *
 * **Wozu.** Die Antworten auf Rundmails lagen je Rundmail vor — wer wissen wollte, ob etwas
 * zurückgekommen ist, musste Rundmail für Rundmail nachsehen. Was man nachsehen muss, geht unter.
 *
 * **Offen und erledigt.** Offen ist, was noch jemand bearbeiten muss: Das Mitglied hat zuletzt
 * geschrieben, und seitdem hat niemand geantwortet oder „Erledigt" gesagt. Schreibt es danach
 * wieder, ist das Gespräch von selbst offen — das entscheidet der Server aus dem Verlauf.
 *
 * **Ordner zum Aufbewahren**, unabhängig davon: ganze Gespräche oder einzelne Nachrichten, flach,
 * in einer Reihenfolge für alle Admins.
 *
 * **Ein Verlauf je Mitglied und Absender.** Deshalb steht der Absender in jeder Zeile: Ein Mitglied
 * kann hier zweimal auftauchen.
 *
 * **Kein Zähler in der Liste.** Was offen ist, sagt sein Wort; wie viele es sind, beantwortet keine
 * Frage, auf die jemand handelt. Die Zahl auf der Moderationskachel ist etwas anderes — die sagt,
 * ob sich das Herkommen lohnt.
 */
import { computed, ref, watch } from 'vue'
import {
  getListAdminInboxQueryKey,
  useListAdminInbox,
  useListAdminInboxFolderItems,
  useListAdminInboxFolders,
  useRemoveFromAdminInboxFolder,
} from '@/api/moderation/moderation'
import type {
  ListAdminInbox200ResultsItem,
  ListAdminInboxFolderItems200Item,
  ListAdminInboxFolders200Item,
} from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import { failureMessage } from '@/lib/format/failure'
import { queryClient } from '@/lib/api/queryClient'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import InboxConversationPanel from '@/components/moderation/InboxConversationPanel.vue'
import InboxFolderManager from '@/components/moderation/InboxFolderManager.vue'

type View =
  | { kind: 'open' }
  | { kind: 'done' }
  | { kind: 'folder'; folderId: string }
  | { kind: 'manage' }

const view = ref<View>({ kind: 'open' })

/** Welche Zeile aufgeklappt ist. In einem Ordner kann dasselbe Gespräch zweimal stehen. */
const openRow = ref<string | undefined>(undefined)

watch(view, () => {
  openRow.value = undefined
})

function toggle(rowKey: string) {
  openRow.value = openRow.value === rowKey ? undefined : rowKey
}

const { data, isPending } = useListAdminInbox()

const conversations = computed<ListAdminInbox200ResultsItem[]>(() =>
  data.value?.status === 200 ? data.value.data.results : [],
)

const shown = computed(() =>
  conversations.value.filter((entry) =>
    view.value.kind === 'open' ? entry.isOpen : !entry.isOpen,
  ),
)

const entryOf = (chatGroupId: string) =>
  conversations.value.find((entry) => entry.chatGroupId === chatGroupId)

const { data: folderData } = useListAdminInboxFolders()

const folders = computed<ListAdminInboxFolders200Item[]>(() =>
  folderData.value?.status === 200 ? folderData.value.data : [],
)

const currentFolderId = computed<string | undefined>(() =>
  view.value.kind === 'folder' ? view.value.folderId : undefined,
)

// Ein gelöschter Ordner, der gerade offen war: zurück zu „Offen", statt ins Leere zu zeigen.
watch(folders, (list) => {
  const folderId = currentFolderId.value
  if (
    folderId !== undefined &&
    folderData.value?.status === 200 &&
    !list.some((one) => one.id === folderId)
  ) {
    view.value = { kind: 'open' }
  }
})

const { data: itemData } = useListAdminInboxFolderItems(
  // Der Haken ist nur aktiv, wenn ein Ordner gewählt ist; der Platzhalter wird nie abgefragt.
  () => currentFolderId.value ?? '00000000-0000-7000-8000-000000000000',
  { query: { enabled: computed(() => currentFolderId.value !== undefined) } },
)

const items = computed<ListAdminInboxFolderItems200Item[]>(() =>
  itemData.value?.status === 200 ? itemData.value.data : [],
)

const { mutateAsync: removeFromFolder, isPending: isRemoving } = useRemoveFromAdminInboxFolder()
const error = ref<string | undefined>(undefined)

async function takeOut(itemId: string) {
  error.value = undefined
  try {
    await removeFromFolder({ itemId })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ließ sich nicht herausnehmen.')
    return
  }
  await queryClient.invalidateQueries({ queryKey: getListAdminInboxQueryKey() })
}

const isView = (kind: View['kind'], folderId?: string) =>
  view.value.kind === kind && (folderId === undefined || currentFolderId.value === folderId)

/** Ohne „erledigt von" war es eine Antwort, die es erledigt hat. */
function doneNote(entry: ListAdminInbox200ResultsItem): string {
  if (entry.isOpen) return 'offen'
  if (entry.markedDoneAt !== null) {
    return `erledigt von ${entry.markedDoneByUsername ?? 'einem gelöschten Konto'}`
  }
  return 'beantwortet'
}
</script>

<template>
  <ModerationPage
    title="Postfach"
    description="Was an die Administration geschrieben wurde — Antworten auf Rundmails und Nachrichten an sie."
  >
    <nav class="mb-4 flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Postfach">
      <button
        type="button"
        class="rounded-full px-3 py-1 text-[13px]"
        :class="isView('open') ? 'bg-paper-3 text-ink-1' : 'text-ink-4 hover:text-oak-deep'"
        :aria-pressed="isView('open')"
        @click="view = { kind: 'open' }"
      >
        Offen
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-[13px]"
        :class="isView('done') ? 'bg-paper-3 text-ink-1' : 'text-ink-4 hover:text-oak-deep'"
        :aria-pressed="isView('done')"
        @click="view = { kind: 'done' }"
      >
        Erledigt
      </button>

      <span v-if="folders.length > 0" class="mx-2 h-4 w-px bg-line-3" aria-hidden="true" />

      <button
        v-for="folder in folders"
        :key="folder.id"
        type="button"
        class="rounded-full px-3 py-1 text-[13px]"
        :class="
          isView('folder', folder.id) ? 'bg-paper-3 text-ink-1' : 'text-ink-4 hover:text-oak-deep'
        "
        :aria-pressed="isView('folder', folder.id)"
        @click="view = { kind: 'folder', folderId: folder.id }"
      >
        {{ folder.title }}
      </button>

      <button
        type="button"
        class="ml-auto px-2 py-1 text-[12px]"
        :class="isView('manage') ? 'text-ink-1' : 'text-ink-5 hover:text-oak-deep'"
        :aria-pressed="isView('manage')"
        @click="view = { kind: 'manage' }"
      >
        Ordner verwalten
      </button>
    </nav>

    <InboxFolderManager v-if="view.kind === 'manage'" :folders="folders" />

    <template v-else-if="view.kind === 'folder'">
      <p v-if="items.length === 0" class="max-w-[70ch] text-[13px] text-ink-5">
        Dieser Ordner ist leer. Ein Gespräch oder eine einzelne Nachricht legst du beim Aufklappen
        über „In Ordner legen“ hinein.
      </p>

      <ul v-else class="flex flex-col">
        <li v-for="item in items" :key="item.id" class="border-t border-line-2 py-2">
          <div class="flex items-start gap-3">
            <button
              type="button"
              class="flex flex-1 flex-col items-start text-left"
              @click="toggle(item.id)"
            >
              <span class="text-[13px] text-ink-3">
                {{ item.username ?? 'Gelöschtes Konto' }}
                <span class="text-ink-6">
                  · {{ item.senderUsername ?? 'Gelöschter Absender' }} ·
                  {{ item.kind === 'message' ? 'eine Nachricht' : 'das ganze Gespräch' }}
                </span>
              </span>
              <template v-if="item.kind === 'message'">
                <span class="mt-0.5 text-[12px] text-ink-6">
                  {{
                    item.message.fromTeam
                      ? 'Team'
                      : (item.message.authorUsername ?? 'Gelöschtes Konto')
                  }}
                  · {{ formatActivityTime(item.message.createdAt) }}
                </span>
                <span class="mt-0.5 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-3">{{
                  item.message.text
                }}</span>
              </template>
              <span class="mt-0.5 text-[12px] text-ink-6">
                Eingelegt von {{ item.addedByUsername ?? 'einem gelöschten Konto' }},
                {{ formatActivityTime(item.addedAt) }}
              </span>
            </button>
            <button
              type="button"
              class="min-h-11 shrink-0 text-[12px] text-ink-5 hover:text-oak-deep md:min-h-0"
              :disabled="isRemoving"
              @click="takeOut(item.id)"
            >
              Aus dem Ordner nehmen
            </button>
          </div>

          <InboxConversationPanel
            v-if="openRow === item.id"
            :key="item.chatGroupId"
            class="mt-2"
            :chat-group-id="item.chatGroupId"
            :entry="entryOf(item.chatGroupId)"
            :folders="folders"
          />
        </li>
      </ul>

      <p v-if="error" class="mt-2 text-[12px] text-destructive" role="alert">{{ error }}</p>
    </template>

    <template v-else>
      <p v-if="isPending" class="text-[12px] text-ink-6">Wird geladen …</p>

      <p v-else-if="conversations.length === 0" class="max-w-[70ch] text-[13px] text-ink-5">
        Hier ist nichts. Sobald jemand der Administration schreibt oder auf eine Rundmail antwortet,
        steht es an dieser Stelle.
      </p>

      <p v-else-if="shown.length === 0" class="max-w-[70ch] text-[13px] text-ink-5">
        {{ view.kind === 'open' ? 'Nichts ist offen.' : 'Noch nichts erledigt.' }}
      </p>

      <ul v-else class="flex flex-col">
        <li v-for="entry in shown" :key="entry.chatGroupId" class="border-t border-line-2 py-2">
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
              <span :class="entry.isOpen ? 'text-oak-deep' : 'text-ink-6'">
                · {{ doneNote(entry) }}</span
              >
            </span>
            <!-- Beim Aufklappen weg: Die Nachricht steht dann direkt darunter im Verlauf, und bei
                 einem Gespräch mit nur einer Nachricht liest sich das doppelt wie ein Fehler. -->
            <span
              v-if="openRow !== entry.chatGroupId"
              class="mt-0.5 max-w-[70ch] text-[12.5px] text-ink-5"
              >{{ entry.excerpt }}</span
            >
          </button>

          <InboxConversationPanel
            v-if="openRow === entry.chatGroupId"
            :key="entry.chatGroupId"
            class="mt-2"
            :chat-group-id="entry.chatGroupId"
            :entry="entry"
            :folders="folders"
          />
        </li>
      </ul>
    </template>
  </ModerationPage>
</template>
