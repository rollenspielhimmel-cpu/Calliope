<script setup lang="ts">
/**
 * Das Feld, in das eine neue Statusmeldung getippt wird.
 *
 * Eigene Komponente, weil es an zwei Orten steht — im Kasten auf der Startseite und auf der Seite
 * mit allen Meldungen — und weil das Leeren nach dem Absenden dort schon einmal schiefgegangen ist.
 */
import { ref } from 'vue'
import { createStatusUpdate } from '@/api/status-updates/status-updates'
import { TEXT_LIMIT } from '@/api/textLimit'
import { useRefreshStatusUpdates } from '@/composables/useStatusUpdates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const draft = ref<string>('')
const posting = ref<boolean>(false)
const failed = ref<boolean>(false)

const refreshStatusUpdates = useRefreshStatusUpdates()

async function submit() {
  const body = draft.value.trim()
  if (body === '' || posting.value) {
    return
  }

  posting.value = true
  failed.value = false
  try {
    const created = await createStatusUpdate({ body })
    if (created.status !== 201) {
      failed.value = true
      return
    }

    // Erst nach der Zusage geleert, und die Liste kommt frisch vom Server statt von Hand
    // zusammengesetzt: So steht an beiden Orten dasselbe, auch wenn nebenher jemand anderes
    // geschrieben hat.
    draft.value = ''
    await refreshStatusUpdates()
  } catch {
    failed.value = true
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2">
      <Input
        v-model="draft"
        placeholder="Was gibt's Neues?"
        class="h-8 text-sm"
        :maxlength="TEXT_LIMIT.createStatusUpdate.body.maxLength"
        @keydown.enter="submit"
      />
      <Button size="sm" :disabled="posting || !draft.trim()" @click="submit">
        <Spinner v-if="posting" />
        Posten
      </Button>
    </div>

    <p v-if="failed" class="mt-2 text-[11.5px] text-destructive">
      Die Meldung wurde nicht gespeichert. Versuche es noch einmal.
    </p>
  </div>
</template>
