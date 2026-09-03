<script setup lang="ts">
/**
 * Everyone currently on the watchlist, for the administration area. Read-only by design: adding
 * somebody happens on their profile, where whoever is deciding can see who they are.
 */
import { computed, ref } from 'vue'
import {
  getListWatchlistQueryKey,
  useListWatchlist,
  useRemoveFromWatchlist,
} from '@/api/moderation/moderation'
import type { ListWatchlist200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListWatchlist()

const entries = computed<ListWatchlist200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const error = ref<string | undefined>(undefined)
const { mutateAsync: remove, isPending: isRemoving } = useRemoveFromWatchlist()

async function takeOff(userId: string) {
  error.value = undefined

  try {
    await remove({ userId })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() })
}
</script>

<template>
  <div>
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="entries.length === 0" class="text-note text-ink-5">
      Zurzeit steht niemand auf der Beobachtungsliste. Hinzufügen kannst du jemanden auf dem
      jeweiligen Profil.
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="entry in entries"
        :key="entry.user.id"
        class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <RouterLink
            :to="{ name: 'member', params: { userId: entry.user.id } }"
            class="text-row text-oak-deep hover:underline"
          >
            {{ entry.user.username }}
          </RouterLink>
          <Button variant="ghost" size="xs" :disabled="isRemoving" @click="takeOff(entry.user.id)">
            Von der Liste nehmen
          </Button>
        </div>
        <p class="mt-1 text-[12.5px] text-ink-4">{{ entry.note }}</p>
        <p class="mt-1 text-[12px] text-ink-6">
          {{ entry.addedBy?.username ?? 'ein gelöschtes Konto' }},
          {{ formatActivityTime(entry.addedAt) }}
        </p>
      </li>
    </ul>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </div>
</template>
