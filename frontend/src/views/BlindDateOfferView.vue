<script setup lang="ts">
/**
 * One offered plot, whole.
 *
 * Where „Weiterlesen" goes. A page rather than a box that unfolds on the overview, because a plot
 * worth eight thousand characters is worth an address somebody can send to a friend — and because
 * an overview whose cards can each triple in height is the layout this was meant to fix.
 *
 * Line breaks kept and nothing else interpreted, exactly as a custom page renders one: this is text
 * the team typed, and a description that renders markup is a hole waiting for the day somebody
 * pastes into it.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGetBlindDateOffer } from '@/api/blind-date/blind-date'
import type { GetBlindDateOffer200 } from '@/api/models'
import { ApiError } from '@/lib/api/apiFetch'
import { applicationsHaveClosed } from '@/lib/blindDate/offerDeadline'
import { formatDeadline } from '@/lib/format/formatTime'
import AppLayout from '@/components/layout/AppLayout.vue'
import { Spinner } from '@/components/ui/spinner'

const route = useRoute()
const offerId = computed<string>(() => String(route.params.offerId))

const { data, isPending, error } = useGetBlindDateOffer(offerId)

const offer = computed<GetBlindDateOffer200 | undefined>(() =>
  data.value?.status === 200 ? data.value.data : undefined,
)

// From `error`, not `data`: the mutator throws on any non-2xx, so no status reaches `data`.
const notFound = computed<boolean>(
  () => error.value instanceof ApiError && error.value.status === 404,
)

const PAIRINGS: Record<string, string> = {
  fm: 'F × M',
  ff: 'F × F',
  mm: 'M × M',
  dd: 'D × D',
  any: 'Egal',
}

const pairingLabel = computed<string | undefined>(() =>
  offer.value?.pairing ? PAIRINGS[offer.value.pairing] : undefined,
)
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <RouterLink
        :to="{ name: 'blindDate' }"
        class="text-[12.5px] text-ink-5 underline-offset-[5px] hover:underline"
      >
        ← Zurück zum Blind-Date
      </RouterLink>

      <div v-if="isPending" class="mt-6 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <template v-else-if="offer">
        <h1 class="mt-4 text-h1">{{ offer.title }}</h1>

        <div
          v-if="pairingLabel || offer.genres.length > 0"
          class="mt-3 flex flex-wrap items-center gap-1.5"
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

        <div class="mt-5 max-w-[70ch] text-body leading-[1.7] whitespace-pre-line text-ink-3">
          {{ offer.description }}
        </div>

        <section v-if="offer.roles.length > 0" class="mt-7 border-t border-line-3 pt-5">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Rollen</h2>
          <ul class="mt-2 flex flex-col">
            <li
              v-for="role in offer.roles"
              :key="role"
              class="border-t border-line-2 py-2 text-row text-ink-3 first:border-t-0 first:pt-0"
            >
              {{ role }}
            </li>
          </ul>
        </section>

        <p v-if="offer.closesAt" class="mt-6 text-note text-ink-5">
          <template v-if="applicationsHaveClosed(offer.closesAt)">
            Die Bewerbungsfrist für diese Handlung ist abgelaufen.
          </template>
          <template v-else>
            Bewerbung möglich bis {{ formatDeadline(offer.closesAt) }}. Bewerben kannst du dich auf
            der Blind-Date-Seite.
          </template>
        </p>
      </template>

      <template v-else-if="notFound">
        <h1 class="mt-4 text-h1">Diese Handlung gibt es nicht mehr</h1>
        <p class="mt-4 max-w-[65ch] text-note text-ink-5">
          Sie wurde geschlossen, oder der Link stimmt nicht. Was gerade offen ist, steht auf der
          Blind-Date-Seite.
        </p>
      </template>
    </div>
  </AppLayout>
</template>
