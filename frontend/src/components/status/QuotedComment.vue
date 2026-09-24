<script setup lang="ts">
/**
 * Der zitierte Kommentar über einer Antwort.
 *
 * **Er wird aus dem Bezug gebaut, nicht aus einer Kopie.** Deshalb stimmt das Zitat weiterhin,
 * wenn jemand seinen Kommentar ändert, und der Name steht sofort richtig da, wenn jemand sich
 * umbenennt. Vorher stand beides als `@name: „die ersten 60 Zeichen …"` im Text der Antwort —
 * eingefroren, nicht verlinkbar, und hinter dem „…" stand nichts mehr.
 *
 * Dieselbe Komponente dient zweimal: über dem Eingabefeld, solange die Antwort getippt wird, und
 * über der fertigen Antwort. Der Unterschied ist ein Abbrechen-Knopf, sonst nichts — was man
 * zitiert, soll beim Schreiben genauso aussehen wie danach.
 */
import { RouterLink } from 'vue-router'
import { X } from '@lucide/vue'
import StatusBody from '@/components/status/StatusBody.vue'

defineProps<{
  quoted: { id: string; body: string; createdBy: string; createdByUsername: string }
  /** Zeigt das Kreuz zum Verwerfen — nur solange das Zitat noch ein Entwurf ist. */
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [] }>()
</script>

<template>
  <div
    class="flex items-start gap-1.5 rounded-md border-l-2 border-line-2 bg-paper-2 py-1 pr-1 pl-2"
  >
    <div class="min-w-0 flex-1">
      <RouterLink
        :to="{ name: 'member', params: { userId: quoted.createdBy } }"
        class="text-[11.5px] font-medium text-ink-2 hover:underline"
      >
        {{ quoted.createdByUsername }}
      </RouterLink>
      <!-- Zwei Zeilen, dann „… weiterlesen": Das Zitat soll zeigen, worauf sich jemand bezieht,
           und nicht die Antwort darunter verdrängen. Der ganze Text ist da — anders als früher,
           als nach sechzig Zeichen wirklich Schluss war. -->
      <StatusBody :text="quoted.body" :lines="2" size="text-[11.5px]" />
    </div>

    <button
      v-if="removable"
      type="button"
      class="mt-0.5 shrink-0 rounded p-0.5 text-ink-4 hover:text-oak-deep"
      aria-label="Zitat verwerfen"
      @click="emit('remove')"
    >
      <X :size="13" :stroke-width="1.5" aria-hidden="true" />
    </button>
  </div>
</template>
