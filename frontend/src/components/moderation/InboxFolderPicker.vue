<script setup lang="ts">
/**
 * „In Ordner legen" für ein Gespräch oder eine einzelne Nachricht — und wo es schon liegt, mit einem
 * Weg wieder heraus.
 *
 * Heraus nimmt nur die Einsortierung weg: Das Gespräch oder die Nachricht bleibt im Postfach.
 */
import { computed } from 'vue'
import type { ListAdminInboxFolders200Item } from '@/api/models'
import { X } from '@lucide/vue'

const props = defineProps<{
  folders: ListAdminInboxFolders200Item[]
  /** Wo es schon liegt. */
  places: Array<{ itemId: string; folderId: string }>
  /** Für die Beschriftung der Auswahl: „Gespräch" oder „Nachricht". */
  what: string
  disabled?: boolean
}>()

const emit = defineEmits<{ add: [folderId: string]; remove: [itemId: string] }>()

const titleOf = (folderId: string) =>
  props.folders.find((folder) => folder.id === folderId)?.title ?? 'Ordner'

/** Nur, wo es noch nicht liegt: zweimal in denselben Ordner geht ohnehin nicht. */
const available = computed(() =>
  props.folders.filter((folder) => !props.places.some((place) => place.folderId === folder.id)),
)

function choose(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value !== '') {
    emit('add', select.value)
  }
  // Zurück auf „In Ordner legen": Die Auswahl ist ein Knopf, kein Zustand.
  select.value = ''
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-5">
    <span
      v-for="place in places"
      :key="place.itemId"
      class="flex items-center gap-1 rounded-full border border-line-3 px-2 py-0.5 text-ink-4"
    >
      {{ titleOf(place.folderId) }}
      <button
        type="button"
        class="flex min-h-6 items-center hover:text-oak-deep"
        :aria-label="`${what} aus „${titleOf(place.folderId)}“ nehmen`"
        :disabled="disabled"
        @click="emit('remove', place.itemId)"
      >
        <X :size="12" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </span>

    <select
      v-if="available.length > 0"
      class="h-8 rounded-md border border-input bg-transparent px-2 text-[12px]"
      :aria-label="`${what} in einen Ordner legen`"
      :disabled="disabled"
      @change="choose"
    >
      <option value="">In Ordner legen …</option>
      <option v-for="folder in available" :key="folder.id" :value="folder.id">
        {{ folder.title }}
      </option>
    </select>
  </div>
</template>
