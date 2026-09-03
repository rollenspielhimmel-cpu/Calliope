<script setup lang="ts">
/**
 * The team's Blind-Date desk: the queue, what is on offer, who may not take part, how the past
 * rounds went, and what people said about them.
 *
 * Five tabs rather than five pages, because they are read in one sitting.
 *
 * **The whole desk sits behind a right of its own**, and the menu entry that leads here stays
 * visible for everybody on the team. Somebody without the right lands on this page and is told
 * which door is shut and why — an entry that disappears is a feature people ask about in chat, and
 * one that explains itself answers the question.
 *
 * Three doors, and the page names the one that is shut: not on the team, the right was never given,
 * or — the interesting one — an application of one's own is still open. That last is not a
 * punishment, and the page says so at some length, because somebody who reads „kein Zugriff" and
 * nothing else assumes they did something wrong.
 */
import { computed, ref } from 'vue'
import {
  useListAllBlindDateOffers,
  useListBlindDateApplications,
  useListBlindDateExclusions,
} from '@/api/moderation/moderation'
import { useGetCurrentUser } from '@/api/auth/auth'
import { ApiError } from '@/lib/api/apiFetch'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import BlindDateQueuePanel from '@/components/moderation/BlindDateQueuePanel.vue'
import BlindDateOffersPanel from '@/components/moderation/BlindDateOffersPanel.vue'
import BlindDateExclusionsPanel from '@/components/moderation/BlindDateExclusionsPanel.vue'
import BlindDateParticipationPanel from '@/components/moderation/BlindDateParticipationPanel.vue'
import BlindDateFeedbackPanel from '@/components/moderation/BlindDateFeedbackPanel.vue'
import BlindDateManagersPanel from '@/components/moderation/BlindDateManagersPanel.vue'

const tab = ref<string>('queue')

const { data: applications, error } = useListBlindDateApplications()
const { data: offers } = useListAllBlindDateOffers()
const { data: exclusions } = useListBlindDateExclusions()

const { data: currentUser } = useGetCurrentUser()

/** Only the root administrator gives this right out, so only they see the section that does. */
const mayGrant = computed<boolean>(
  () => currentUser.value?.status === 200 && currentUser.value.data.isPrimordialAdmin,
)

/**
 * Why the desk is shut, from the refusal itself. Read off the queue's error rather than asked for
 * separately: it is the first thing the page loads, and a second request to learn what the first
 * one already said would be a second thing to keep in step.
 */
const refusal = computed<string | undefined>(() => {
  if (!(error.value instanceof ApiError) || error.value.status !== 403) {
    return undefined
  }
  return String((error.value.body as { reason?: string }).reason ?? 'not_granted')
})

const tabs = computed<ModerationTab[]>(() => [
  {
    value: 'queue',
    label: 'Bewerbungen',
    count: applications.value?.status === 200 ? applications.value.data.length : undefined,
  },
  {
    value: 'offers',
    label: 'Angebote',
    // Open ones only: a closed offer is history, and counting it would make the number grow
    // for ever while saying nothing about what is running.
    count:
      offers.value?.status === 200
        ? offers.value.data.filter((offer) => offer.closedAt === null).length
        : undefined,
  },
  {
    value: 'exclusions',
    label: 'Ausschlüsse',
    count: exclusions.value?.status === 200 ? exclusions.value.data.length : undefined,
  },
  // No count beside these two: one would be „how many members have ever taken part" and the other
  // „how many have ever answered", numbers that only grow and ask for nothing. The three above
  // count something still waiting to be done.
  { value: 'participation', label: 'Teilnahmen' },
  { value: 'feedback', label: 'Rückmeldungen' },
  ...(mayGrant.value ? [{ value: 'managers', label: 'Zugriff' }] : []),
])
</script>

