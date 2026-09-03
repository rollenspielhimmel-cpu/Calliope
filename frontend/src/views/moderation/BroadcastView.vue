<script setup lang="ts">
/**
 * One message to a chosen audience. The count is shown before the button and the send asks for a
 * confirmation, because this is the one action here that cannot be taken back: a mail that has
 * left cannot be recalled, and there are hundreds of them.
 *
 * The writing surface is the one from the post composer — the same serif at the same size on the
 * same paper — but without its formatting toolbar. The mail is plain text, as every message this
 * platform sends is, so a toolbar would offer marks that the send would silently discard.
 */
import { computed, ref } from 'vue'
import { useCountBroadcastRecipients, useSendBroadcast } from '@/api/moderation/moderation'
import type { SendBroadcastBodyAudienceGroupsItem } from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { pluralize } from '@/lib/format/formatText'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type Group = SendBroadcastBodyAudienceGroupsItem

/** Ordered as somebody reads them: the team first, then everybody else. */
const GROUPS: ReadonlyArray<{ value: Group; label: string }> = [
  { value: 'administrator', label: 'Administration' },
  { value: 'moderator', label: 'Moderation' },
  { value: 'member', label: 'Mitglieder ohne Rolle' },
]

const chosen = ref<Group[]>(['administrator', 'moderator', 'member'])
const includeUnverified = ref<boolean>(false)
const subject = ref<string>('')
const body = ref<string>('')
const confirming = ref<boolean>(false)
const sentTo = ref<number | undefined>(undefined)
const error = ref<string | undefined>(undefined)

function toggleGroup(group: Group, on: boolean) {
  chosen.value = on ? [...chosen.value, group] : chosen.value.filter((value) => value !== group)
}

const { data } = useCountBroadcastRecipients(
  computed(() => ({
    groups: chosen.value.join(','),
    includeUnverified: includeUnverified.value ? 'true' : 'false',
  })),
  // Asking for nobody is a 400, so the count waits until at least one group is chosen.
  { query: { enabled: computed(() => chosen.value.length > 0) } },
)

const recipients = computed<number | undefined>(() =>
  data.value?.status === 200 ? data.value.data.recipients : undefined,
)

const { mutateAsync: sendBroadcast, isPending } = useSendBroadcast()

const isComplete = computed<boolean>(
  () => chosen.value.length > 0 && subject.value.trim().length > 0 && body.value.trim().length > 0,
)

async function send() {
  error.value = undefined
  sentTo.value = undefined

  try {
    const answer = await sendBroadcast({
      data: {
        audience: { groups: chosen.value, includeUnverified: includeUnverified.value },
        subject: subject.value.trim(),
        body: body.value.trim(),
      },
    })
    sentTo.value = answer.status === 200 ? answer.data.recipients : undefined
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  confirming.value = false
  subject.value = ''
  body.value = ''
}
</script>

<template>
  <ModerationPage
    title="Rundmail"
    description="Eine Nachricht an das Team, an alle anderen, oder an alle zusammen. Reiner Text, wie jede andere Mail hier — gesperrte Konten bekommen sie nie."
  >
    <form class="flex max-w-[684px] flex-col gap-5" @submit.prevent="confirming = true">
      <FieldGroup>
        <Field>
          <FieldLabel>Empfänger</FieldLabel>
          <div class="flex flex-col gap-1">
            <label
              v-for="group in GROUPS"
              :key="group.value"
              class="flex min-h-11 items-center gap-2.5 text-[12.5px] text-ink-4 md:min-h-0 md:py-1"
            >
              <Checkbox
                :model-value="chosen.includes(group.value)"
                @update:model-value="(on) => toggleGroup(group.value, on === true)"
              />
              {{ group.label }}
            </label>

            <label
              class="mt-1 flex min-h-11 items-center gap-2.5 border-t border-line-3 pt-2 text-[12.5px] text-ink-4 md:min-h-0"
            >
              <Checkbox
                :model-value="includeUnverified"
                @update:model-value="(on) => (includeUnverified = on === true)"
              />
              Auch an unbestätigte Adressen
            </label>
          </div>

          <p class="text-control text-ink-5">
            <template v-if="chosen.length === 0">Wähle mindestens eine Gruppe.</template>
            <template v-else-if="recipients === undefined">Wird gezählt.</template>
            <template v-else>
              Das sind zurzeit {{ pluralize(recipients, 'Person', 'Personen') }}.
            </template>
            An unbestätigte Adressen zu schreiben heißt, an Postfächer zu schreiben, die niemandem
            nachweislich gehören.
          </p>
        </Field>

        <Field>
          <FieldLabel for="broadcastSubject">Betreff</FieldLabel>
          <Input
            id="broadcastSubject"
            v-model="subject"
            name="broadcastSubject"
            :maxlength="TEXT_LIMIT.sendBroadcast.subject.maxLength"
            autocomplete="off"
          />
        </Field>

        <Field>
          <FieldLabel for="broadcastBody">Nachricht</FieldLabel>
          <!-- The composer's writing surface: `prose-post` is the same serif at the same size the
               thread is read in, so a long message is written in the type it will be read in.
               Framed like a post edited in place, because it stands on ordinary paper here. -->
          <textarea
            id="broadcastBody"
            v-model="body"
            name="broadcastBody"
            :maxlength="TEXT_LIMIT.sendBroadcast.body.maxLength"
            rows="14"
            class="prose-post w-full resize-y rounded-lg border border-line-4 bg-paper-1 px-4 py-3 caret-oak outline-none focus-visible:border-line-5"
          ></textarea>
          <p class="text-control text-ink-5">
            Schreib die ganze Nachricht, mit Anrede und Gruß. Angehängt wird nur die Zeile, dass sie
            vom Team verschickt wurde. Formatierung gibt es nicht — was hier steht, kommt genau so
            an.
          </p>
        </Field>
      </FieldGroup>

      <div>
        <Button type="submit" :disabled="!isComplete || isPending">Weiter</Button>
      </div>
    </form>

    <!-- The one thing here that cannot be undone gets said in full before it happens. -->
    <div v-if="confirming" class="mt-6 max-w-[60ch] rounded-lg border border-line-4 bg-paper-1 p-4">
      <p class="text-row text-ink-2">
        Diese Nachricht geht an {{ pluralize(recipients ?? 0, 'Person', 'Personen') }}.
      </p>
      <p class="mt-1 text-[12.5px] text-ink-5">Verschickte Mails lassen sich nicht zurückholen.</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button :disabled="isPending" @click="send">
          <Spinner v-if="isPending" />
          Jetzt senden
        </Button>
        <Button variant="outline" :disabled="isPending" @click="confirming = false">
          Abbrechen
        </Button>
      </div>
    </div>

    <p v-if="sentTo !== undefined" class="mt-4 text-note text-ink-5" role="status">
      Die Nachricht ist an {{ pluralize(sentTo, 'Person', 'Personen') }} unterwegs.
    </p>

    <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </ModerationPage>
</template>
