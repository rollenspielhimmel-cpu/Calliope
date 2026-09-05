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
import {
  getListBroadcastQueueQueryKey,
  getListReleasedBroadcastsQueryKey,
  useApproveBroadcast,
  useCountBroadcastRecipients,
  useDiscardBroadcast,
  useListBroadcastQueue,
  useListReleasedBroadcasts,
  useSubmitBroadcast,
} from '@/api/moderation/moderation'
import type {
  ListBroadcastQueue200Item,
  ListReleasedBroadcasts200Item,
  SubmitBroadcastBodyAudienceGroupsItem,
} from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { ApiError } from '@/lib/api/apiFetch'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { berlinToUtc, formatBerlin } from '@/lib/format/berlinTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { pluralize } from '@/lib/format/formatText'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import BroadcastSendersPanel from '@/components/moderation/BroadcastSendersPanel.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const tab = ref<string>('compose')

/**
 * No counts here. „Wie viele Absender es gibt" is not a number anybody acts on, and the design
 * rules keep counts for things still waiting to be done.
 */
const TABS: ModerationTab[] = [
  { value: 'compose', label: 'Schreiben' },
  { value: 'queue', label: 'Warteschlange' },
  { value: 'released', label: 'Gesendete' },
  { value: 'senders', label: 'Absender' },
]

type Group = SubmitBroadcastBodyAudienceGroupsItem

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
/**
 * Der Termin, wie er im Feld steht: Berliner Wanduhr, leer für „sobald freigegeben".
 *
 * Nach Europe/Berlin und nicht nach der Uhr des Geräts — wer aus dem Urlaub eine Ankündigung für
 * Sonntagabend einstellt, meint den deutschen Sonntagabend. Die Umrechnung steht in
 * `lib/format/berlinTime.ts`, samt der beiden Stunden im Jahr, die aus der Reihe fallen.
 */
const scheduledFor = ref<string>('')

const scheduledForUtc = computed<string | null>(() =>
  scheduledFor.value === '' ? null : berlinToUtc(scheduledFor.value),
)

const confirming = ref<boolean>(false)
const sentTo = ref<number | undefined>(undefined)
const scheduledAt = ref<string | undefined>(undefined)

/** Was beim Einreichen herauskam. Undefined, solange nichts eingereicht wurde. */
const outcome = ref<'sent' | 'scheduled' | 'waiting' | undefined>(undefined)
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

const { mutateAsync: submitBroadcast, isPending } = useSubmitBroadcast()

const isComplete = computed<boolean>(
  () => chosen.value.length > 0 && subject.value.trim().length > 0 && body.value.trim().length > 0,
)

/**
 * Eingereicht heißt nicht verschickt — außer beim Ur-Admin, der mit dem Schreiben freigibt.
 *
 * Was gerade geschehen ist, sagt deshalb die Antwort und nicht dieses Formular: `released` ging
 * raus, alles andere wartet. Eine Oberfläche, die das aus der eigenen Rolle erriete, läge an dem
 * Tag falsch, an dem sich die Regel ändert.
 */
async function submit() {
  error.value = undefined
  outcome.value = undefined
  sentTo.value = undefined
  scheduledAt.value = undefined

  try {
    const answer = await submitBroadcast({
      data: {
        subject: subject.value.trim(),
        body: body.value.trim(),
        audienceGroups: chosen.value,
        includeUnverified: includeUnverified.value,
        sendAsUserId: null,
        scheduledFor: scheduledForUtc.value,
      },
    })

    if (answer.status === 201) {
      // Drei Ausgänge, nicht zwei — und der mittlere ist der, den der Ur-Admin mit Termin nimmt:
      // freigegeben, aber noch nicht raus. Bevor er hier stand, bekam er den Satz für „wartet auf
      // eine fremde Freigabe" zu lesen, obwohl seine längst erteilt war.
      outcome.value =
        answer.data.status === 'released'
          ? 'sent'
          : answer.data.status === 'approved'
            ? 'scheduled'
            : 'waiting'
      sentTo.value = answer.data.recipientCount ?? undefined
      scheduledAt.value = answer.data.scheduledFor ?? undefined
    }
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht. Versuch es noch einmal.')
    return
  }

  confirming.value = false
  subject.value = ''
  scheduledFor.value = ''
  body.value = ''

  await queryClient.invalidateQueries({ queryKey: getListBroadcastQueueQueryKey() })
}

// ── Die Warteschlange ────────────────────────────────────────────────────────────────────────

const { data: queueData } = useListBroadcastQueue()
const { data: releasedData } = useListReleasedBroadcasts()

const waitingBroadcasts = computed<ListBroadcastQueue200Item[]>(() =>
  queueData.value?.status === 200 ? queueData.value.data : [],
)

const releasedBroadcasts = computed<ListReleasedBroadcasts200Item[]>(() =>
  releasedData.value?.status === 200 ? releasedData.value.data : [],
)

const { mutateAsync: approveBroadcast, isPending: isApproving } = useApproveBroadcast()
const { mutateAsync: discardBroadcast, isPending: isDiscarding } = useDiscardBroadcast()

