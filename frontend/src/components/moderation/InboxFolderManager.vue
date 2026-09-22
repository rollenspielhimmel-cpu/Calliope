<script setup lang="ts">
/**
 * Die Ordner des Postfachs verwalten: anlegen, umbenennen, verschieben, löschen.
 *
 * **Eine Reihenfolge für alle Admins.** Nach oben und unten wird mit Knöpfen geschoben statt
 * gezogen: Das geht mit Tastatur und Finger gleich, und bei einer Handvoll Ordnern ist es nicht
 * langsamer.
 *
 * **Löschen nimmt nur die Einsortierung weg.** Die Rückfrage sagt vorher, was darin liegt, und dass
 * es im Postfach bleibt.
 */
import { computed, ref } from 'vue'
import {
  getListAdminInboxQueryKey,
  useCreateAdminInboxFolder,
  useDeleteAdminInboxFolder,
  useRenameAdminInboxFolder,
  useReorderAdminInboxFolders,
} from '@/api/moderation/moderation'
import type { ListAdminInboxFolders200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { refusalMessage } from '@/lib/format/failure'
import { pluralize } from '@/lib/format/formatText'
import { TEXT_LIMIT } from '@/api/textLimit'
import { ArrowDown, ArrowUp } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps<{ folders: ListAdminInboxFolders200Item[] }>()

const error = ref<string | undefined>(undefined)

const { mutateAsync: create, isPending: isCreating } = useCreateAdminInboxFolder()
const { mutateAsync: rename, isPending: isRenaming } = useRenameAdminInboxFolder()
const { mutateAsync: reorder, isPending: isReordering } = useReorderAdminInboxFolders()
const { mutateAsync: remove, isPending: isDeleting } = useDeleteAdminInboxFolder()

const busy = computed(
  () => isCreating.value || isRenaming.value || isReordering.value || isDeleting.value,
)

async function attempt(action: () => Promise<unknown>, fallback: string) {
  error.value = undefined
  try {
    await action()
  } catch (failure) {
    error.value = refusalMessage(failure, fallback)
    // Auch nach einem Nein neu laden: Meist heißt es, dass jemand anderes gerade etwas geändert hat.
    await queryClient.invalidateQueries({ queryKey: getListAdminInboxQueryKey() })
    return false
  }
  await queryClient.invalidateQueries({ queryKey: getListAdminInboxQueryKey() })
  return true
}

// ── Anlegen ───────────────────────────────────────────────────────────────────────────────────

const newTitle = ref('')

async function createFolder() {
  const title = newTitle.value.trim()
  if (title.length === 0) return
  if (await attempt(() => create({ data: { title } }), 'Der Ordner ließ sich nicht anlegen.')) {
    newTitle.value = ''
  }
}

// ── Umbenennen ────────────────────────────────────────────────────────────────────────────────

const renaming = ref<string | undefined>(undefined)
const renameTitle = ref('')

function startRenaming(folder: ListAdminInboxFolders200Item) {
  renaming.value = folder.id
  renameTitle.value = folder.title
}

async function saveRename(folderId: string) {
  const title = renameTitle.value.trim()
  if (title.length === 0) return
  if (
    await attempt(
      () => rename({ folderId, data: { title } }),
      'Der Ordner ließ sich nicht umbenennen.',
    )
  ) {
    renaming.value = undefined
  }
}

// ── Verschieben ───────────────────────────────────────────────────────────────────────────────

/** Tauscht einen Ordner mit seinem Nachbarn und schickt die ganze Reihenfolge, wie sie dann ist. */
async function move(index: number, by: -1 | 1) {
  const order = props.folders.map((folder) => folder.id)
  const other = index + by
  if (other < 0 || other >= order.length) return
  ;[order[index], order[other]] = [order[other]!, order[index]!]
  await attempt(
    () => reorder({ data: { folderIds: order } }),
    'Die Reihenfolge ließ sich nicht ändern.',
  )
}

// ── Löschen ───────────────────────────────────────────────────────────────────────────────────

const deleting = ref<ListAdminInboxFolders200Item | undefined>(undefined)
const deletingOpen = computed<boolean>({
  get: () => deleting.value !== undefined,
  set: (open) => {
    if (!open) deleting.value = undefined
  },
})

/** Was im Ordner liegt, in einem Satz — oder dass er leer ist. */
const contents = computed<string>(() => {
  const folder = deleting.value
  if (folder === undefined) return ''
  const parts = [
    folder.conversationCount > 0
      ? pluralize(folder.conversationCount, 'Gespräch', 'Gespräche')
      : undefined,
    folder.messageCount > 0
      ? pluralize(folder.messageCount, 'Nachricht', 'Nachrichten')
      : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? 'Der Ordner ist leer.' : `Darin liegen ${parts.join(' und ')}.`
})

async function confirmDelete() {
  const folder = deleting.value
  if (folder === undefined) return
  if (await attempt(() => remove({ folderId: folder.id }), 'Der Ordner ließ sich nicht löschen.')) {
    deleting.value = undefined
  }
}
</script>

<template>
  <div class="flex max-w-[560px] flex-col gap-3">
    <ul v-if="folders.length > 0" class="flex flex-col">
      <li
        v-for="(folder, index) in folders"
        :key="folder.id"
        class="flex min-h-11 items-center gap-2 border-b border-line-2 py-1.5"
      >
        <template v-if="renaming === folder.id">
          <Input
            v-model="renameTitle"
            class="h-9 flex-1"
            :aria-label="`Neuer Name für „${folder.title}“`"
            :maxlength="TEXT_LIMIT.renameAdminInboxFolder.title.maxLength"
            @keydown.enter.prevent="saveRename(folder.id)"
          />
          <Button size="sm" :disabled="busy" @click="saveRename(folder.id)">Speichern</Button>
          <Button size="sm" variant="ghost" :disabled="busy" @click="renaming = undefined">
            Abbrechen
          </Button>
        </template>

        <template v-else>
          <span class="flex-1 text-row text-ink-2">{{ folder.title }}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            :aria-label="`„${folder.title}“ nach oben`"
            :disabled="busy || index === 0"
            @click="move(index, -1)"
          >
            <ArrowUp :size="14" :stroke-width="1.5" aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            :aria-label="`„${folder.title}“ nach unten`"
            :disabled="busy || index === folders.length - 1"
            @click="move(index, 1)"
          >
            <ArrowDown :size="14" :stroke-width="1.5" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" :disabled="busy" @click="startRenaming(folder)">
            Umbenennen
          </Button>
          <Button size="sm" variant="ghost" :disabled="busy" @click="deleting = folder">
            Löschen
          </Button>
        </template>
      </li>
    </ul>

    <form class="flex items-center gap-2" @submit.prevent="createFolder">
      <Input
        v-model="newTitle"
        class="h-9 max-w-[280px]"
        placeholder="Neuer Ordner, etwa „Wichtig“"
        aria-label="Name des neuen Ordners"
        :maxlength="TEXT_LIMIT.createAdminInboxFolder.title.maxLength"
      />
      <Button type="submit" size="sm" variant="outline" :disabled="busy || newTitle.trim() === ''">
        Anlegen
      </Button>
    </form>

    <p v-if="error" class="text-[12px] text-destructive" role="alert">{{ error }}</p>
  </div>

  <Dialog v-model:open="deletingOpen">
    <DialogContent class="sm:max-w-dialog-confirm">
      <DialogHeader>
        <DialogTitle>„{{ deleting?.title }}“ löschen?</DialogTitle>
        <DialogDescription>{{ contents }}</DialogDescription>
      </DialogHeader>
      <p class="text-note text-ink-4">
        Gespräche und Nachrichten bleiben im Postfach. Nur die Einsortierung verschwindet.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" :disabled="busy" @click="deleting = undefined">
          Abbrechen
        </Button>
        <Button type="button" :disabled="busy" @click="confirmDelete">Ordner löschen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
