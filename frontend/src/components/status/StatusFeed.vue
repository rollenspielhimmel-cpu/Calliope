<script setup lang="ts">
/**
 * Statusmeldungen auf der eingeloggten Startseite, angelehnt an Yoocos LiNet-Status. Feste Höhe
 * mit eigenem Scrollbereich, weil diese Box neben anderen Startseiten-Boxen (Gruppen o.ä.) steht
 * und nicht unterschiedlich lang neben ihnen enden soll — dasselbe Argument wie bei den alten
 * Yooco-Boxen mit fester Höhe.
 *
 * **Ein Blick, kein Archiv.** Der Kasten holt zehn Meldungen und blättert nicht: „Ältere laden"
 * hieße hier, sich durch ein Guckloch von vier Zeilen Höhe immer weiter nach unten zu arbeiten.
 * Wer weiter zurück will, geht auf die Seite — über die Uhrzeit einer Meldung oder über den
 * Verweis darunter.
 */
import { RouterLink } from 'vue-router'
import { useStatusUpdates } from '@/composables/useStatusUpdates'
import StatusComposer from '@/components/status/StatusComposer.vue'
import StatusUpdateItem from '@/components/status/StatusUpdateItem.vue'

/**
 * Sichtbar sind etwa vier, der Rest steht hinter dem Scrollbalken des Kastens.
 *
 * Zehn statt der zwanzig von vorher: Sobald es die eigene Seite gibt, ist alles darüber hinaus
 * Ladearbeit für etwas, das niemand hier sucht.
 */
const PAGE_SIZE = 10

const { updates, isPending, isError } = useStatusUpdates(PAGE_SIZE)
</script>

<template>
  <div class="rounded-xl border border-line-3 bg-paper-2 p-3">
    <StatusComposer class="mb-2.5" />

    <!-- Feste Höhe + eigener Scrollbereich: absichtlich, siehe Kommentar oben. -->
    <div class="h-64 space-y-1.5 overflow-y-auto pr-3">
      <p v-if="isPending" class="text-[12.5px] text-ink-5">Wird geladen …</p>

      <p v-else-if="isError" class="text-[12.5px] text-ink-5">
        Die Statusmeldungen lassen sich gerade nicht laden.
      </p>

      <p v-else-if="updates.length === 0" class="text-[12.5px] text-ink-5">
        Noch keine Statusmeldungen. Schreib die erste.
      </p>

      <StatusUpdateItem v-for="update in updates" :key="update.id" :update="update" layout="box" />
    </div>

    <RouterLink
      :to="{ name: 'statusUpdates' }"
      class="mt-2 block text-center text-[12.5px] font-medium text-oak-deep hover:underline"
    >
      Alle Statusmeldungen
    </RouterLink>
  </div>
</template>
