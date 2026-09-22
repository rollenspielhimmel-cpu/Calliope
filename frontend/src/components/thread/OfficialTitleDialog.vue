<script setup lang="ts">
/**
 * Die Überschrift eines offiziellen Threads ändern — nur die Administration, nur mit Grund. Der
 * Grund steht mit der Überschrift vorher und nachher im Protokoll.
 */
import { computed, ref } from 'vue'
import { useChangeOfficialThreadTitle } from '@/api/moderation/moderation'
import { TEXT_LIMIT } from '@/api/textLimit'
import { failureMessage } from '@/lib/format/failure'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ threadId: string; title: string }>()
const emit = defineEmits<{ changed: [] }>()

const draftTitle = ref<string>(props.title)
const reason = ref<string>('')
const error = ref<string | undefined>(undefined)

const ready = computed<boolean>(
  () =>
    draftTitle.value.trim().length > 0 &&
    draftTitle.value.trim() !== props.title &&
    reason.value.trim().length > 0,
)

const { mutateAsync: changeTitle, isPending } = useChangeOfficialThreadTitle()

async function save() {
  error.value = undefined
  try {
    await changeTitle({
      threadId: props.threadId,
      data: { title: draftTitle.value.trim(), reason: reason.value.trim() },
    })
  } catch (failure) {
    error.value = failureMessage(failure, 'Die Überschrift konnte nicht geändert werden.')
    return
  }
  emit('changed')
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>Überschrift ändern</DialogTitle>
        <DialogDescription>
          Ein offizieller Thread ändert sich nicht unbemerkt: Grund und Überschrift vorher und
          nachher stehen im Protokoll, das nur die Administration liest.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <Field>
          <FieldLabel for="official-title">Überschrift</FieldLabel>
          <Input
            id="official-title"
            v-model="draftTitle"
            :maxlength="TEXT_LIMIT.changeOfficialThreadTitle.title.maxLength"
            :disabled="isPending"
          />
        </Field>
        <Field>
          <FieldLabel for="official-title-reason">Grund</FieldLabel>
          <Input
            id="official-title-reason"
            v-model="reason"
            :maxlength="TEXT_LIMIT.changeOfficialThreadTitle.reason.maxLength"
            :disabled="isPending"
          />
        </Field>

        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="isPending || !ready" @click="save">
          <Spinner v-if="isPending" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
