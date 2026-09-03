<script setup lang="ts">
/**
 * Everything the operators may know about the addresses behind the accounts, in three views of
 * one subject.
 *
 * The three are deliberately the same facts asked three ways. **Übersicht** is per member and
 * answers "where has this one been seen"; **Gesperrt** is per banned address and answers "who did
 * this ban reach"; **Übereinstimmungen** is per shared address and answers "where is something
 * worth looking at" — the third exists because finding that in a member table means reading every
 * row, and it is the question moderation actually opens this tool with.
 *
 * **A shared address is a reason to look, never a finding.** A household, a school and a phone
 * network behind CGNAT all put unrelated people on one address. The wording here says so rather
 * than calling these accounts alts, because the interface is what somebody will quote back.
 *
 * Banning still happens on a member's profile, where the history that justifies it is in front of
 * whoever decides; this page lifts a ban but does not place one.
 */
import { computed, ref, watch } from 'vue'
import {
  getListBannedIpsQueryKey,
  useListBannedIps,
  useListIpOverview,
  useListSharedIpAddresses,
  useUnbanIpAddress,
} from '@/api/moderation/moderation'
import type {
  ListBannedIps200Item,
  ListIpOverview200ResultsItem,
  ListIpOverviewBody,
  ListSharedIpAddresses200ResultsItem,
  ListSharedIpAddressesBody,
} from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import { usePagedList } from '@/composables/usePagedList'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import ListPagination from '@/components/common/ListPagination.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const PAGE_SIZE = 25

const tab = ref<string>('overview')

/* ── Tab 1: every member, with their addresses and who shares them ─────────────────────────── */

const search = ref<string>('')

const {
  page: overviewPage,
  offset: overviewOffset,
  total: overviewTotal,
  itemsPerPage: overviewPerPage,
  goToPage: goToOverviewPage,
} = usePagedList(PAGE_SIZE, () => overviewTotalResults.value)

const overviewBody = computed<ListIpOverviewBody>(() => ({
  limit: PAGE_SIZE,
  offset: overviewOffset.value,
  sortAttribute: 'username',
  sortOrder: 'asc',
  // Below the endpoint's own minimum the field is left out rather than sent: two characters is
  // not a search, and sending them would be a 400 while somebody is still typing.
  ...(search.value.trim().length >= 3 ? { search: search.value.trim() } : {}),
}))

const { data: overviewData, isPending: overviewPending } = useListIpOverview(overviewBody)

const members = computed<ListIpOverview200ResultsItem[]>(() =>
  overviewData.value?.status === 200 ? overviewData.value.data.results : [],
)

const overviewTotalResults = computed<number>(() =>
  overviewData.value?.status === 200 ? overviewData.value.data.totalResults : 0,
)

// Back to the first page whenever the question changes: page 4 of the old search is not page 4
// of the new one, and landing on an empty page reads as "no results".
watch(search, () => goToOverviewPage(1))

/* ── Tab 2: the bans themselves ────────────────────────────────────────────────────────────── */

const { data: bansData, isPending: bansPending } = useListBannedIps()

const bans = computed<ListBannedIps200Item[]>(() =>
  bansData.value?.status === 200 ? bansData.value.data : [],
)

const error = ref<string | undefined>(undefined)
const { mutateAsync: unban, isPending: isUnbanning } = useUnbanIpAddress()

async function lift(ipAddress: string) {
  error.value = undefined

  try {
    await unban({ ipAddress })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListBannedIpsQueryKey() })
}

/* ── Tab 3: addresses more than one account has used ───────────────────────────────────────── */

const {
  page: sharedPage,
  offset: sharedOffset,
  total: sharedTotal,
  itemsPerPage: sharedPerPage,
} = usePagedList(PAGE_SIZE, () => sharedTotalResults.value)

const sharedBody = computed<ListSharedIpAddressesBody>(() => ({
  limit: PAGE_SIZE,
  offset: sharedOffset.value,
  sortAttribute: 'accountCount',
  sortOrder: 'desc',
}))

const { data: sharedData, isPending: sharedPending } = useListSharedIpAddresses(sharedBody)

const shared = computed<ListSharedIpAddresses200ResultsItem[]>(() =>
  sharedData.value?.status === 200 ? sharedData.value.data.results : [],
)

