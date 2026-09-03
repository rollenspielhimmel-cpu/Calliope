<script setup lang="ts">
/**
 * The operators' tools on a member's profile, as a row of small icons beside the buttons any
 * member gets. Quiet on purpose: these are looked up occasionally, and they should not be the
 * loudest thing on somebody's page.
 *
 * Each opens what it needs rather than unfolding it in place — the watchlist is one field, the
 * warnings are a history and a form, the addresses are a list — so the profile stays a profile.
 */
import { computed, ref } from 'vue'
import { Eye, Globe, ShieldAlert } from '@lucide/vue'
import {
  getListWatchlistQueryKey,
  useListWatchlist,
  useRemoveFromWatchlist,
} from '@/api/moderation/moderation'
import { queryClient } from '@/lib/api/queryClient'
import { useIpAddressView } from '@/composables/useIpAddressView'
import { TooltipProvider } from '@/components/ui/tooltip'
import ModerationToolButton from '@/components/moderation/ModerationToolButton.vue'
import WatchlistDialog from '@/components/moderation/WatchlistDialog.vue'
import MemberStrikeDialog from '@/components/moderation/MemberStrikeDialog.vue'
import MemberIpDialog from '@/components/moderation/MemberIpDialog.vue'

const props = defineProps<{
  userId: string
  username: string
  /** Passed down from the profile, which already resolved it — this avoids a second request. */
  mayModerate: boolean
  /** The strike tools are absent on one's own profile: an operator cannot be given a strike. */
  isOwnProfile: boolean
}>()

const { enabled: ipAddressViewEnabled } = useIpAddressView()

// Short by nature, wanted on any profile an operator opens, and it saves an endpoint that would
// exist for one caller — so the list is read rather than a per-member lookup.
const { data } = useListWatchlist({ query: { enabled: computed(() => props.mayModerate) } })

const isWatched = computed<boolean>(() =>
  data.value?.status === 200
    ? data.value.data.some((entry) => entry.user.id === props.userId)
    : false,
)

const watching = ref<boolean>(false)
const striking = ref<boolean>(false)
const showingAddresses = ref<boolean>(false)
const error = ref<string | undefined>(undefined)

const { mutateAsync: remove, isPending: isRemoving } = useRemoveFromWatchlist()

/**
 * Off is one click, because taking somebody off needs no explanation. On opens the one field it
 * needs: an entry without a note is one nobody can act on later, and the list is read by whoever
 * is on shift rather than by whoever wrote it.
 */
async function toggleWatchlist() {
  if (!isWatched.value) {
    watching.value = true
    return
  }

  error.value = undefined

  try {
    await remove({ userId: props.userId })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() })
}
</script>

<template>
  <div v-if="mayModerate" class="w-full sm:w-auto">
    <TooltipProvider>
      <div class="flex flex-wrap items-center gap-0.5">
        <ModerationToolButton
          :icon="Eye"
          :label="isWatched ? 'Von der Beobachtungsliste nehmen' : 'Auf die Beobachtungsliste'"
          :active="isWatched"
          :disabled="isRemoving"
          @click="toggleWatchlist"
        />

        <ModerationToolButton
          v-if="!isOwnProfile"
          :icon="ShieldAlert"
          label="Verwarnungen und Sperrungen"
          @click="striking = true"
        />

        <!-- Only when the switch is on: an address says where somebody sits, so it is looked up
             deliberately rather than carried on every profile that happens to open. -->
        <ModerationToolButton
          v-if="ipAddressViewEnabled"
          :icon="Globe"
          label="IP-Adressen"
          @click="showingAddresses = true"
        />
      </div>
    </TooltipProvider>

    <p v-if="error" class="mt-2 text-[12.5px] text-destructive" role="alert">{{ error }}</p>

    <WatchlistDialog
      v-model:open="watching"
      :user-id="userId"
      :username="username"
      :note="data?.status === 200 ? data.data.find((e) => e.user.id === userId)?.note : undefined"
    />

    <MemberStrikeDialog v-model:open="striking" :user-id="userId" :username="username" />

    <MemberIpDialog v-model:open="showingAddresses" :user-id="userId" :username="username" />
  </div>
</template>
