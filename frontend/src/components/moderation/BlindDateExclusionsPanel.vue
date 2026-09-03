<script setup lang="ts">
/**
 * Who may not take part in Blind-Date.
 *
 * **Its own list, deliberately not a mark on the watchlist.** That list says of itself, on its own
 * two tabs, that it is „kein Vorfall und keine Konsequenz" — and an exclusion is exactly a
 * consequence. Putting one there would make that sentence untrue and cost the watchlist the only
 * thing it means. Same shape, honest meaning.
 *
 * Read-only for adding by id: excluding somebody happens from their profile, where whoever decides
 * can see who they are — the same rule the watchlist follows for the same reason.
 */
import { computed, ref } from 'vue'
import {
  getListBlindDateExclusionsQueryKey,
  useListBlindDateExclusions,
  useRemoveBlindDateExclusion,
} from '@/api/moderation/moderation'
import type { ListBlindDateExclusions200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBlindDateExclusions()

const exclusions = computed<ListBlindDateExclusions200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const error = ref<string | undefined>(undefined)
const { mutateAsync: remove, isPending: isRemoving } = useRemoveBlindDateExclusion()

async function lift(userId: string) {
  error.value = undefined

  try {
    await remove({ userId })
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListBlindDateExclusionsQueryKey() })
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Wer hier steht, kann sich nicht mehr bewerben; eine wartende Bewerbung wird beim Eintragen mit
      zurückgezogen. Ein bereits laufendes Blind-Date bleibt davon unberührt — der Eintrag hebt die
      Hürde für das nächste, er beendet nicht das aktuelle.
    </p>

    <p class="mt-2 max-w-[70ch] text-[12.5px] leading-[1.5] text-ink-5">
      Eintragen kannst du jemanden auf dessen Profil. Diese Liste ist bewusst getrennt von der
      Beobachtungsliste: die ist kein Vorfall und keine Konsequenz — ein Ausschluss ist beides.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="exclusions.length === 0" class="mt-5 text-note text-ink-5">
      Zurzeit ist niemand vom Blind-Date ausgeschlossen.
    </p>

    <ul v-else class="mt-4 flex flex-col">
      <li
        v-for="entry in exclusions"
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
          <Button variant="ghost" size="xs" :disabled="isRemoving" @click="lift(entry.user.id)">
            Wieder zulassen
          </Button>
        </div>
        <p class="mt-1 text-[12.5px] text-ink-4">{{ entry.reason }}</p>
        <p class="mt-1 text-[12px] text-ink-6">
          {{ entry.addedBy?.username ?? 'ein gelöschtes Konto' }},
          {{ formatActivityTime(entry.addedAt) }}
        </p>
      </li>
    </ul>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </div>
</template>
