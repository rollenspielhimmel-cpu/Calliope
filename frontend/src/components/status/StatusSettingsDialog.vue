<script setup lang="ts">
/**
 * Die Einstellungen der Statusmeldungen: wen man hier nicht sehen will.
 *
 * **Nichts davon steht an den Meldungen selbst.** Ein „ausblenden" an jedem Eintrag hieße ein
 * Angebot mehr in einer Liste, die vom Lesen lebt — und die Sorge, dass der Kasten überfüllt
 * aussieht, ist berechtigt. Der Weg hinein ist ein Rädchen, und drinnen wird gesucht.
 *
 * **Zwei Schalter je Mitglied.** Es gibt Leute, deren Meldungen einem zu viel sind, deren
 * Antworten unter fremden Meldungen aber völlig in Ordnung — und umgekehrt.
 *
 * **Blockierte stehen mit in der Liste.** Blockieren regelt Kontakt, Ausblenden regelt Sicht; wer
 * blockiert ist, verschwindet deshalb *nicht* von selbst aus den Statusmeldungen. Hier steht er
 * aber schon da, mit einem Vermerk und zwei ungesetzten Schaltern — ein Klick genügt, und man
 * erfährt nebenbei, warum er noch sichtbar war.
 */
import { computed, ref } from 'vue'
import { Settings } from '@lucide/vue'
import {
  setHiddenStatusMember,
  useListHiddenStatusMembers,
} from '@/api/status-updates/status-updates'
import { useListBlocks } from '@/api/blocks/blocks'
import type { ListUsers200ResultsItem } from '@/api/models'
import { useRefreshStatusUpdates } from '@/composables/useStatusUpdates'
import UserPicker from '@/components/user/UserPicker.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

const open = ref<boolean>(false)

/** Erst fragen, wenn jemand hinsieht: Der Dialog ist zu, bis er gebraucht wird. */
const hiddenQuery = useListHiddenStatusMembers({ query: { enabled: open } })
const blocksQuery = useListBlocks(
  () => ({ limit: 100, offset: 0, sortAttribute: 'createdAt', sortOrder: 'desc' }),
  { query: { enabled: open } },
)

type Row = {
  userId: string
  username: string
  hideUpdates: boolean
  hideComments: boolean
  blocked: boolean
}

const hidden = computed(() => {
  const answer = hiddenQuery.data.value
  return answer?.status === 200 ? answer.data.results : []
})

const blocked = computed(() => {
  const answer = blocksQuery.data.value
  return answer?.status === 200 ? answer.data.results : []
})

/**
 * Eine Liste, zwei Quellen: wen man schon ausblendet, und wen man blockiert hat. Wer in beidem
 * steht, steht einmal da — mit seinen Schaltern und dem Vermerk.
 */
const rows = computed<Row[]>(() => {
  const blockedIds = new Set(blocked.value.map((block) => block.blockedId))

  const fromHidden = hidden.value.map((entry) => ({
    ...entry,
    blocked: blockedIds.has(entry.userId),
  }))

  const alreadyListed = new Set(fromHidden.map((row) => row.userId))

  const onlyBlocked = blocked.value
    .filter((block) => !alreadyListed.has(block.blockedId))
    .map((block) => ({
      userId: block.blockedId,
      username: block.username,
      hideUpdates: false,
      hideComments: false,
      blocked: true,
    }))

  return [...fromHidden, ...onlyBlocked].sort((a, b) => a.username.localeCompare(b.username, 'de'))
})

const saving = ref<string | undefined>(undefined)
const failed = ref<boolean>(false)
const refreshStatusUpdates = useRefreshStatusUpdates()

async function set(row: Row, change: Partial<Pick<Row, 'hideUpdates' | 'hideComments'>>) {
  saving.value = row.userId
  failed.value = false
  try {
    const answer = await setHiddenStatusMember(row.userId, {
      hideUpdates: change.hideUpdates ?? row.hideUpdates,
      hideComments: change.hideComments ?? row.hideComments,
    })

    if (answer.status !== 200) {
      failed.value = true
      return
    }

    // Die Listen mit: Was ausgeblendet ist, ändert, was im Kasten und auf der Seite steht.
    await Promise.all([hiddenQuery.refetch(), refreshStatusUpdates()])
  } catch {
    failed.value = true
  } finally {
    saving.value = undefined
  }
}

/** Aus der Suche heraus wird zunächst beides ausgeblendet — wer sucht, meint meistens alles. */
function add(user: ListUsers200ResultsItem) {
  void set(
    {
      userId: user.id,
      username: user.username,
      hideUpdates: false,
      hideComments: false,
      blocked: false,
    },
    { hideUpdates: true, hideComments: true },
  )
}

const excludeIds = computed<string[]>(() =>
  hidden.value.filter((entry) => entry.hideUpdates && entry.hideComments).map((e) => e.userId),
)
</script>

<template>
  <button
    type="button"
    class="rounded-full p-1 text-ink-4 hover:text-oak-deep"
    aria-label="Einstellungen der Statusmeldungen"
    title="Einstellungen"
    @click="open = true"
  >
    <Settings :size="14" :stroke-width="1.5" aria-hidden="true" />
  </button>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogTitle>Statusmeldungen</DialogTitle>
      <DialogHeader>
        <DialogDescription>
          Wen du hier nicht sehen möchtest. Das gilt nur für dich, und du kannst es jederzeit
          zurücknehmen — es kommt dann alles wieder.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <UserPicker
          label="Mitglied ausblenden"
          placeholder="Name eingeben"
          :exclude-ids="excludeIds"
          :active="open"
          @pick="add"
        />

        <div v-if="rows.length > 0" class="flex flex-col gap-2">
          <div
            v-for="row in rows"
            :key="row.userId"
            class="flex items-center gap-2 border-t border-line-4 pt-2 first:border-0 first:pt-0"
          >
            <UserAvatar :username="row.username" class="size-6 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-control text-ink-2">{{ row.username }}</p>
              <!-- Der Vermerk erklärt, warum jemand trotzdem sichtbar ist: Blockieren regelt
                   Kontakt, nicht Sicht. -->
              <p v-if="row.blocked" class="text-[11px] text-ink-5">blockiert</p>
            </div>

            <Label class="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <Checkbox
                :model-value="row.hideUpdates"
                :disabled="saving === row.userId"
                @update:model-value="(value) => set(row, { hideUpdates: value === true })"
              />
              Meldungen
            </Label>

            <Label class="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <Checkbox
                :model-value="row.hideComments"
                :disabled="saving === row.userId"
                @update:model-value="(value) => set(row, { hideComments: value === true })"
              />
              Kommentare
            </Label>
          </div>
        </div>

        <p v-else class="text-control text-ink-5">Du blendest niemanden aus.</p>

        <p v-if="failed" class="text-[11.5px] text-destructive">
          Das ließ sich nicht speichern. Versuche es noch einmal.
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
