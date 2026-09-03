<script setup lang="ts">
/**
 * Blind-Date: what it is, what is on offer, and how alive it is right now.
 *
 * Four parts, in the order somebody reads them — what this is, what one can apply for, the way in
 * without an offer, and the Blind-Dates already running. The last of those is not decoration: the
 * whole reason to show that anything is happening is that it is what makes the next person apply.
 *
 * **Nothing on this page names anybody.** The running Blind-Dates carry a plot, a count and a date
 * and nothing else — the API returns no more than that, so there is nothing here to be careful
 * with, which is the right place for that care to live.
 *
 * The introduction is a custom page (`blind-date`), not prose in this file, so the administration
 * edits it where it edits every other fixed text. Deliberately not a third editor: „Eigene Seiten"
 * already stores a title, a body and who last touched it. If that page has been deleted the
 * section simply does not appear — the rest of the page still works, which is the right way for a
 * missing text to fail.
 */
import { computed, ref } from 'vue'
import {
  getGetBlindDateEligibilityQueryKey,
  getGetOwnBlindDateApplicationQueryKey,
  useGetBlindDateEligibility,
  useGetOwnBlindDateApplication,
  useGetPendingBlindDateFeedback,
  useListActiveBlindDates,
  useListBlindDateOffers,
  useWithdrawBlindDateApplication,
} from '@/api/blind-date/blind-date'
import type { GetBlindDateEligibility200Reason, ListBlindDateOffers200Item } from '@/api/models'
import { useReadPage } from '@/api/pages/pages'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import AppLayout from '@/components/layout/AppLayout.vue'
import BlindDateApplicationForm from '@/components/blind-date/BlindDateApplicationForm.vue'
import BlindDateFeedbackForm from '@/components/blind-date/BlindDateFeedbackForm.vue'
import BlindDateOfferCard from '@/components/blind-date/BlindDateOfferCard.vue'
import BlindDateRail from '@/components/blind-date/BlindDateRail.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const { data: eligibilityData, isPending: eligibilityPending } = useGetBlindDateEligibility()
const { data: offersData } = useListBlindDateOffers()
const { data: activeData } = useListActiveBlindDates()
const { data: ownData } = useGetOwnBlindDateApplication()
const { data: introData } = useReadPage('blind-date')
const { data: feedbackData } = useGetPendingBlindDateFeedback()

/**
 * A finished Blind-Date this member has not been asked about. 404 is the ordinary answer and means
 * nothing to ask, so it is absent rather than an error.
 */
const feedbackInvitation = computed(() =>
  feedbackData.value?.status === 200 ? feedbackData.value.data : undefined,
)

/** The administration's own words. Absent where the page was deleted, and then simply not shown. */
const intro = computed<string | undefined>(() =>
  introData.value?.status === 200 ? introData.value.data.body : undefined,
)

const eligibility = computed(() =>
  eligibilityData.value?.status === 200 ? eligibilityData.value.data : undefined,
)

const offers = computed<ListBlindDateOffers200Item[]>(() =>
  offersData.value?.status === 200 ? offersData.value.data : [],
)

const active = computed(() => (activeData.value?.status === 200 ? activeData.value.data : []))

const ownApplication = computed(() =>
  ownData.value?.status === 200 ? ownData.value.data : undefined,
)

const mayApply = computed<boolean>(() => eligibility.value?.reason === null)

/**
 * What each refusal means, in the second person. `excluded` deliberately says only that: the
 * reason the team wrote down is theirs, and reading it back would turn a note into a verdict
 * delivered by a machine.
 */
const REFUSALS: Record<NonNullable<GetBlindDateEligibility200Reason>, string> = {
  administration_account:
    'Dieses Konto ist für die Verwaltung da, nicht zur Teilnahme. Für ein Blind-Date nimm dein eigenes Mitgliedskonto.',
  excluded: 'Du kannst dich zurzeit nicht für ein Blind-Date bewerben. Melde dich beim Team.',
  already_applied: 'Deine Bewerbung liegt dem Team vor.',
  already_matched: 'Du bist gerade in einem Blind-Date. Eines nach dem anderen.',
  not_enough_online_time:
    'Für ein Blind-Date brauchst du 1000 Online-Minuten in den letzten 30 Tagen.',
}

