<script setup lang="ts">
/**
 * Who may work the Blind-Date desk — the root administrator's own list.
 *
 * Visible to that account and no other, because it is the only one that may change it. This is the
 * level above the roles: an ordinary administrator hands out moderator roles, and this decides who
 * sees which member hopes to be paired with whom.
 *
 * The root administrator is not in the list. They hold the right by being that account, and a row
 * saying so would suggest it could be taken away — which would leave the desk with a lock and no
 * key.
 *
 * Granting is a list of the team rather than a search, because the right can only go to somebody
 * who is already an operator: the set of possible answers is exactly the operators, and a search
 * box would invite typing a name that cannot be one.
 *
 * A suspended manager is shown as suspended rather than dropped: „warum sieht sie die Warteschlange
 * nicht" is a question this list should answer before somebody has to ask it.
 */
import { computed, ref } from 'vue'
import {
  getListBlindDateManagersQueryKey,
  useListBlindDateManagers,
  useListOperators,
  useSetBlindDateManagement,
} from '@/api/moderation/moderation'
import type { ListBlindDateManagers200Item, ListOperators200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBlindDateManagers()
const { data: operatorData } = useListOperators()

const managers = computed<ListBlindDateManagers200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const operators = computed<ListOperators200Item[]>(() =>
  operatorData.value?.status === 200 ? operatorData.value.data : [],
)

/**
 * Everybody on the team who could hold the right and does not. The root administrator is left out
 * for the reason above; so is anybody already in the list.
 */
const candidates = computed<ListOperators200Item[]>(() => {
  const held = new Set(managers.value.map((manager) => manager.id))
  return operators.value.filter((operator) => !operator.isPrimordialAdmin && !held.has(operator.id))
})

const error = ref<string | undefined>(undefined)

const { mutateAsync: setManagement, isPending: isSaving } = useSetBlindDateManagement()

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListBlindDateManagersQueryKey() })
}

async function set(userId: string, mayManage: boolean) {
  error.value = undefined

  try {
    await setManagement({ userId, data: { mayManage } })
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Wer den Blind-Date-Bereich öffnen darf. Das Recht kommt nicht mit der Moderationsrolle — hier
      steht, wer sich für wen interessiert, und das wird einzeln vergeben. Vergeben und entziehen
      kannst nur du.
    </p>
    <p class="mt-2 max-w-[70ch] text-[12.5px] text-ink-6">
      Du selbst stehst nicht in der Liste: Dein Zugriff hängt am Ur-Admin-Konto und kann nicht
      entzogen werden. Sonst gäbe es einen Weg, den Bereich für alle zuzusperren.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <section class="mt-6">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Hat das Recht <span class="ml-1 normal-case">({{ managers.length }})</span>
        </h3>

        <p v-if="managers.length === 0" class="mt-2 max-w-[70ch] text-note text-ink-5">
          Zurzeit hat niemand sonst dieses Recht. Du bearbeitest die Bewerbungen also allein — was
          in Ordnung ist, aber bedeutet, dass niemand einspringen kann.
        </p>

        <ul v-else class="mt-2 flex flex-col">
          <li
            v-for="manager in managers"
            :key="manager.id"
            class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 py-3"
          >
            <div class="min-w-0">
              <RouterLink
                :to="{ name: 'member', params: { userId: manager.id } }"
                class="text-row text-ink-2 underline-offset-[5px] hover:underline"
              >
                {{ manager.username }}
              </RouterLink>
              <p v-if="manager.isSuspended" class="mt-0.5 max-w-[60ch] text-[12px] text-ink-6">
                Hat sich selbst beworben und sieht den Bereich zurzeit nicht. Bis die Bewerbung
                zugeordnet oder zurückgezogen ist, liegt die Zuordnung bei dir.
              </p>
            </div>

            <Button variant="ghost" size="xs" :disabled="isSaving" @click="set(manager.id, false)">
              Recht entziehen
            </Button>
          </li>
        </ul>
      </section>

      <section v-if="candidates.length > 0" class="mt-7">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Kann das Recht bekommen
        </h3>
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Alle im Team, die es noch nicht haben.
        </p>

        <ul class="mt-2 flex flex-col">
          <li
            v-for="operator in candidates"
            :key="operator.id"
            class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 py-2.5"
          >
            <span class="text-row text-ink-3">{{ operator.username }}</span>
            <Button variant="ghost" size="xs" :disabled="isSaving" @click="set(operator.id, true)">
              Recht geben
            </Button>
          </li>
        </ul>
      </section>

      <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