const queueError = ref<string | undefined>(undefined)

async function refreshBoth() {
  await queryClient.invalidateQueries({ queryKey: getListBroadcastQueueQueryKey() })
  await queryClient.invalidateQueries({ queryKey: getListReleasedBroadcastsQueryKey() })
}

async function approve(publicationId: string) {
  queueError.value = undefined

  try {
    await approveBroadcast({ publicationId })
  } catch (failure) {
    // Die eigene Einreichung ist der Fall, den jemand wirklich erlebt — der bekommt seinen Satz.
    queueError.value =
      failure instanceof ApiError && failure.status === 403
        ? 'Deine eigene Einreichung muss jemand anderes aus der Administration freigeben.'
        : failureMessage(failure, 'Die Freigabe ging nicht durch.')
    return
  }

  await refreshBoth()
}

async function discard(publicationId: string) {
  queueError.value = undefined

  try {
    await discardBroadcast({ publicationId })
  } catch (failure) {
    queueError.value = failureMessage(failure, 'Das Verwerfen ging nicht durch.')
    return
  }

  await refreshBoth()
}

const AUDIENCE_LABELS: Record<string, string> = {
  administrator: 'Administration',
  moderator: 'Moderation',
  member: 'Mitglieder ohne Rolle',
}

function audienceOf(groups: string[]): string {
  return groups.map((group) => AUDIENCE_LABELS[group] ?? group).join(', ')
}
</script>