const sharedTotalResults = computed<number>(() =>
  sharedData.value?.status === 200 ? sharedData.value.data.totalResults : 0,
)

/* ── The strip ─────────────────────────────────────────────────────────────────────────────── */

const tabs = computed<ModerationTab[]>(() => [
  { value: 'overview', label: 'Übersicht' },
  { value: 'bans', label: 'Gesperrt', count: bans.value.length },
  // Counted, because the number *is* the news: a zero here is a quiet night.
  { value: 'shared', label: 'Übereinstimmungen', count: sharedTotalResults.value },
])

/** Which addresses are banned, so the other two tabs can say so without asking again. */
const bannedAddresses = computed<Set<string>>(() => new Set(bans.value.map((ban) => ban.ipAddress)))
</script>

<template>
  <ModerationPage
    title="IP-Adressen und Sperren"
    description="Woher Konten sich angemeldet haben, welche Adressen gesperrt sind, und wo mehrere Konten dieselbe Adresse teilen. Gesperrt wird eine Adresse auf dem Profil des Mitglieds, das sie genutzt hat."
  >
    <ModerationTabs v-model="tab" :tabs="tabs" label="Ansichten" />

    <!-- Tab 1 ─ every member -->
    <div v-if="tab === 'overview'" class="mt-5">
      <Input
        v-model="search"
        type="search"
        placeholder="Nach Benutzernamen suchen"
        class="max-w-[320px]"
        autocomplete="off"
      />

      <div v-if="overviewPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <p v-else-if="members.length === 0" class="mt-5 text-note text-ink-5">
        Kein Konto passt zu dieser Suche.
      </p>

      <!-- The table scrolls inside its own container rather than squeezing: three columns of
           addresses and names do not survive 375px, and a wrapped IP address is unreadable. The
           page itself never scrolls sideways. -->
      <div v-else class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr class="border-b border-line-3">
              <th
                v-for="heading in ['Name', 'IP-Adresse(n)', 'Mögliche Nebenaccounts']"
                :key="heading"
                class="pb-2 font-mono text-[11px] font-normal tracking-wide text-ink-label uppercase"
              >
                {{ heading }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in members" :key="member.id" class="border-b border-line-2 align-top">
              <td class="py-3 pr-4">
                <RouterLink
                  :to="{ name: 'member', params: { userId: member.id } }"
                  class="text-row text-ink-2 underline-offset-[5px] hover:underline"
                >
                  {{ member.username }}
                </RouterLink>
                <p class="mt-0.5 text-[12px] text-ink-6">{{ member.emailAddress }}</p>
                <p v-if="member.bannedAt" class="mt-0.5 text-[12px] text-destructive">Gesperrt</p>
              </td>

              <td class="py-3 pr-4">
                <p v-if="member.ipAddresses.length === 0" class="text-[12.5px] text-ink-6">
                  Noch keine Anmeldung
                </p>
                <ul v-else class="flex flex-col gap-0.5">
                  <li
                    v-for="address in member.ipAddresses"
                    :key="address"
                    class="font-mono text-[12.5px] text-ink-4"
                  >
                    {{ address }}
                    <span v-if="bannedAddresses.has(address)" class="ml-1 text-destructive">
                      gesperrt
                    </span>
                  </li>
                </ul>
              </td>

              <td class="py-3">
                <p v-if="member.possibleAlts.length === 0" class="text-[12.5px] text-ink-6">—</p>
                <ul v-else class="flex flex-wrap gap-x-2 gap-y-0.5">
                  <li v-for="alt in member.possibleAlts" :key="alt.id" class="text-[12.5px]">
                    <RouterLink
                      :to="{ name: 'member', params: { userId: alt.id } }"
                      class="text-ink-4 underline-offset-[5px] hover:underline"
                    >
                      {{ alt.username }}
                    </RouterLink>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="overviewTotalResults > PAGE_SIZE" class="mt-5 border-t border-line-2 pt-3">
        <ListPagination
          v-model:page="overviewPage"
          :total="overviewTotal"
          :items-per-page="overviewPerPage"
        />
      </div>
    </div>

    <!-- Tab 2 ─ the bans -->
    <div v-else-if="tab === 'bans'" class="mt-5">
      <p class="max-w-[70ch] text-note text-ink-5">
        Von diesen Adressen wird jede Anfrage abgewiesen, unabhängig davon, wer sich anmeldet. Eine
        Adressensperre hängt bewusst nicht am Konto: Adressen werden geteilt.
      </p>

      <div v-if="bansPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <p v-else-if="bans.length === 0" class="mt-5 text-note text-ink-5">
        Zurzeit ist keine Adresse gesperrt.
      </p>

      <ul v-else class="mt-4 flex flex-col">
        <li
          v-for="ban in bans"
          :key="ban.ipAddress"
          class="border-t border-line-3 py-3.5 first:border-t-0 first:pt-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="font-mono text-row text-ink-2">{{ ban.ipAddress }}</p>
            <Button variant="ghost" size="xs" :disabled="isUnbanning" @click="lift(ban.ipAddress)">
              Sperre aufheben
            </Button>
          </div>

          <p class="mt-1 text-[12.5px] text-ink-4">{{ ban.reason }}</p>
          <p class="mt-1 text-[12px] text-ink-6">
            {{ ban.bannedBy?.username ?? 'ein gelöschtes Konto' }},
            {{ formatActivityTime(ban.bannedAt) }}
          </p>

          <!-- Who the ban reached. An address is banned, not an account, so without this the
               list cannot say whom it was originally about. -->
          <div class="mt-2 border-t border-line-2 pt-2">
            <p v-if="ban.accounts.length === 0" class="text-[12px] text-ink-6">
              Kein Konto hier hat diese Adresse je genutzt.
            </p>
            <template v-else>
              <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
                Konten von dieser Adresse
              </p>
              <ul class="mt-1.5 flex flex-col gap-1">
                <li
                  v-for="account in ban.accounts"
                  :key="account.id"
                  class="flex flex-wrap items-baseline gap-x-2 text-[12.5px]"
                >
                  <RouterLink
                    :to="{ name: 'member', params: { userId: account.id } }"
                    class="text-ink-3 underline-offset-[5px] hover:underline"
                  >
                    {{ account.username }}
                  </RouterLink>
                  <span class="text-ink-6">{{ account.emailAddress }}</span>
                </li>
              </ul>
            </template>
          </div>
        </li>
      </ul>

      <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
    </div>

    <!-- Tab 3 ─ shared addresses -->
    <div v-else class="mt-5">
      <p class="max-w-[70ch] text-note text-ink-5">
        Adressen, von denen mehrere Konten angemeldet waren, die meistgeteilte zuerst. Das ist ein
        Anlass hinzusehen, kein Befund: eine WG, eine Schule und ein Mobilfunknetz setzen ebenso
        unbeteiligte Menschen auf dieselbe Adresse.
      </p>

      <div v-if="sharedPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <p v-else-if="shared.length === 0" class="mt-5 text-note text-ink-5">
        Zurzeit teilt sich kein Konto eine Adresse mit einem anderen.
      </p>

      <ul v-else class="mt-4 flex flex-col">
        <li
          v-for="match in shared"
          :key="match.id"
          class="border-t border-line-3 py-3.5 first:border-t-0 first:pt-0"
        >
          <div class="flex flex-wrap items-baseline gap-x-2">
            <p class="font-mono text-row text-ink-2">{{ match.ipAddress }}</p>
            <p class="text-[12.5px] text-ink-5">{{ formatCount(match.accountCount) }} Konten</p>
            <p v-if="bannedAddresses.has(match.ipAddress)" class="text-[12.5px] text-destructive">
              gesperrt
            </p>
          </div>

          <ul class="mt-1.5 flex flex-col gap-1">
            <li
              v-for="account in match.accounts"
              :key="account.id"
              class="flex flex-wrap items-baseline gap-x-2 text-[12.5px]"
            >
              <RouterLink
                :to="{ name: 'member', params: { userId: account.id } }"
                class="text-ink-3 underline-offset-[5px] hover:underline"
              >
                {{ account.username }}
              </RouterLink>
              <span class="text-ink-6">{{ account.emailAddress }}</span>
            </li>
          </ul>
        </li>
      </ul>

      <div v-if="sharedTotalResults > PAGE_SIZE" class="mt-5 border-t border-line-2 pt-3">
        <ListPagination
          v-model:page="sharedPage"
          :total="sharedTotal"
          :items-per-page="sharedPerPage"
        />
      </div>
    </div>
  </ModerationPage>
</template>
