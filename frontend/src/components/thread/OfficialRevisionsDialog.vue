<script setup lang="ts">
/**
 * Das Protokoll eines offiziellen Threads: jede Änderung nach seinem Erscheinen, die neueste
 * zuerst — wer, wann, warum, und was vorher und nachher dastand. Nur für die Administration; die
 * API liefert es niemandem sonst.
 */
import { computed } from 'vue'
import { useListOfficialThreadRevisions } from '@/api/moderation/moderation'
import type { ListOfficialThreadRevisions200Item } from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ threadId: string }>()

const { data, isPending } = useListOfficialThreadRevisions(() => props.threadId, {
  // Bei jedem Öffnen frisch: Eine Änderung von eben muss drinstehen.
  query: { enabled: open, refetchOnMount: 'always' },
})

const revisions = computed<ListOfficialThreadRevisions200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const KIND: Record<ListOfficialThreadRevisions200Item['kind'], string> = {
  made_official: 'Offiziell gemacht',
  unmade_official: 'Nicht mehr offiziell',
  title_changed: 'Überschrift geändert',
  post_edited: 'Beitrag geändert',
  post_deleted: 'Beitrag gelöscht',
}

/** Der Namenstausch zeigt Namen, die Überschrift den Titel, alles andere den Text. */
function before(revision: ListOfficialThreadRevisions200Item): string | null {
  if (revision.kind === 'made_official' || revision.kind === 'unmade_official') {
    return revision.nameBefore
  }
  return revision.kind === 'title_changed' ? revision.titleBefore : revision.textBefore
}

function after(revision: ListOfficialThreadRevisions200Item): string | null {
  if (revision.kind === 'made_official' || revision.kind === 'unmade_official') {
    return revision.nameAfter
  }
  return revision.kind === 'title_changed' ? revision.titleAfter : revision.textAfter
}

/** „Vorher" heißt beim Namenstausch: der Name, der dastand. Ohne einen gab es keinen. */
const label = (revision: ListOfficialThreadRevisions200Item) =>
  revision.kind === 'made_official' || revision.kind === 'unmade_official'
    ? { before: 'Stand als', after: 'Steht als' }
    : { before: 'Vorher', after: 'Nachher' }
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-wide">
      <DialogHeader>
        <DialogTitle>Protokoll</DialogTitle>
        <DialogDescription>
          Jede Änderung an diesem offiziellen Thread nach seinem Erscheinen. Nur die Administration
          sieht das.
        </DialogDescription>
      </DialogHeader>

      <div class="max-h-[60vh] overflow-auto">
        <p v-if="isPending" class="text-note text-ink-5">Das Protokoll wird geladen …</p>
        <p v-else-if="revisions.length === 0" class="text-note text-ink-5">
          Seit dem Erscheinen hat sich nichts geändert.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="revision in revisions"
            :key="revision.id"
            class="border-b border-line-2 py-4 first:pt-0"
          >
            <p class="text-row text-ink-2">{{ KIND[revision.kind] }}</p>
            <p class="mt-0.5 text-[12px] text-ink-6">
              {{ revision.editedByUsername ?? 'Gelöschtes Konto' }} ·
              {{ formatActivityTime(revision.editedAt) }}
            </p>
            <p v-if="revision.reason" class="mt-2 text-[12.5px] text-ink-3">
              Grund: {{ revision.reason }}
            </p>

            <dl class="mt-2 flex flex-col gap-2 text-[12.5px]">
              <div v-if="before(revision) !== null">
                <dt class="text-ink-5">{{ label(revision).before }}</dt>
                <dd class="whitespace-pre-line text-ink-4">{{ before(revision) }}</dd>
              </div>
              <div v-if="revision.kind !== 'post_deleted' && after(revision) !== null">
                <dt class="text-ink-5">{{ label(revision).after }}</dt>
                <dd class="whitespace-pre-line text-ink-4">{{ after(revision) }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </div>
    </DialogContent>
  </Dialog>
</template>
