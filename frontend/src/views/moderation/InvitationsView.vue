<script setup lang="ts">
/**
 * Two lists that look like one question and are not: who is stuck at the verification wall, and
 * whose invitations actually brought somebody in.
 *
 * An invitation that was merely opened counts for nothing here — only a confirmed address makes
 * somebody a member, so that is what is counted.
 */
import { computed, ref } from 'vue'
import {
  useListInviters,
  useListPendingInvitations,
  useSendVerificationReminder,
} from '@/api/moderation/moderation'
import type { ListInviters200Item, ListPendingInvitations200Item } from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import { pluralize } from '@/lib/format/formatText'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const { data: pendingData, isPending } = useListPendingInvitations()
const { data: inviterData } = useListInviters()

const pending = computed<ListPendingInvitations200Item[]>(() =>
  pendingData.value?.status === 200 ? pendingData.value.data : [],
)

const inviters = computed<ListInviters200Item[]>(() =>
  inviterData.value?.status === 200 ? inviterData.value.data : [],
)

const reminded = ref<Set<string>>(new Set())
const error = ref<string | undefined>(undefined)

const { mutateAsync: remind, isPending: isSending } = useSendVerificationReminder()

async function sendReminder(userId: string) {
  error.value = undefined

  try {
    await remind({ userId })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  // Kept locally rather than refetched: nothing about the account changes, so the list would
  // come back identical and the button would look as though it had done nothing.
  reminded.value = new Set(reminded.value).add(userId)
}
</script>

<template>
  <ModerationPage
    title="Einladungen"
    description="Wer noch vor der Bestätigung steht, und wessen Einladungen tatsächlich angekommen sind."
  >
    <section>
      <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
        Warten auf die Bestätigung
      </h2>
      <p class="mt-2 max-w-[60ch] text-note text-ink-5">
        Diese Konten sind angemeldet, haben ihre E-Mail-Adresse aber nie bestätigt — sie kommen also
        nirgends hin. Meist ist es eine vertippte Adresse oder ein Spam-Ordner, das Längste zuerst.
      </p>

      <div v-if="isPending" class="mt-4 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <p v-else-if="pending.length === 0" class="mt-4 text-note text-ink-5">
        Zurzeit wartet niemand auf eine Bestätigung.
      </p>

      <ul v-else class="mt-4 flex flex-col">
        <li
          v-for="entry in pending"
          :key="entry.id"
          class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <RouterLink
              :to="{ name: 'member', params: { userId: entry.id } }"
              class="text-row text-oak-deep hover:underline"
            >
              {{ entry.username }}
            </RouterLink>

            <span v-if="reminded.has(entry.id)" class="text-[12px] text-ink-6">
              Erinnerung ist unterwegs
            </span>
            <Button
              v-else
              variant="ghost"
              size="xs"
              :disabled="isSending"
              @click="sendReminder(entry.id)"
            >
              Erinnerung senden
            </Button>
          </div>

          <p class="mt-1 font-mono text-[12px] text-ink-5">{{ entry.emailAddress }}</p>
          <p class="mt-1 text-[12px] text-ink-6">
            Angemeldet {{ formatActivityTime(entry.createdAt) }}
            <template v-if="entry.invitedBy">
              · eingeladen von {{ entry.invitedBy.username }}
            </template>
          </p>
        </li>
      </ul>
    </section>

    <section class="mt-10 border-t border-line-3 pt-6">
      <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
        Erfolgreiche Einladungen
      </h2>
      <p class="mt-2 max-w-[60ch] text-note text-ink-5">
        Wie viele Personen sich über den Einladungslink eines Mitglieds angemeldet
        <em>und</em> ihre Adresse bestätigt haben. Einen Link nur zu öffnen zählt nicht.
      </p>

      <p v-if="inviters.length === 0" class="mt-4 text-note text-ink-5">
        Bisher hat niemand über einen Einladungslink jemanden hergebracht.
      </p>

      <ul v-else class="mt-4 flex flex-col">
        <li
          v-for="inviter in inviters"
          :key="inviter.id"
          class="flex flex-wrap items-baseline justify-between gap-2 border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
        >
          <RouterLink
            :to="{ name: 'member', params: { userId: inviter.id } }"
            class="text-row text-oak-deep hover:underline"
          >
            {{ inviter.username }}
          </RouterLink>
          <span class="text-[12px] text-ink-5">
            {{ pluralize(inviter.arrived, 'Mitglied', 'Mitglieder') }}
            <template v-if="inviter.pending > 0">
              · {{ inviter.pending }} noch unbestätigt
            </template>
          </span>
        </li>
      </ul>
    </section>

    <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </ModerationPage>
</template>
