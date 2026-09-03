<script setup lang="ts">
/**
 * The queue of open Blind-Date applications, and the pairing.
 *
 * **Two are chosen by hand and nothing is suggested.** Whether two writing styles will get on is
 * the judgement the whole ritual rests on, so the panel's job is to put the two applications side
 * by side and stay out of the way — no score, no ranking, no "these look compatible".
 *
 * Selecting is two clicks: the first application is picked, the second completes the pair, and the
 * form underneath asks for the plot the two will write. The plot is asked rather than taken from
 * one of the applications, because the two may name different ones and choosing is the same kind
 * of decision as the pairing.
 */
import { computed, ref, watch } from 'vue'
import {
  getListBlindDateApplicationsQueryKey,
  useDeclineBlindDateApplication,
  useListBlindDateApplications,
  useMatchBlindDateApplications,
} from '@/api/moderation/moderation'
import type { ListBlindDateApplications200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'

type Application = ListBlindDateApplications200Item

const { data, isPending } = useListBlindDateApplications()

/**
 * Whose applications are from people who work this desk. They are blind to this queue while their
 * own application is open, and whoever is pairing is told — see the note above the list.
 */
const suspendedManagers = computed<string[]>(() => [
  ...new Set(
    applications.value
      .filter((application) => application.isBlindDateManager)
      .map((application) => application.user.username),
  ),
])

const applications = computed<Application[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

/** The wording the community uses. The enum is English; nothing a member reads is. */
const STYLE_LABELS: Record<string, string> = {
  prose: 'Roman',
  asterisk: 'Sternchen',
}

const LENGTH_LABELS: Record<string, string> = {
  short: 'kurz',
  medium: 'mittel',
  long: 'lang',
}

const selected = ref<string[]>([])

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((one) => one !== id)
    : // Never more than two: a Blind-Date is a pair, and a third click replaces the older choice
      // rather than refusing, which is what somebody correcting themselves expects.
      [...selected.value, id].slice(-2)
}

const chosen = computed<Application[]>(() =>
  selected.value
    .map((id) => applications.value.find((one) => one.id === id))
    .filter((one): one is Application => one !== undefined),
)

const bothChosen = computed<boolean>(() => chosen.value.length === 2)

const plotTitle = ref<string>('')
const synopsis = ref<string>('')
const error = ref<string | undefined>(undefined)

// Prefilled from the first of the two, because it is usually right and always editable. Only
// while nothing has been typed: overwriting somebody mid-sentence would be worse than an empty box.
watch(chosen, (pair) => {
  if (pair.length > 0 && plotTitle.value.trim() === '') {
    plotTitle.value = pair[0]?.plotTitle ?? ''
  }
})

const { mutateAsync: matchPair, isPending: isMatching } = useMatchBlindDateApplications()
const { mutateAsync: decline, isPending: isDeclining } = useDeclineBlindDateApplication()

async function refresh() {
  await queryClient.invalidateQueries({
    queryKey: getListBlindDateApplicationsQueryKey(),
  })
}

async function confirmMatch() {
  const [first, second] = chosen.value
  if (first === undefined || second === undefined) return

  error.value = undefined

  try {
    await matchPair({
      data: {
        firstApplicationId: first.id,
        secondApplicationId: second.id,
        plotTitle: plotTitle.value.trim(),
        synopsis: synopsis.value.trim(),
      },
    })
  } catch (failure) {
    error.value = failureMessage(
      failure,
      'Die Zuordnung ist nicht durchgegangen. Vielleicht hat sich seither etwas geändert — lade die Seite neu.',
    )
    return
  }

  selected.value = []
  plotTitle.value = ''
  synopsis.value = ''
  await refresh()
}

async function declineOne(id: string) {
  error.value = undefined

  try {
    await decline({ applicationId: id, data: {} })
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  selected.value = selected.value.filter((one) => one !== id)
  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Älteste zuerst. Zwei Bewerbungen auswählen, dann die Handlung bestätigen — es gibt bewusst
      keinen Vorschlag: ob zwei Schreibstile zusammenpassen, entscheidet ihr.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="applications.length === 0" class="mt-5 text-note text-ink-5">
      Zurzeit wartet keine Bewerbung.
    </p>

    <template v-else>
      <!-- The recommendation, not a rule: nothing here enforces it, and it would be the wrong
           thing to enforce — sometimes the later application is plainly the worse fit. It is said
           because the person pairing cannot know what the suspended manager already saw, and the
           applications that arrived after hers are the ones she certainly did not. -->
      <div
        v-if="suspendedManagers.length > 0"
        class="mt-4 max-w-[70ch] rounded-lg border border-line-4 bg-paper-2 p-3.5"
      >
        <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Empfehlung zur Zuordnung
        </p>
        <p class="mt-2 text-note leading-[1.6] text-ink-4">
          In dieser Warteschlange steht
          {{ suspendedManagers.length === 1 ? 'eine Bewerbung' : 'mehrere Bewerbungen' }} von
          {{ suspendedManagers.join(', ') }}, {{ suspendedManagers.length === 1 ? 'die' : 'die' }}
          sonst selbst hier arbeitet. Sie sieht die Warteschlange gerade nicht.
        </p>
        <p class="mt-2 text-note leading-[1.6] text-ink-4">
          Wähle als Gegenüber nach Möglichkeit eine Bewerbung, die <em>nach</em> ihrer eingegangen
          ist — diese Person kennt sie aus ihrer Verwaltungstätigkeit nicht. Keine Garantie, aber
          die beste Abschwächung, die es hier gibt.
        </p>
      </div>

      <ul class="mt-4 flex flex-col gap-2.5">
        <li
          v-for="application in applications"
          :key="application.id"
          class="rounded-lg border p-3.5 transition-colors"
          :class="
            selected.includes(application.id)
              ? 'border-oak bg-paper-3'
              : 'border-line-3 bg-paper-0 hover:border-line-5'
          "
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-row text-ink-2">
              <RouterLink
                :to="{ name: 'member', params: { userId: application.user.id } }"
                class="text-ink-2 underline-offset-[5px] hover:underline"
              >
                {{ application.user.username }}
              </RouterLink>
              <span class="ml-2 text-[12px] text-ink-6">
                {{ formatCount(application.onlineMinutes) }} Min. online (30 Tage)
              </span>
              <span
                v-if="application.isBlindDateManager"
                class="ml-2 rounded-full bg-paper-3 px-2 py-0.5 text-[10.5px] text-ink-3"
              >
                arbeitet sonst hier
              </span>
            </p>
            <span class="text-[12px] text-ink-6">
              beworben {{ formatActivityTime(application.createdAt) }}
            </span>
          </div>

          <p class="mt-1.5 text-[12.5px] text-ink-3">
            {{ application.plotTitle }}
            <span v-if="application.offerTitle" class="text-ink-6">
              · aus dem Angebot „{{ application.offerTitle }}“
            </span>
          </p>

          <p class="mt-1 text-[12px] text-ink-5">
            {{ STYLE_LABELS[application.writingStyle] ?? application.writingStyle }} ·
            {{ LENGTH_LABELS[application.postLength] ?? application.postLength }}e Posts · Rolle:
            {{ application.roleGender }} · Pairing: {{ application.pairing }}
          </p>

          <p v-if="application.note" class="mt-1 text-[12.5px] text-ink-4">
            {{ application.note }}
          </p>

          <div class="mt-2.5 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="xs"
              :disabled="isMatching"
              @click="toggle(application.id)"
            >
              {{ selected.includes(application.id) ? 'Auswahl aufheben' : 'Auswählen' }}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :disabled="isDeclining"
              @click="declineOne(application.id)"
            >
              Ablehnen
            </Button>
          </div>
        </li>
      </ul>

      <!-- The form appears only once two are chosen: an empty one above an unread queue is a
           form somebody fills in before they have decided anything. -->
      <section v-if="bothChosen" class="mt-6 border-t border-line-3 pt-5">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Zuordnen</h3>

        <p class="mt-2 max-w-[70ch] text-note text-ink-4">
          {{ chosen[0]?.user.username }} und {{ chosen[1]?.user.username }} schreiben zusammen. Die
          Gruppe entsteht privat und pseudonymisiert; beide sehen einander als „Blind-Date-Partner
          1" und „Blind-Date-Partner 2".
        </p>

        <div class="mt-3 flex flex-col gap-2.5">
          <Input
            v-model="plotTitle"
            aria-label="Handlung"
            placeholder="Handlung"
            :maxlength="TEXT_LIMIT.matchBlindDateApplications.plotTitle.maxLength"
            class="max-w-[420px]"
          />
          <Textarea
            v-model="synopsis"
            aria-label="Kurzbeschreibung"
            placeholder="Kurzbeschreibung der Handlung, für die Gruppe"
            :maxlength="TEXT_LIMIT.matchBlindDateApplications.synopsis.maxLength"
            class="max-w-[70ch]"
            rows="3"
          />
        </div>

        <Button
          class="mt-3"
          :disabled="isMatching || plotTitle.trim() === '' || synopsis.trim() === ''"
          @click="confirmMatch"
        >
          <Spinner v-if="isMatching" />
          Blind-Date anlegen
        </Button>
      </section>
    </template>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </div>
</template>
