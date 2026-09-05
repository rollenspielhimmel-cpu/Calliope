<script setup lang="ts">
/**
 * The three-strikes ladder and the watchlist, on one page.
 *
 * They were two menu items, and that was the mistake: they are read together. Somebody looking at
 * who is on their second warning wants to know whether that person was already being watched, and
 * somebody reading the watchlist wants to know whether an entry has since turned into a strike.
 * Two destinations made that a navigation problem instead of a glance.
 *
 * The ladder comes first because it is the one with consequences attached. A watchlist entry is
 * explicitly neither an incident nor a consequence — the wording says so on both tabs, because it
 * is the thing about this page most easily misread.
 */
import { computed, ref } from 'vue'
import { useListStrikeLadder, useListWatchlist } from '@/api/moderation/moderation'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import StrikeLadderPanel from '@/components/moderation/StrikeLadderPanel.vue'
import WatchlistPanel from '@/components/moderation/WatchlistPanel.vue'

const tab = ref<string>('ladder')

const { data: ladderData } = useListStrikeLadder()
const { data: watchlistData } = useListWatchlist()

const tabs = computed<ModerationTab[]>(() => [
  {
    value: 'ladder',
    label: 'Strike-Leiter',
    count: ladderData.value?.status === 200 ? ladderData.value.data.length : undefined,
  },
  {
    value: 'watchlist',
    label: 'Beobachtungsliste',
    count: watchlistData.value?.status === 200 ? watchlistData.value.data.length : undefined,
  },
])
</script>

<template>
  <ModerationPage
    title="3-Strikes-System &amp; Watchlist"
    description="Wer wo auf der Leiter steht, und wen das Team im Auge behalten wollte. Beides wird auf dem jeweiligen Profil vergeben, wo die Vorgeschichte vor der Person steht, die entscheidet."
  >
    <ModerationTabs v-model="tab" :tabs="tabs" label="Ansichten" />

    <div class="mt-5">
      <StrikeLadderPanel v-if="tab === 'ladder'" />

      <template v-else>
        <p class="max-w-[70ch] text-note text-ink-5">
          Ein Eintrag ist kein Vorfall und keine Konsequenz — nur ein Vermerk für das Team. Wer hier
          steht, hat deshalb nicht zwangsläufig etwas auf der Leiter.
        </p>
        <div class="mt-4">
          <WatchlistPanel />
        </div>
      </template>
    </div>
  </ModerationPage>
</template>