/** Why this member may not apply, in one sentence, or nothing. */
const refusal = computed<string | undefined>(() =>
  eligibility.value?.reason ? REFUSALS[eligibility.value.reason] : undefined,
)

/** Which form is open: an offer's, the proactive one, or none. */
const applyingTo = ref<ListBlindDateOffers200Item | undefined>(undefined)
const applyingProactively = ref<boolean>(false)

function openOffer(offer: ListBlindDateOffers200Item) {
  applyingProactively.value = false
  applyingTo.value = offer
}

function openProactive() {
  applyingTo.value = undefined
  applyingProactively.value = true
}

function closeForm() {
  applyingTo.value = undefined
  applyingProactively.value = false
}

const formOpen = computed<boolean>(
  () => applyingTo.value !== undefined || applyingProactively.value,
)

const { mutateAsync: withdraw, isPending: isWithdrawing } = useWithdrawBlindDateApplication()

async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetBlindDateEligibilityQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetOwnBlindDateApplicationQueryKey() }),
  ])
}

async function applied() {
  closeForm()
  await refresh()
}

/**
 * Said when withdrawing no longer applies, which is almost always the same reason: the team
 * matched this application while the page was open. The page then still holds the version it
 * fetched, button and all — so the answer is to say what happened and fetch again, after which
 * the running Blind-Date is what the page shows.
 */
const withdrawalFailed = ref<string | undefined>(undefined)

async function withdrawApplication() {
  withdrawalFailed.value = undefined

  try {
    await withdraw()
  } catch (failure) {
    withdrawalFailed.value = failureMessage(
      failure,
      'Das ging nicht mehr — vermutlich wurde deine Bewerbung inzwischen zugeordnet.',
    )
    // Refreshed even on failure, and *especially* then: the stale button is the whole problem.
    await refresh()
    return
  }

  await refresh()
}
</script>

