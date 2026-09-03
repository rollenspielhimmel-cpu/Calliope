<script setup lang="ts">
/**
 * The addresses a member has connected from, opened from their profile rather than sitting on it.
 *
 * Sharing an address is evidence, not a verdict: households, universities and phone networks all
 * produce it honestly — which is why the copy says „genutzt" and offers a link rather than a
 * judgement, and why banning an address is a separate decision from banning an account.
 */
import { computed, ref } from 'vue'
import {
  getListIpAddressesForMemberQueryKey,
  useBanIpAddress,
  useListIpAddressesForMember,
} from '@/api/moderation/moderation'
import type { ListIpAddressesForMember200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ userId: string; username: string }>()

// Nothing is asked for until the dialog is actually opened.
const { data, isPending } = useListIpAddressesForMember(() => props.userId, {
  query: { enabled: open },
})

const entries = computed<ListIpAddressesForMember200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const banningAddress = ref<string | undefined>(undefined)
const reason = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: banAddress, isPending: isBanning } = useBanIpAddress()

function startBan(ipAddress: string) {
  banningAddress.value = banningAddress.value === ipAddress ? undefined : ipAddress
  reason.value = ''
  error.value = undefined
}

async function confirmBan(ipAddress: string) {
  const note = reason.value.trim()
  if (note.length === 0) return

  error.value = undefined

  try {
    await banAddress({ data: { ipAddress, reason: note } })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  banningAddress.value = undefined
  reason.value = ''
  await queryClient.invalidateQueries({
    queryKey: getListIpAddressesForMemberQueryKey(props.userId),
  })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>IP-Adressen von „{{ props.username }}“</DialogTitle>
        <DialogDescription>
          Von diesen Adressen hat sich das Konto angemeldet, die zuletzt genutzte zuerst.
        </DialogDescription>
      </DialogHeader>

      <div class="flex max-h-[60vh] flex-col gap-3 overflow-auto">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
          <Spinner />
          Einen Moment.
        </div>

        <p v-else-if="entries.length === 0" class="text-note text-ink-5">
          Für dieses Konto ist keine Anmeldung mit Adresse gespeichert.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="entry in entries"
            :key="entry.ipAddress"
            class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="font-mono text-row text-ink-2">{{ entry.ipAddress }}</p>
              <Button variant="ghost" size="xs" @click="startBan(entry.ipAddress)">
                {{ banningAddress === entry.ipAddress ? 'Abbrechen' : 'Adresse sperren' }}
              </Button>
            </div>

            <p class="mt-1 text-[12px] text-ink-6">
              Zuletzt {{ formatActivityTime(entry.lastSeenAt) }}, zuerst
              {{ formatActivityTime(entry.firstSeenAt) }}
            </p>

            <p v-if="entry.sharedWith.length > 0" class="mt-2 text-[12.5px] text-ink-5">
              Auch genutzt von
              <template v-for="(account, index) in entry.sharedWith" :key="account.id">
                <RouterLink
                  :to="{ name: 'member', params: { userId: account.id } }"
                  class="text-oak-deep hover:underline"
                  @click="open = false"
                >
                  {{ account.username }} </RouterLink
                ><span v-if="index < entry.sharedWith.length - 1">, </span>
              </template>
            </p>

            <form
              v-if="banningAddress === entry.ipAddress"
              class="mt-3 flex flex-wrap items-center gap-2"
              @submit.prevent="confirmBan(entry.ipAddress)"
            >
              <Input
                v-model="reason"
                :maxlength="TEXT_LIMIT.banIpAddress.reason.maxLength"
                :aria-label="`Grund für die Sperre von ${entry.ipAddress}`"
                placeholder="Grund für die Sperre"
                class="flex-1"
              />
              <Button type="submit" variant="outline" size="sm" :disabled="isBanning">
                Sperren
              </Button>
            </form>
          </li>
        </ul>
      </div>
    </DialogContent>
  </Dialog>
</template>