<template>
  <ModerationPage
    title="Blind-Date"
    description="Bewerbungen zuordnen, Handlungen anbieten, und wer nicht teilnehmen darf. Die Gruppen entstehen privat und pseudonymisiert — wer mit wem schreibt, erfahren die beiden erst, wenn sie es beide wollen."
  >
    <!-- ── The shut door, named ──────────────────────────────────────────────────────────── -->
    <template v-if="refusal">
      <div class="max-w-[70ch] rounded-lg border border-line-3 bg-paper-0 p-4 shadow-card">
        <p class="text-h2 text-ink-1">Dir fehlen die Rechte für diesen Bereich</p>

        <template v-if="refusal === 'own_application_open'">
          <p class="mt-2 text-note leading-[1.6] text-ink-4">
            Du hast dich selbst für ein Blind-Date beworben. Solange deine Bewerbung offen ist,
            siehst du die Warteschlange nicht — weder deine eigene Bewerbung noch die der anderen.
          </p>
          <p class="mt-2 text-note leading-[1.6] text-ink-4">
            Das ist keine Maßregelung, sondern der Sinn der Sache: Wer selbst in der Schlange steht,
            soll nicht sehen können, wer sonst noch darin steht. Die Zuordnung übernimmt in dieser
            Zeit der Ur-Admin — für alle, nicht nur für dich.
          </p>
          <p class="mt-2 text-note leading-[1.6] text-ink-4">
            Sobald du zugeordnet wurdest oder deine Bewerbung zurückgezogen hast, ist der Bereich
            wieder da. Von selbst, du musst niemanden darum bitten.
          </p>
        </template>

        <template v-else-if="refusal === 'not_granted'">
          <p class="mt-2 text-note leading-[1.6] text-ink-4">
            Für den Blind-Date-Bereich braucht es ein eigenes Recht, das nicht automatisch mit der
            Moderationsrolle kommt. Hier steht, wer sich für wen interessiert — das wird bewusst
            einzeln vergeben.
          </p>
          <p class="mt-2 text-note leading-[1.6] text-ink-4">
            Vergeben kann es nur der Ur-Admin. Wenn du hier arbeiten sollst, frag dort nach.
          </p>
        </template>

        <p v-else class="mt-2 text-note leading-[1.6] text-ink-4">
          Dieser Bereich ist dem Team vorbehalten.
        </p>
      </div>
    </template>

    <!-- ── The desk ──────────────────────────────────────────────────────────────────────── -->
    <template v-else>
      <ModerationTabs v-model="tab" :tabs="tabs" label="Ansichten" />

      <!-- Said where the work happens, not in a help page nobody opens: somebody who does not
           know this is possible will not go looking for it. -->
      <div
        v-if="tab === 'queue'"
        class="mt-5 max-w-[70ch] rounded-lg border border-line-3 bg-paper-2 p-3.5"
      >
        <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Auch du kannst teilnehmen
        </p>
        <p class="mt-2 text-note leading-[1.6] text-ink-4">
          Dass du hier arbeitest, schließt dich nicht aus. Du bewirbst dich wie alle anderen über
          die Blind-Date-Seite.
        </p>
        <p class="mt-2 text-note leading-[1.6] text-ink-4">
          Sobald du das tust, verschwindet dieser Bereich für dich — du siehst die Warteschlange
          nicht mehr, auch deine eigene Bewerbung nicht. So kannst du nicht mitlesen, wer sonst noch
          wartet. Die Zuordnung übernimmt so lange der Ur-Admin. Danach ist alles wieder da, ganz
          von selbst.
        </p>
      </div>

      <div class="mt-5">
        <BlindDateQueuePanel v-if="tab === 'queue'" />
        <BlindDateOffersPanel v-else-if="tab === 'offers'" />
        <BlindDateExclusionsPanel v-else-if="tab === 'exclusions'" />
        <BlindDateParticipationPanel v-else-if="tab === 'participation'" />
        <BlindDateFeedbackPanel v-else-if="tab === 'feedback'" />
        <BlindDateManagersPanel v-else />
      </div>
    </template>
  </ModerationPage>
</template>
