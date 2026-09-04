<script setup lang="ts">
/**
 * One offered plot, as a card of fixed height.
 *
 * **Fixed height, and that is the point.** The descriptions run from one line to eight thousand
 * characters, and a grid of cards that each grow to fit turns into a column of wildly different
 * boxes where the longest one decides the whole row. So the card is a fixed frame: the description
 * takes what is left and the deadline sits at the bottom, whatever is above it.
 *
 * **The shortening is explicit**, not `-webkit-line-clamp` — see `lib/blindDate/truncate.ts` for
 * why. A short description is shown whole, with no ellipsis and no „Weiterlesen": there is nothing
 * behind the link, and a link that leads to what you already read is a small betrayal.
 *
 * The same card serves the members' page and the team's list, because they show the same thing and
 * two of them would drift. What differs is what sits beside it, which is the caller's business.
 */
import { computed } from 'vue'
import type { ListBlindDateOffers200Item } from '@/api/models'
import { shortenForCard } from '@/lib/blindDate/truncate'
import { applicationsHaveClosed } from '@/lib/blindDate/offerDeadline'
import { formatDeadline } from '@/lib/format/formatTime'

const props = defineProps<{
  offer: ListBlindDateOffers200Item
  /** „Handlung 1“, „Handlung 2“ — the same numbering the rail uses. Omitted where there is none. */
  label?: string
}>()

const shortened = computed(() => shortenForCard(props.offer.description))

/**
 * The pairing, in the notation the community writes it in. Absent where the team did not say,
 * rather than „unbekannt": a chip that says nothing is a chip that costs a place in the row.
 */
const PAIRINGS: Record<string, string> = {
  fm: 'F × M',
  ff: 'F × F',
  mm: 'M × M',
  dd: 'D × D',
  any: 'Egal',
}

const pairingLabel = computed<string | undefined>(() =>
  props.offer.pairing ? PAIRINGS[props.offer.pairing] : undefined,
)

const expired = computed<boolean>(() => applicationsHaveClosed(props.offer.closesAt))
</script>

<template>
  <!--
    An expired card is recessed rather than faded: it sinks into the paper and loses its shadow, but
    every word stays as readable as before. The only people who still see one on the overview are
    those waiting on an application to it, and dimming the text of the plot they are waiting for
    would be punishing them for the deadline. On the team's list it reads the same way — no longer
    live, still theirs to read.
  -->
  <article
    class="flex h-[300px] flex-col rounded-lg p-4"
    :class="
      expired ? 'border border-line-2 bg-paper-2' : 'border border-line-3 bg-paper-0 shadow-card'
    "
  >
    <p v-if="label" class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
      {{ label }}
    </p>

    <p class="mt-1.5 text-h2" :class="expired ? 'text-ink-3' : 'text-ink-1'">
      {{ offer.title }}
    </p>

    <!-- Takes the room that is left, so everything under it keeps its place whatever the length. -->
    <p class="mt-1.5 flex-1 overflow-hidden text-note leading-[1.45] text-ink-3">
      {{ shortened.text }}
    </p>

    <!-- Only where something was actually left out. -->
    <RouterLink
      v-if="shortened.wasCut"
      :to="{ name: 'blindDateOffer', params: { offerId: offer.id } }"
      class="mt-1 text-[12px] text-oak-deep underline-offset-[4px] hover:underline"
    >
      Weiterlesen →
    </RouterLink>

    <!-- Pairing first, then the genres: the first is a fact about the plot, the rest is a mood. -->
    <div
      v-if="pairingLabel || offer.genres.length > 0"
      class="mt-2 flex flex-wrap items-center gap-1.5"
    >
      <span
        v-if="pairingLabel"
        class="rounded-full bg-paper-3 px-2 py-0.5 text-[10.5px] text-ink-3"
      >
        {{ pairingLabel }}
      </span>
      <span
        v-for="genre in offer.genres"
        :key="genre"
        class="rounded-full bg-paper-3 px-2 py-0.5 text-[10.5px] text-ink-3"
      >
        {{ genre }}
      </span>
    </div>

    <p v-if="offer.roles.length > 0" class="mt-2 truncate text-[11.5px] text-ink-5">
      Rollen: {{ offer.roles.join(' · ') }}
    </p>

    <!-- `mt-auto` pins this to the bottom edge, which is what makes a row of cards line up. -->
    <p v-if="offer.closesAt" class="mt-auto pt-2 text-[11px] text-ink-label">
      <template v-if="expired">Bewerbungsfrist abgelaufen</template>
      <template v-else>Bewerbung bis {{ formatDeadline(offer.closesAt) }}</template>
    </p>
  </article>
</template>
