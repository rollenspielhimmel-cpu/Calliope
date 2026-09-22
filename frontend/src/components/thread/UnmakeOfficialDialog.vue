<script setup lang="ts">
/**
 * „Nicht mehr offiziell": nimmt den Namenstausch zurück.
 *
 * Der Absender geht vom Thread und seinem Eröffnungsbeitrag, der Name von vorher kommt zurück, und
 * beides steht mit Grund im Protokoll. Nur die Administration, und nur bei einem Thread, der schon
 * im Forum stand — bei einem als offiziell geschriebenen gibt es keinen Namen, der zurückkäme; das
 * sagt der Server, wenn es so ist.
 */
import { ref } from 'vue'
import { useUnmakeOfficialThread } from '@/api/moderation/moderation'
import { TEXT_LIMIT } from '@/api/textLimit'
import { refusalMessage } from '@/lib/format/failure'
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
const props = defineProps<{ threadId: string }>()
const emit = defineEmits<{ changed: [] }>()

const reason = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: unmake, isPending } = useUnmakeOfficialThread()

async function confirm() {
  error.value = undefined
  try {
    await unmake({ threadId: props.threadId, params: { reason: reason.value.trim() } })
  } catch (failure) {
    error.value = refusalMessage(failure, 'Das ging nicht zurück. Versuche es noch einmal.')
    return
  }
  emit('changed')
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogTitle>Nicht mehr offiziell</DialogTitle>
      <DialogHeader>
        <DialogDescription>
          Der Absender geht vom Thread und seinem Eröffnungsbeitrag; der Name, der vorher dastand,
          kommt zurück.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <p class="max-w-[62ch] text-control text-ink-5">
          Grund und beide Namen stehen danach im Protokoll. Antworten im Thread bleiben, wie sie
          sind.
        </p>

        <Field>
          <FieldLabel for="unmake-official-reason">Grund</FieldLabel>
          <Input
            id="unmake-official-reason"
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
        <Button type="button" :disabled="isPending || reason.trim().length === 0" @click="confirm">
          <Spinner v-if="isPending" />
          Zurücknehmen
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
