<script setup lang="ts">
/**
 * Alle Statusmeldungen, von der neuesten bis zur ersten.
 *
 * **Warum eine eigene Seite und nicht ein größerer Kasten.** Der Kasten auf der Startseite hat
 * feste Höhe, damit er neben den anderen Kästen nicht ausufert — dort immer mehr nachzuladen
 * arbeitet gegen genau diese Entscheidung: Man scrollt durch ein Guckloch. Hier ist Platz, also
 * gibt es keine feste Höhe, keinen Scrollbereich im Scrollbereich und keine Vorschau vor den
 * Kommentaren.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useStatusUpdates } from '@/composables/useStatusUpdates'
import AppLayout from '@/components/layout/AppLayout.vue'
import StatusComposer from '@/components/status/StatusComposer.vue'
import StatusUpdateItem from '@/components/status/StatusUpdateItem.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/** Mehr als im Kasten, weil hier gelesen und nicht überflogen wird. */
const PAGE_SIZE = 20

const { updates, isPending, isError, hasOlder, isLoadingOlder, loadOlder } =
  useStatusUpdates(PAGE_SIZE)

const route = useRoute()

/**
 * Die Meldung, auf die ein Verweis von der Startseite zeigt.
 *
 * Sie kommt als Anker in der Adresse an. Der Router scrollt von sich aus nicht dorthin — es gibt
 * kein `scrollBehavior` —, und er könnte es auch nicht: Beim Seitenwechsel ist die Liste noch gar
 * nicht da. Also wird hier gewartet, bis sie steht.
 */
const wanted = computed<string>(() => route.hash.replace(/^#/u, ''))

const scrolledTo = ref<string | undefined>(undefined)

watch(
  [updates, wanted],
  async ([list, id]) => {
    if (id === '' || scrolledTo.value === id || !list.some((update) => update.id === id)) {
      return
    }

    await nextTick()
    document.getElementById(id)?.scrollIntoView({ block: 'center' })
    // Einmal, nicht bei jedem Nachladen: Wer unten „Ältere laden" drückt, will dort bleiben.
    scrolledTo.value = id
  },
  { immediate: true },
)
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <RouterLink
        :to="{ name: 'home' }"
        class="text-[12.5px] text-ink-5 underline-offset-[5px] hover:underline"
      >
        ← Zurück zur Startseite
      </RouterLink>

      <h1 class="mt-4 text-h1">Statusmeldungen</h1>

      <div class="mt-5 max-w-[640px]">
        <StatusComposer class="mb-4" />

        <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
          <Spinner />
          Einen Moment.
        </div>

        <p v-else-if="isError" class="text-note text-ink-5">
          Die Statusmeldungen lassen sich gerade nicht laden.
        </p>

        <p v-else-if="updates.length === 0" class="text-note text-ink-5">
          Noch keine Statusmeldungen. Schreib die erste.
        </p>

        <template v-else>
          <div class="space-y-2">
            <StatusUpdateItem
              v-for="update in updates"
              :key="update.id"
              :update="update"
              layout="page"
              :open-at-once="update.id === wanted"
            />
          </div>

          <Button
            v-if="hasOlder"
            variant="outline"
            class="mt-4"
            :disabled="isLoadingOlder"
            @click="loadOlder()"
          >
            <Spinner v-if="isLoadingOlder" />
            Mehr Statusmeldungen
          </Button>

          <p v-else class="mt-4 text-[12.5px] text-ink-5">Das war die erste.</p>
        </template>
      </div>
    </div>
  </AppLayout>
</template>