<template>
  <AppLayout rail-label="Blind-Date" rail-always-open>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <h1 class="text-h1">Blind-Date</h1>

      <!-- 1 ─ What this is, in the administration's own words. Line breaks kept and nothing else
           interpreted, exactly as the page view renders one. -->
      <div
        v-if="intro"
        class="mt-2 max-w-[65ch] text-body leading-[1.6] whitespace-pre-line text-ink-4"
      >
        {{ intro }}
      </div>

      <div v-if="eligibilityPending" class="mt-6 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <template v-else>
        <!-- Above everything else, because it is about something that already happened, and
             because a form somebody scrolls past is a form nobody fills in. It disappears the
             moment it is answered or declined — never after two endings at once, since only the
             most recent one is ever asked about. -->
        <div v-if="feedbackInvitation" class="mt-5 max-w-[70ch]">
          <BlindDateFeedbackForm :invitation="feedbackInvitation" />
        </div>

        <!-- The member's own standing, said once and before anything is offered: being told
             "du bist schon dabei" after clicking Bewerben is a refusal dressed as a button. -->
        <p
          v-if="ownApplication"
          class="mt-5 max-w-[65ch] rounded-lg border border-line-3 bg-paper-0 p-3.5 text-note text-ink-4 shadow-card"
        >
          Deine Bewerbung für „{{ ownApplication.plotTitle }}“ liegt dem Team vor, seit
          {{ formatActivityTime(ownApplication.createdAt) }}.
          <Button
            variant="ghost"
            size="xs"
            class="ml-1"
            :disabled="isWithdrawing"
            @click="withdrawApplication"
          >
            Zurückziehen
          </Button>
        </p>

        <p v-if="withdrawalFailed" class="mt-2 max-w-[65ch] text-note text-ink-5" role="alert">
          {{ withdrawalFailed }}
        </p>

        <p
          v-else-if="eligibility && eligibility.reason"
          class="mt-5 max-w-[65ch] text-note text-ink-5"
        >
          {{ REFUSALS[eligibility.reason] }}
          <template v-if="eligibility.reason === 'not_enough_online_time'">
            Du hast {{ formatCount(eligibility.onlineMinutes) }} von
            {{ formatCount(eligibility.requiredOnlineMinutes) }}.
          </template>
        </p>

        <!-- Said only while it is true, and it will not be true for long. -->
        <p v-else-if="eligibility?.inGracePeriod" class="mt-5 max-w-[65ch] text-note text-ink-5">
          In der Anfangszeit gilt die Bedingung von 1000 Online-Minuten noch nicht — bewerben kann
          sich zurzeit jede und jeder.
        </p>

        <!-- 2 ─ What the team is offering, side by side and numbered. No apply button here:
             there is one way in and it is the rail, so a second one beside each plot would be two
             places to do the same thing. -->
        <section class="mt-8">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
            Aktuell angebotene Handlungen
          </h2>

          <p v-if="offers.length === 0" class="mt-3 max-w-[65ch] text-note text-ink-5">
            Zurzeit ist keine Handlung ausgeschrieben. Du kannst dich trotzdem bewerben und selbst
            eine nennen.
          </p>

          <template v-else>
            <!-- One card component, shared with the team's own list: they show the same thing,
                 and two of them would drift. The deadline stays after it passes — the team closes
                 an offer, not the clock. -->
            <div class="mt-3 grid gap-3.5 sm:grid-cols-2">
              <BlindDateOfferCard
                v-for="(offer, index) in offers"
                :key="offer.id"
                :offer="offer"
                :label="`Handlung ${index + 1}`"
              />
            </div>

            <p v-if="mayApply" class="mt-3 max-w-[65ch] text-note text-ink-5">
              Du möchtest teilnehmen? Dann bewirb dich rechts über das Formular.
            </p>
          </template>
        </section>

        <section v-if="formOpen" class="mt-6 border-t border-line-3 pt-6">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Bewerbung</h2>
          <div class="mt-4 max-w-[70ch]">
            <BlindDateApplicationForm :offer="applyingTo" @applied="applied" @cancel="closeForm" />
          </div>
        </section>

        <!-- 4 ─ How alive this is. No names anywhere, which is the whole point. -->
        <section class="mt-9 border-t border-line-3 pt-6">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
            Laufende Blind-Dates
          </h2>

          <p v-if="active.length === 0" class="mt-3 max-w-[65ch] text-note text-ink-5">
            Zurzeit läuft kein Blind-Date. Deines könnte das erste sein.
          </p>

          <template v-else>
            <p class="mt-2 max-w-[65ch] text-[12.5px] text-ink-6">
              Wer mit wem schreibt, steht hier nicht — das ist der Sinn der Sache.
            </p>

            <ul class="mt-3 flex flex-col">
              <li
                v-for="pair in active"
                :key="pair.number"
                class="flex flex-wrap items-baseline gap-x-3 border-t border-line-2 py-2.5 first:border-t-0 first:pt-0"
              >
                <span class="text-row text-ink-2">Blind-Date-Paar #{{ pair.number }}</span>
                <span class="text-[12.5px] text-ink-4">{{ pair.plotTitle }}</span>
                <span class="text-[12px] text-ink-6">
                  {{ formatCount(pair.posts) }}
                  {{ pair.posts === 1 ? 'Beitrag' : 'Beiträge' }} · zuletzt aktiv
                  {{ formatActivityTime(pair.lastActivityAt) }}
                </span>
              </li>
            </ul>
          </template>
        </section>
      </template>
    </div>

    <template #rail>
      <BlindDateRail
        :offers="offers"
        :may-apply="mayApply && ownApplication === undefined"
        :refusal="ownApplication ? 'Deine Bewerbung liegt dem Team vor.' : refusal"
        @apply="openOffer"
        @apply-freely="openProactive"
      />
    </template>
  </AppLayout>
</template>