<template>
  <ModerationPage
    title="Rundmail"
    description="Eine Nachricht an das Team, an alle anderen, oder an alle zusammen. Reiner Text, wie jede andere Mail hier — gesperrte Konten bekommen sie nie."
  >
    <ModerationTabs v-model="tab" :tabs="TABS" label="Ansichten" />

    <div class="mt-5">
      <template v-if="tab === 'compose'">
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
                An unbestätigte Adressen zu schreiben heißt, an Postfächer zu schreiben, die
                niemandem nachweislich gehören.
              </p>
            </Field>

            <Field>
              <FieldLabel for="broadcastSubject">Betreff</FieldLabel>
              <Input
                id="broadcastSubject"
                v-model="subject"
                name="broadcastSubject"
                :maxlength="TEXT_LIMIT.submitBroadcast.subject.maxLength"
                autocomplete="off"
              />
            </Field>

            <!--
              Leer ist der Normalfall und heißt „sobald freigegeben". Ein Terminfeld, das
              vorausgefüllt wäre, würde jede Rundmail zu einer geplanten machen — und der Satz
              darunter sagt ausdrücklich Berliner Zeit, weil das Feld die Uhr des Geräts anzeigt
              und beides auseinanderfallen kann.
            -->
            <Field>
              <FieldLabel for="broadcastSchedule"
                >Termin <span class="text-ink-6">optional</span></FieldLabel
              >
              <Input
                id="broadcastSchedule"
                v-model="scheduledFor"
                name="broadcastSchedule"
                type="datetime-local"
                class="max-w-[260px]"
              />
              <p class="text-control text-ink-5">
                <template v-if="scheduledFor === ''">
                  Ohne Termin geht sie raus, sobald sie freigegeben ist.
                </template>
                <template v-else>
                  Geht frühestens am {{ formatBerlin(scheduledForUtc ?? '') }} raus — deutsche Zeit,
                  unabhängig davon, wo du gerade bist. Freigegeben sein muss sie trotzdem.
                </template>
              </p>
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
                :maxlength="TEXT_LIMIT.submitBroadcast.body.maxLength"
                rows="14"
                class="prose-post w-full resize-y rounded-lg border border-line-4 bg-paper-1 px-4 py-3 caret-oak outline-none focus-visible:border-line-5"
              ></textarea>
              <p class="text-control text-ink-5">
                Schreib die ganze Nachricht, mit Anrede und Gruß. Angehängt wird nur die Zeile, dass
                sie vom Team verschickt wurde. Formatierung gibt es nicht — was hier steht, kommt
                genau so an.
              </p>
            </Field>
          </FieldGroup>

          <div>
            <Button type="submit" :disabled="!isComplete || isPending">Weiter</Button>
          </div>
        </form>

        <!-- The one thing here that cannot be undone gets said in full before it happens. -->
        <div
          v-if="confirming"
          class="mt-6 max-w-[60ch] rounded-lg border border-line-4 bg-paper-1 p-4"
        >
          <p class="text-row text-ink-2">
            Diese Nachricht geht an {{ pluralize(recipients ?? 0, 'Person', 'Personen') }}.
          </p>
          <p class="mt-1 text-[12.5px] text-ink-5">
            Sie geht erst raus, wenn jemand aus der Administration sie freigibt — verschickte Mails
            lassen sich nicht zurückholen.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button :disabled="isPending" @click="submit">
              <Spinner v-if="isPending" />
              Zur Freigabe einreichen
            </Button>
            <Button variant="outline" :disabled="isPending" @click="confirming = false">
              Abbrechen
            </Button>
          </div>
        </div>

        <!-- Was geschehen ist, sagt die Antwort und nicht die eigene Rolle — siehe `submit`. -->
        <p v-if="outcome === 'sent'" class="mt-4 text-note text-ink-5" role="status">
          Die Nachricht ist an {{ pluralize(sentTo ?? 0, 'Person', 'Personen') }} unterwegs.
        </p>

        <p v-else-if="outcome === 'scheduled'" class="mt-4 text-note text-ink-5" role="status">
          Freigegeben. Sie geht am
          {{ scheduledAt === undefined ? 'vereinbarten Termin' : formatBerlin(scheduledAt) }}
          von selbst raus — bis dahin steht sie unter „Warteschlange" und lässt sich noch ändern.
        </p>

        <p v-else-if="outcome === 'waiting'" class="mt-4 text-note text-ink-5" role="status">
          Eingereicht. Sie steht jetzt in der Warteschlange und geht raus, sobald jemand anderes aus
          der Administration sie freigibt.
        </p>

        <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
      </template>

      <!-- ── Warteschlange ─────────────────────────────────────────────────────────────────── -->
      <template v-else-if="tab === 'queue'">
        <p v-if="waitingBroadcasts.length === 0" class="max-w-[70ch] text-note text-ink-5">
          Nichts wartet auf eine Freigabe.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="entry in waitingBroadcasts"
            :key="entry.publicationId"
            class="border-b border-line-2 py-4"
          >
            <p class="text-row text-ink-2">{{ entry.subject }}</p>
            <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
              {{ entry.body }}
            </p>
            <p class="mt-2 text-[12px] text-ink-6">
              An {{ audienceOf(entry.audienceGroups)
              }}<template v-if="entry.includeUnverified">, auch an unbestätigte Adressen</template>
              · Als {{ entry.sendAsUsername ?? 'Admin' }} · Von
              {{ entry.writtenByUsername ?? 'einem gelöschten Konto' }},
              {{ formatActivityTime(entry.writtenAt) }}
            </p>

            <!--
              Zwei Zustände in einer Liste, und der Unterschied ist die Arbeit: Was wartet, wartet
              auf einen Menschen; was freigegeben ist, nur noch auf die Uhr. Beides steht hier,
              weil eine Rundmail, die an alle geht und nirgends zu sehen ist, das Falsche ist —
              siehe `listWaiting`.
            -->
            <p v-if="entry.scheduledFor" class="mt-1 text-[12px] text-ink-4">
              <template v-if="entry.status === 'approved'">
                Freigegeben von {{ entry.approvedByUsername ?? 'einem gelöschten Konto' }} · geht am
                {{ formatBerlin(entry.scheduledFor) }} von selbst raus
              </template>
              <template v-else>Termin: {{ formatBerlin(entry.scheduledFor) }}</template>
            </p>

            <div class="mt-3 flex flex-wrap gap-2">
              <Button
                v-if="entry.status === 'awaiting_approval'"
                size="sm"
                :disabled="isApproving || isDiscarding"
                @click="approve(entry.publicationId)"
              >
                {{ entry.scheduledFor ? 'Freigeben' : 'Freigeben und senden' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="isApproving || isDiscarding"
                @click="discard(entry.publicationId)"
              >
                Verwerfen
              </Button>
            </div>
          </li>
        </ul>

        <p v-if="queueError" class="mt-3 text-[12.5px] text-destructive" role="alert">
          {{ queueError }}
        </p>
      </template>

      <!-- ── Gesendete ─────────────────────────────────────────────────────────────────────── -->
      <template v-else-if="tab === 'released'">
        <p v-if="releasedBroadcasts.length === 0" class="max-w-[70ch] text-note text-ink-5">
          Es ist noch keine Rundmail rausgegangen.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="entry in releasedBroadcasts"
            :key="entry.publicationId"
            class="border-b border-line-2 py-4"
          >
            <p class="text-row text-ink-2">{{ entry.subject }}</p>
            <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
              {{ entry.body }}
            </p>

            <!-- Nach außen der Absender, hier beide echten Namen: Das ist der Sinn der Spur, und
                 diese Liste sieht ohnehin nur die Administration. -->
            <p class="mt-2 text-[12px] text-ink-6">
              Als {{ entry.sendAsUsername ?? 'Admin' }} an
              {{ pluralize(entry.recipientCount ?? 0, 'Person', 'Personen') }},
              {{
                entry.releasedAt === null ? 'ohne Zeitangabe' : formatActivityTime(entry.releasedAt)
              }}
            </p>
            <p class="mt-0.5 text-[12px] text-ink-6">
              Geschrieben von {{ entry.writtenByUsername ?? 'einem gelöschten Konto' }} ·
              Freigegeben von {{ entry.approvedByUsername ?? 'einem gelöschten Konto' }}
            </p>
          </li>
        </ul>
      </template>

      <BroadcastSendersPanel v-else />
    </div>
  </ModerationPage>
</template>
