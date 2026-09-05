<script setup lang="ts">
/**
 * One offered plot, as a card of fixed height.
 *
 * **Fixed height, and that is the point.** The descriptions run from one line to eight thousand
 * characters, and a grid of cards that each grow to fit turns into a column of wildly different
 * boxes where the longest one decides the whole row. So the card is a fixed frame: the description
 * takes what is left and the deadline sits at the bottom, whatever is above it.
 *
 * **The shortening is measured, not counted** — see `lib/blindDate/truncate.ts` for why, and why
 * not `-webkit-line-clamp`. A description that fits is shown whole, with no ellipsis and no
 * „Weiterlesen": there is nothing behind the link, and a link that leads to what you already read
 * is a small betrayal.
 *
 * The same card serves the members' page and the team's list, because they show the same thing and
 * two of them would drift. What differs is what sits beside it, which is the caller's business.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import type { ListBlindDateOffers200Item } from '@/api/models'
import { shortenToFit } from '@/lib/blindDate/truncate'
import { applicationsHaveClosed } from '@/lib/blindDate/offerDeadline'
import { formatDeadline } from '@/lib/format/formatTime'

const props = defineProps<{
  offer: ListBlindDateOffers200Item
}>()

/**
 * The paragraph is its own measuring tape: `flex-1` fixes its height to whatever the card has
 * left, and `overflow-hidden` keeps it there however much text is inside — so `scrollHeight`
 * greater than `clientHeight` means, exactly, that this text does not fit.
 *
 * Writing into `textContent` during the search rather than through the ref: each candidate has to
 * be measured before the next is chosen, and Vue applies a ref on the next tick. The final value
 * goes through the ref anyway, so the rendered text and the component's state agree.
 */
const body = ref<HTMLElement | null>(null)

const shown = ref<string>(props.offer.description.trim())
const wasCut = ref<boolean>(false)

function refit() {
  const element = body.value

  if (element === null) {
    return
  }

  const result = shortenToFit(props.offer.description, (candidate) => {
    element.textContent = candidate
    return element.scrollHeight <= element.clientHeight
  })

  element.textContent = result.text
  shown.value = result.text
  wasCut.value = result.wasCut
}

onMounted(refit)

// A narrower card fits fewer words, and the rail folding in or out changes the width without the
// window changing at all — which is why this watches the element and not the viewport.
useResizeObserver(body, refit)

watch(() => props.offer.description, refit)

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
    <!--
      The title is the name. There used to be a „Handlung 1“ above it, and a number that comes from
      a position in a list moves whenever the list does — one expires, one is added, and „Handlung 2“
      means a different plot than it did yesterday. It was a second name for something that already
      had one.
    -->
    <p class="text-h2" :class="expired ? 'text-ink-3' : 'text-ink-1'">
      {{ offer.title }}
    </p>

    <!-- Takes the room that is left, so everything under it keeps its place whatever the length. -->
    <p ref="body" class="mt-1.5 flex-1 overflow-hidden text-note leading-[1.45] text-ink-3">
      {{ shown }}
    </p>

    <!--
      The link appears only where something was actually left out — but its row is always here,
      and that is what makes the measuring above possible at all. Otherwise: measure with the full
      text, cut it, the link appears, the paragraph loses a line to it, and the text that just fitted
      no longer does. Reserving the line breaks that circle, and costs every card one line of the
      description rather than costing some cards a correct answer.
    -->
    <div class="mt-1 h-[17px] flex-none">
      <RouterLink
        v-if="wasCut"
        :to="{ name: 'blindDateOffer', params: { offerId: offer.id } }"
        class="text-[12px] text-oak-deep underline-offset-[4px] hover:underline"
      >
        Weiterlesen →
      </RouterLink>
    </div>

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
