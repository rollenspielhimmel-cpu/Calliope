<script setup lang="ts">
/**
 * The team's Blind-Date desk: the queue, what is on offer, and who may not take part.
 *
 * Five tabs rather than five pages, because they are read in one sitting — the queue is worked
 * through, an offer is closed when its round is done, an exclusion is looked up while judging an
 * application, the participation table shows the pattern that no single application does, and the
 * feedback says whether the format is working at all.
 */
import { computed, ref } from 'vue'
import {
  useListAllBlindDateOffers,
  useListBlindDateApplications,
  useListBlindDateExclusions,
} from '@/api/moderation/moderation'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import BlindDateQueuePanel from '@/components/moderation/BlindDateQueuePanel.vue'
import BlindDateOffersPanel from '@/components/moderation/BlindDateOffersPanel.vue'
import BlindDateExclusionsPanel from '@/components/moderation/BlindDateExclusionsPanel.vue'
import BlindDateParticipationPanel from '@/components/moderation/BlindDateParticipationPanel.vue'
import BlindDateFeedbackPanel from '@/components/moderation/BlindDateFeedbackPanel.vue'

const tab = ref<string>('queue')

const { data: applications } = useListBlindDateApplications()
const { data: offers } = useListAllBlindDateOffers()
const { data: exclusions } = useListBlindDateExclusions()

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
  // No count beside it: that would be „how many members have ever taken part", a number that only
  // grows and asks for nothing. The other three count something still waiting to be done.
  { value: 'participation', label: 'Teilnahmen' },
  // No count here either: every answer stays for ever, so the number would only ever grow. The
  // three that carry one all count something still waiting to be done.
  { value: 'feedback', label: 'Rückmeldungen' },
])
</script>

<template>
  <ModerationPage
    title="Blind-Date"
    description="Bewerbungen zuordnen, Handlungen anbieten, und wer nicht teilnehmen darf. Die Gruppen entstehen privat und pseudonymisiert — wer mit wem schreibt, erfahren die beiden erst, wenn sie es beide wollen."
  >
    <ModerationTabs v-model="tab" :tabs="tabs" label="Ansichten" />

    <div class="mt-5">
      <BlindDateQueuePanel v-if="tab === 'queue'" />
      <BlindDateOffersPanel v-else-if="tab === 'offers'" />
      <BlindDateExclusionsPanel v-else-if="tab === 'exclusions'" />
      <BlindDateParticipationPanel v-else-if="tab === 'participation'" />
      <BlindDateFeedbackPanel v-else />
    </div>
  </ModerationPage>
</template>
