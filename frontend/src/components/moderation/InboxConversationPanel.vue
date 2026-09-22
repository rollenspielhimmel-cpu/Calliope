<script setup lang="ts">
/**
 * Ein aufgeschlagenes Gespräch im Postfach: der Verlauf, „Erledigt", die Ordner und die Antwort.
 *
 * Aus der Liste und aus einem Ordner heraus dasselbe Bauteil — sonst gäbe es zwei Fassungen, und
 * eine davon könnte bald weniger als die andere.
 *
 * **Ein angefangener Text gehört zu dem Gespräch, in dem er getippt wurde.** Die Ansicht setzt das
 * Bauteil je Gespräch neu, damit er beim Wechseln nicht stehen bleibt und versehentlich an jemand
 * anderen geht.
 */
import { computed, ref } from 'vue'
import {
  getListAdminInboxQueryKey,
  useAddToAdminInboxFolder,
  useMarkAdminInboxConversationDone,
  useReadAdminInboxConversation,
  useRemoveFromAdminInboxFolder,
  useReopenAdminInboxConversation,
  useReplyInAdminInbox,
} from '@/api/moderation/moderation'
import type { ListAdminInbox200ResultsItem, ListAdminInboxFolders200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import TeamConversation from '@/components/moderation/TeamConversation.vue'
import InboxFolderPicker from '@/components/moderation/InboxFolderPicker.vue'
import Textarea from '@/components/ui/textarea/Textarea.vue'
import Button from '@/components/ui/button/Button.vue'

const props = defineProps<{
  chatGroupId: string
  /** Die Zeile aus der Liste, wenn es eine gibt — daraus kommen „offen" und „erledigt". */
  entry?: ListAdminInbox200ResultsItem
  folders: ListAdminInboxFolders200Item[]
}>()

const { data } = useReadAdminInboxConversation(() => props.chatGroupId)

const conversation = computed(() => (data.value?.status === 200 ? data.value.data : undefined))

const messagePlaces = (messageId: string) =>
  conversation.value?.folderPlaces.messages.filter((place) => place.messageId === messageId) ?? []

const draft = ref<string>('')
const error = ref<string | undefined>(undefined)

/** Alles unter dem Postfach auf einmal: Liste, Gespräch, Ordner und was darin liegt. */
async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListAdminInboxQueryKey() })
}

async function attempt(action: () => Promise<unknown>, fallback: string) {
  error.value = undefined
  try {
    await action()
  } catch (failure) {
    error.value = failureMessage(failure, fallback)
    return false
  }
  await refresh()
  return true
}

const { mutateAsync: sendReply, isPending: isSending } = useReplyInAdminInbox()
const { mutateAsync: markDone, isPending: isMarking } = useMarkAdminInboxConversationDone()
const { mutateAsync: reopen, isPending: isReopening } = useReopenAdminInboxConversation()
const { mutateAsync: addToFolder, isPending: isAdding } = useAddToAdminInboxFolder()
const { mutateAsync: removeFromFolder, isPending: isRemoving } = useRemoveFromAdminInboxFolder()

const busy = computed(
  () => isMarking.value || isReopening.value || isAdding.value || isRemoving.value,
)

/**
 * Schickt die Antwort ab.
 *
 * **Das Feld wird erst nach dem Erfolg geleert, nicht davor.** Andersherum ist der Text weg, wenn
 * die Anfrage scheitert, und niemand tippt ihn ein zweites Mal.
 */
async function submitReply() {
  const text = draft.value.trim()
  if (text.length === 0) {
    return
  }
  if (
    await attempt(
      () => sendReply({ chatGroupId: props.chatGroupId, data: { text } }),
      'Das ging nicht. Versuch es noch einmal.',
    )
  ) {
    draft.value = ''
  }
}

const done = () =>
  attempt(
    () => markDone({ chatGroupId: props.chatGroupId }),
    'Das ging nicht. Versuch es noch einmal.',
  )

const undo = () =>
  attempt(
    () => reopen({ chatGroupId: props.chatGroupId }),
    'Das ging nicht. Versuch es noch einmal.',
  )

const add = (folderId: string, target: { chatGroupId: string } | { chatMessageId: string }) =>
  attempt(() => addToFolder({ folderId, data: target }), 'Das ließ sich nicht einsortieren.')

const remove = (itemId: string) =>
  attempt(() => removeFromFolder({ itemId }), 'Das ließ sich nicht herausnehmen.')
</script>

<template>
  <div v-if="conversation" class="flex flex-col gap-3">
    <TeamConversation :messages="conversation.messages">
      <template #message-actions="{ message }">
        <InboxFolderPicker
          v-if="folders.length > 0"
          class="mt-1"
          :folders="folders"
          :places="messagePlaces(message.id)"
          what="Nachricht"
          :disabled="busy"
          @add="(folderId) => add(folderId, { chatMessageId: message.id })"
          @remove="remove"
        />
      </template>
    </TeamConversation>

    <div
      class="flex max-w-[70ch] flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-line-4 pl-3"
    >
      <!-- Erledigt, ohne zu antworten — etwa bei einem „Danke". Schreibt das Mitglied danach
           wieder, ist es von selbst offen. -->
      <Button
        v-if="entry?.isOpen"
        type="button"
        variant="outline"
        size="sm"
        :disabled="busy"
        @click="done"
      >
        Erledigt
      </Button>
      <template v-else-if="entry?.markedDoneByUsername || entry?.markedDoneAt">
        <span class="text-[12px] text-ink-5">
          Erledigt von {{ entry.markedDoneByUsername ?? 'einem gelöschten Konto' }}
          <template v-if="entry.markedDoneAt">
            · {{ formatActivityTime(entry.markedDoneAt) }}</template
          >
        </span>
        <Button type="button" variant="ghost" size="sm" :disabled="busy" @click="undo">
          Wieder öffnen
        </Button>
      </template>

      <InboxFolderPicker
        v-if="folders.length > 0"
        :folders="folders"
        :places="conversation.folderPlaces.conversation"
        what="Gespräch"
        :disabled="busy"
        @add="(folderId) => add(folderId, { chatGroupId })"
        @remove="remove"
      />
    </div>

    <form
      class="flex max-w-[70ch] flex-col gap-2 border-l-2 border-line-4 pl-3"
      @submit.prevent="submitReply"
    >
      <Textarea
        v-model="draft"
        :aria-label="`Antwort an ${conversation.username ?? 'das Mitglied'}`"
        placeholder="Antwort schreiben"
        :maxlength="TEXT_LIMIT.replyInAdminInbox.text.maxLength"
        rows="3"
      />

      <!-- Einmal gesagt, an der Stelle, an der es zählt: Wer hier tippt, tippt nicht unter
           seinem Namen. Ohne den Satz merkt man das erst, wenn es draußen ist. -->
      <p class="text-[12px] text-ink-6">
        Geht raus als {{ conversation.senderUsername ?? 'die Administration' }}. Das Mitglied sieht
        ein gewöhnliches Gespräch und nicht, wer geschrieben hat.
      </p>

      <p v-if="error" class="text-[12px] text-ink-3" role="alert">{{ error }}</p>

      <Button
        type="submit"
        variant="outline"
        class="self-start"
        :disabled="isSending || draft.trim().length === 0"
      >
        {{ isSending ? 'Wird gesendet …' : 'Antwort senden' }}
      </Button>
    </form>
  </div>
</template>
