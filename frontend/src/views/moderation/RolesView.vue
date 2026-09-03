<script setup lang="ts">
/**
 * Who holds a platform role, and — for an administrator — granting or revoking one.
 *
 * Deliberately only the two roles the enum already has. A third, such as a mediator or an event
 * manager, would mean replacing a fixed enum with something the operators define, which is a
 * larger decision than this page.
 */
import { computed, ref } from 'vue'
import {
  getListOperatorsQueryKey,
  useListOperators,
  useSetPlatformRole,
} from '@/api/moderation/moderation'
import { useListUsers } from '@/api/users/users'
import { useGetCurrentUser } from '@/api/auth/auth'
import type { ListOperators200Item, ListUsersBody } from '@/api/models'
import { GetCurrentUser200PlatformRole } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { platformRoleLabel } from '@/lib/format/platformRole'
import { TEXT_LIMIT } from '@/api/textLimit'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const { data: currentUserData } = useGetCurrentUser()

const isAdministrator = computed<boolean>(
  () =>
    currentUserData.value?.status === 200 &&
    currentUserData.value.data.platformRole === GetCurrentUser200PlatformRole.administrator,
)

const ownId = computed<string | undefined>(() =>
  currentUserData.value?.status === 200 ? currentUserData.value.data.id : undefined,
)

/**
 * The level above the roles: only this one account grants and revokes „Administration". An
 * ordinary administrator appoints moderators and no more, so the set of administrators can only
 * be changed by the account that cannot itself be changed.
 */
const isPrimordialAdmin = computed<boolean>(
  () => currentUserData.value?.status === 200 && currentUserData.value.data.isPrimordialAdmin,
)

const { data, isPending } = useListOperators()

const operators = computed<ListOperators200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const search = ref<string>('')

const MINIMUM_SEARCH = TEXT_LIMIT.listUsers.search.minLength

const searchBody = computed<ListUsersBody>(() => ({ limit: 10, search: search.value.trim() }))

// Only once the term is long enough for the API to accept it, so typing does not produce a
// stream of 400s on the way to a real search.
const searchEnabled = computed<boolean>(
  () => isAdministrator.value && search.value.trim().length >= MINIMUM_SEARCH,
)

const { data: found } = useListUsers(searchBody, { query: { enabled: searchEnabled } })

const candidates = computed(() => (found.value?.status === 200 ? found.value.data.results : []))

const error = ref<string | undefined>(undefined)
const { mutateAsync: setRole, isPending: isSaving } = useSetPlatformRole()

async function assign(userId: string, platformRole: 'moderator' | 'administrator' | null) {
  error.value = undefined

  try {
    await setRole({ userId, data: { platformRole } })
  } catch {
    error.value =
      'Das ist gerade nicht möglich. Die eigene Rolle kannst du nicht ändern, und ein gesperrtes Konto bekommt keine.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListOperatorsQueryKey() })
}
</script>

<template>
  <ModerationPage
    title="Benutzergruppen"
    description="Wer Moderation oder Administration ist. Moderation handelt an Konten und Inhalten, Administration ändert die Plattform selbst."
  >
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <ul class="flex flex-col">
        <li
          v-for="operator in operators"
          :key="operator.id"
          class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <RouterLink
                :to="{ name: 'member', params: { userId: operator.id } }"
                class="text-row text-oak-deep hover:underline"
              >
                {{ operator.username }}
              </RouterLink>
              <span class="ml-2 text-[12px] text-ink-6">
                {{ platformRoleLabel(operator.platformRole) }}
                <template v-if="operator.isPrimordialAdmin">
                  · Erstes Konto, nicht änderbar
                </template>
              </span>
            </div>

            <!-- Absent on one's own row, because nobody may change their own role — and absent
                 entirely on the first administrator's, whose role nothing can touch. -->
            <div
              v-if="isAdministrator && operator.id !== ownId && !operator.isPrimordialAdmin"
              class="flex flex-wrap gap-2"
            >
              <!-- Only the first administrator may move somebody in or out of „Administration",
                   so an ordinary administrator sees neither button on an administrator's row. -->
              <Button
                v-if="operator.platformRole === 'moderator' && isPrimordialAdmin"
                variant="ghost"
                size="xs"
                :disabled="isSaving"
                @click="assign(operator.id, 'administrator')"
              >
                Zur Administration
              </Button>
              <Button
                v-if="operator.platformRole === 'administrator' && isPrimordialAdmin"
                variant="ghost"
                size="xs"
                :disabled="isSaving"
                @click="assign(operator.id, 'moderator')"
              >
                Zur Moderation
              </Button>
              <Button
                v-if="operator.platformRole === 'moderator' || isPrimordialAdmin"
                variant="ghost"
                size="xs"
                :disabled="isSaving"
                @click="assign(operator.id, null)"
              >
                Rolle entziehen
              </Button>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="operators.length === 0" class="text-note text-ink-5">
        Zurzeit hat niemand eine Rolle. Die erste vergibt die Serverseite über
        <span class="font-mono">deno task grant-role</span>.
      </p>

      <section v-if="isAdministrator" class="mt-8 border-t border-line-3 pt-6">
        <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Rolle vergeben</h2>
        <p class="mt-2 max-w-[60ch] text-note text-ink-5">
          Such ein Mitglied und gib ihm eine Rolle. Ein gesperrtes Konto kann keine bekommen.
          <template v-if="!isPrimordialAdmin">
            Den Status „Administration" vergibt allein das erste Konto.
          </template>
        </p>

        <Input
          v-model="search"
          aria-label="Mitglied suchen"
          placeholder="Benutzername"
          class="mt-3 w-full sm:w-[320px]"
        />

        <ul v-if="candidates.length > 0" class="mt-3 flex flex-col">
          <li
            v-for="candidate in candidates"
            :key="candidate.id"
            class="flex flex-wrap items-baseline justify-between gap-2 border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
          >
            <span class="text-row text-ink-2">{{ candidate.username }}</span>
            <span class="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="xs"
                :disabled="isSaving"
                @click="assign(candidate.id, 'moderator')"
              >
                Moderation
              </Button>
              <Button
                v-if="isPrimordialAdmin"
                variant="ghost"
                size="xs"
                :disabled="isSaving"
                @click="assign(candidate.id, 'administrator')"
              >
                Administration
              </Button>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </ModerationPage>
</template>
