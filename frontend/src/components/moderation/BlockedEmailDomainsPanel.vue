<script setup lang="ts">
/**
 * The email domains that may not register, for the administration area. Administrator-only, and
 * the API refuses independently — this list changes who may join at all, not what happens to one
 * account, which is why it sits at a higher permission than the rest of the moderation tools.
 */
import { computed, ref } from 'vue'
import {
  getListBlockedEmailDomainsQueryKey,
  useBlockEmailDomain,
  useListBlockedEmailDomains,
  useUnblockEmailDomain,
} from '@/api/moderation/moderation'
import type { ListBlockedEmailDomains200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBlockedEmailDomains()

const domains = computed<ListBlockedEmailDomains200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const domain = ref<string>('')
const note = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: block, isPending: isBlocking } = useBlockEmailDomain()
const { mutateAsync: unblock, isPending: isUnblocking } = useUnblockEmailDomain()

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListBlockedEmailDomainsQueryKey() })
}

async function add() {
  const value = domain.value.trim().toLowerCase()
  if (value.length === 0) return

  error.value = undefined

  try {
    await block({
      data: { domain: value, ...(note.value.trim() === '' ? {} : { note: note.value.trim() }) },
    })
  } catch {
    error.value =
      'Das hat nicht geklappt. Prüfe, ob du nur die Domain angegeben hast, etwa beispiel.de.'
    return
  }

  domain.value = ''
  note.value = ''
  await refresh()
}

async function remove(value: string) {
  error.value = undefined

  try {
    await unblock({ domain: value })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[60ch] text-note text-ink-5">
      Mit diesen Domains kann sich niemand registrieren. Verglichen wird genau die Domain, nie ihre
      Endung — „mail.com" zu sperren würde sonst „gmail.com" mitnehmen.
    </p>

    <form class="mt-4 flex flex-wrap items-center gap-2" @submit.prevent="add">
      <Input
        v-model="domain"
        aria-label="Domain"
        placeholder="beispiel.de"
        autocapitalize="none"
        spellcheck="false"
        class="w-full sm:w-[220px]"
      />
      <Input
        v-model="note"
        :maxlength="TEXT_LIMIT.blockEmailDomain.note.maxLength"
        aria-label="Notiz, optional"
        placeholder="Notiz, optional"
        class="w-full sm:w-[320px]"
      />
      <Button type="submit" variant="outline" size="sm" :disabled="isBlocking">Sperren</Button>
    </form>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>

    <div v-if="isPending" class="mt-4 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="domains.length === 0" class="mt-4 text-note text-ink-5">
      Zurzeit ist keine Domain gesperrt.
    </p>

    <ul v-else class="mt-4 flex flex-col">
      <li
        v-for="entry in domains"
        :key="entry.domain"
        class="border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="font-mono text-row text-ink-2">{{ entry.domain }}</p>
          <Button variant="ghost" size="xs" :disabled="isUnblocking" @click="remove(entry.domain)">
            Freigeben
          </Button>
        </div>
        <p v-if="entry.note" class="mt-1 text-[12.5px] text-ink-4">{{ entry.note }}</p>
        <p v-if="entry.addedBy" class="mt-1 text-[12px] text-ink-6">
          {{ entry.addedBy.username }}, {{ formatActivityTime(entry.addedAt) }}
        </p>
      </li>
    </ul>
  </div>
</template>
