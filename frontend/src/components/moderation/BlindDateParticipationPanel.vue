<script setup lang="ts">
/**
 * How each member's Blind-Dates have gone: seen through, broken off, still running.
 *
 * **Behind the operator gate, and it stays there.** The same figures side by side with names beside
 * them are a ranking, and the design system rules those out for anything a member can see — the
 * research behind that rule is about pressure, and a public version of this table would be exactly
 * that. Here it is casework: whether somebody leaves people mid-story often enough to be a pattern
 * is a question nobody can answer one application at a time.
 *
 * **Left first by default**, not broken-off first: one of the two ended it and the other was
 * ended on, and only the first is a pattern about this member. Both numbers are shown, because the
 * difference is the point. The column headers reorder it, so „who has seen the most through" and
 * „who was matched last" need no second view.
 *
 * Only members who have been in at least one appear. A row of noughts for everybody else would
 * bury the handful worth reading.
 */
import { computed, ref, watch } from 'vue'
import { useListBlindDateParticipation } from '@/api/moderation/moderation'
import type {
  ListBlindDateParticipation200ResultsItem,
  ListBlindDateParticipationBody,
  ListBlindDateParticipationBodySortAttribute,
} from '@/api/models'
import { usePagedList } from '@/composables/usePagedList'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import ListPagination from '@/components/common/ListPagination.vue'
import { Spinner } from '@/components/ui/spinner'

const PAGE_SIZE = 25

type SortAttribute = ListBlindDateParticipationBodySortAttribute

const sortAttribute = ref<SortAttribute>('endedByThem')

/**
 * Descending for the counts, ascending for the name. „Die meisten Abbrüche" and „von A an" are both
 * what somebody means when they click that header, and making them pick the direction as well
 * would be a second decision for no gain.
 */
const sortOrder = computed<'asc' | 'desc'>(() =>
  sortAttribute.value === 'username' ? 'asc' : 'desc',
)

const { page, offset, total, itemsPerPage, goToPage } = usePagedList(
  PAGE_SIZE,
  () => totalResults.value,
)

const body = computed<ListBlindDateParticipationBody>(() => ({
  limit: PAGE_SIZE,
  offset: offset.value,
  sortAttribute: sortAttribute.value,
  sortOrder: sortOrder.value,
}))

const { data, isPending } = useListBlindDateParticipation(body)

const rows = computed<ListBlindDateParticipation200ResultsItem[]>(() =>
  data.value?.status === 200 ? data.value.data.results : [],
)

const totalResults = computed<number>(() =>
  data.value?.status === 200 ? data.value.data.totalResults : 0,
)

// Back to the first page whenever the order changes: page 4 of one ordering is not page 4 of
// another, and staying put would show a stretch of the list nobody asked for.
watch(sortAttribute, () => goToPage(1))

const COLUMNS: ReadonlyArray<{ value: SortAttribute; label: string }> = [
  { value: 'username', label: 'Mitglied' },
  { value: 'revealed', label: 'Enthüllt' },
  { value: 'endedByThem', label: 'Selbst beendet' },
  { value: 'ended', label: 'Beendet' },
  { value: 'running', label: 'Läuft' },
  { value: 'lastMatchedAt', label: 'Zuletzt zugeordnet' },
]

/**
 * The reasons, in the team's own words. An unknown token is shown as it stands rather than
 * swallowed — a reason nobody has translated yet is still a reason somebody has to read.
 */
const REASONS: Record<string, string> = {
  name_revealed: 'Name genannt',
  ended_by_partner: 'Von einer Seite beendet',
}

function reasonLabel(reason: string): string {
  return REASONS[reason] ?? reason
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Wie die Blind-Dates der einzelnen Mitglieder ausgegangen sind. Nur hier sichtbar — Mitglieder
      sehen weder diese Tabelle noch die Zahlen anderer.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <p v-if="rows.length === 0" class="mt-5 max-w-[70ch] text-note text-ink-5">
        Noch war niemand in einem Blind-Date.
      </p>

      <template v-else>
        <!-- Headers as buttons: reordering is the whole use of this table, and a header that
             cannot be clicked would send somebody looking for a control that is not there. -->
        <div
          class="mt-5 grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-5 border-b border-line-3 pb-2"
        >
          <button
            v-for="column in COLUMNS"
            :key="column.value"
            type="button"
            class="font-mono text-[11px] tracking-wide text-ink-label uppercase"
            :class="[
              column.value === 'username' ? 'text-left' : 'text-right',
              sortAttribute === column.value ? 'text-ink-3' : 'hover:text-ink-4',
            ]"
            @click="sortAttribute = column.value"
          >
            {{ column.label }}
          </button>
        </div>

        <ul class="flex flex-col">
          <li
            v-for="row in rows"
            :key="row.id"
            class="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-baseline gap-x-5 border-b border-line-2 py-2.5"
          >
            <div class="min-w-0">
              <RouterLink
                :to="{ name: 'member', params: { userId: row.id } }"
                class="text-row text-ink-2 underline-offset-[5px] hover:underline"
              >
                {{ row.username }}
              </RouterLink>
              <!-- Beside the name rather than in a column of its own: „zwei abgebrochen" means
                   something different when the guard ended them than when the two agreed to stop. -->
              <p v-if="row.endedReasons.length > 0" class="mt-0.5 text-[12px] text-ink-6">
                {{ row.endedReasons.map(reasonLabel).join(' · ') }}
              </p>
            </div>

            <span class="text-right text-[12.5px] text-ink-4">{{ formatCount(row.revealed) }}</span>
            <span class="text-right text-[12.5px] text-ink-4">
              {{ formatCount(row.endedByThem) }}
            </span>
            <span class="text-right text-[12.5px] text-ink-4">{{ formatCount(row.ended) }}</span>
            <span class="text-right text-[12.5px] text-ink-4">{{ formatCount(row.running) }}</span>
            <span class="text-right text-[12px] text-ink-6">
              {{ row.lastMatchedAt ? formatActivityTime(row.lastMatchedAt) : '—' }}
            </span>
          </li>
        </ul>

        <div v-if="totalResults > PAGE_SIZE" class="mt-5 border-t border-line-2 pt-3">
          <ListPagination v-model:page="page" :total="total" :items-per-page="itemsPerPage" />
        </div>
      </template>
    </template>
  </div>
</template>
