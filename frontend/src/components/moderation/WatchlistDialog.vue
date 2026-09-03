<script setup lang="ts">
/**
 * The one field putting somebody on the watchlist needs. A note is required rather than optional:
 * an entry saying only "watched" is one nobody can act on later, and the list is read by whoever
 * is on shift rather than by whoever wrote it.
 */
import { ref, watch } from 'vue'
import { getListWatchlistQueryKey, useAddToWatchlist } from '@/api/moderation/moderation'
import { queryClient } from '@/lib/api/queryClient'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ userId: string; username: string; note?: string }>()

const { mutateAsync: add, isPending } = useAddToWatchlist()
const draft = ref<string>('')
const error = ref<string | undefined>(undefined)

// Filled each time it opens, so changing an existing note starts from what it says.
watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = props.note ?? ''
  error.value = undefined
})

async function confirm() {
  const text = draft.value.trim()
  if (text.length === 0) return

  error.value = undefined

  try {
    await add({ userId: props.userId, data: { note: text } })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListWatchlistQueryKey() })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>„{{ props.username }}“ beobachten?</DialogTitle>
        <DialogDescription>
          Ein Eintrag ist kein Vorfall und keine Konsequenz — nur ein Vermerk für das Team.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-note text-ink-4">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <FieldGroup>
          <Field>
            <FieldLabel for="watchlistNote">Notiz</FieldLabel>
            <Input
              id="watchlistNote"
              v-model="draft"
              name="watchlistNote"
              :maxlength="TEXT_LIMIT.addToWatchlist.note.maxLength"
              autocomplete="off"
            />
            <p class="text-control text-ink-5">
              Weshalb, in einem Satz. Nur für Moderation und Administration sichtbar.
            </p>
          </Field>
        </FieldGroup>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="isPending || draft.trim().length === 0" @click="confirm">
          <Spinner v-if="isPending" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
