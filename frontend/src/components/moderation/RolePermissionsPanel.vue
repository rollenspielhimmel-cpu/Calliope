<script setup lang="ts">
/**
 * Was eine Rolle über ihren Namen hinaus darf — heute nur „offizielle Threads und Rundmails
 * vorbereiten".
 *
 * **Jede Administration liest es, nur der Ur-Admin ändert es.** Für alle anderen stehen die
 * Häkchen da, aber gesperrt: Wer vorbereitet, soll sehen können, warum ein Mod es darf.
 *
 * Die Administration selbst steht hier nicht. Sie darf alles, ohne Zeile — sonst ließe sie sich aus
 * dem Vorbereiten aussperren und damit aus dem Freigeben dessen, was sie selbst schreibt.
 */
import { computed, ref } from 'vue'
import {
  getListRolePermissionsQueryKey,
  useGrantRolePermission,
  useListRolePermissions,
  useRevokeRolePermission,
} from '@/api/moderation/moderation'
import type {
  ListRolePermissions200PermissionsItem,
  ListRolePermissions200RolesItem,
} from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { platformRoleLabel } from '@/lib/format/platformRole'
import { Checkbox } from '@/components/ui/checkbox'

const props = defineProps<{ mayChange: boolean }>()

type Role = ListRolePermissions200RolesItem
type Permission = ListRolePermissions200PermissionsItem

/** In Worten, die jemand beim Vergeben versteht, nicht im Namen der Spalte. */
const PERMISSION_LABELS: Record<Permission, string> = {
  prepare_publications:
    'Offizielle Threads und Rundmails vorbereiten — schreiben, einreichen, die Warteschlange sehen. Freigeben bleibt bei der Administration.',
}

const { data } = useListRolePermissions()

const roles = computed<Role[]>(() => (data.value?.status === 200 ? data.value.data.roles : []))

const permissions = computed<Permission[]>(() =>
  data.value?.status === 200 ? data.value.data.permissions : [],
)

function holds(role: Role, permission: Permission): boolean {
  return (
    data.value?.status === 200 &&
    data.value.data.granted.some((row) => row.role === role && row.permission === permission)
  )
}

const { mutateAsync: grant, isPending: isGranting } = useGrantRolePermission()
const { mutateAsync: revoke, isPending: isRevoking } = useRevokeRolePermission()

const error = ref<string | undefined>(undefined)

async function toggle(role: Role, permission: Permission, on: boolean) {
  error.value = undefined

  try {
    await (on ? grant({ role, permission }) : revoke({ role, permission }))
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht durch.')
  }

  await queryClient.invalidateQueries({ queryKey: getListRolePermissionsQueryKey() })
}
</script>

<template>
  <section class="mt-8 border-t border-line-3 pt-6">
    <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Was Rollen dürfen</h2>
    <p class="mt-2 max-w-[60ch] text-note text-ink-5">
      Die Administration darf alles und steht deshalb nicht hier.
      <template v-if="!props.mayChange">Ändern kann das allein das erste Konto.</template>
    </p>

    <ul class="mt-3 flex flex-col">
      <li
        v-for="role in roles"
        :key="role"
        class="border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
      >
        <p class="text-row text-ink-2">{{ platformRoleLabel(role) }}</p>
        <label
          v-for="permission in permissions"
          :key="permission"
          class="mt-1.5 flex max-w-[60ch] items-start gap-2 text-note text-ink-4"
        >
          <Checkbox
            :model-value="holds(role, permission)"
            :disabled="!props.mayChange || isGranting || isRevoking"
            @update:model-value="(on) => toggle(role, permission, on === true)"
          />
          <span>{{ PERMISSION_LABELS[permission] }}</span>
        </label>
      </li>
    </ul>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </section>
</template>
