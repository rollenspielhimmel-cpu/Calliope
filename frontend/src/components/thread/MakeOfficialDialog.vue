<script setup lang="ts">
/**
 * „Offiziell machen": einen Thread, der schon im Forum steht, unter einen Absender stellen.
 *
 * Das tauscht nur den Namen am Eröffnungsbeitrag — Überschrift und Text bleiben, wie sie sind, und
 * spätere Antworten behalten ihren Namen. Angeboten dem Eröffner und der Administration; ob der
 * Eröffnungsbeitrag aus dem Team stammt, prüft die API und sagt es, wenn nicht.
 */
import { computed, ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import {
  getListOfficialThreadQueueQueryKey,
  useSubmitExistingOfficialThread,
} from '@/api/moderation/moderation'
import { useGetCurrentUser } from '@/api/auth/auth'
import { failureMessage } from '@/lib/format/failure'
import OfficialSenderSelect from '@/components/thread/OfficialSenderSelect.vue'
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
import { Spinner } from '@/components/ui/spinner'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ threadId: string }>()
const emit = defineEmits<{ changed: [] }>()

const { data: currentUser } = useGetCurrentUser()
const isAdministrator = computed<boolean>(
  () =>
    currentUser.value?.status === 200 && currentUser.value.data.platformRole === 'administrator',
)

const sendAs = ref<string>('')
const error = ref<string | undefined>(undefined)
const outcome = ref<string | undefined>(undefined)

const queryClient = useQueryClient()
const { mutateAsync: submitExisting, isPending } = useSubmitExistingOfficialThread()

async function submit() {
  error.value = undefined
  let status: string
  try {
    const answer = await submitExisting({
      data: {
        threadId: props.threadId,
        sendAsUserId: sendAs.value === '' ? null : sendAs.value,
      },
    })
    status = answer.status === 201 ? answer.data.status : ''
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht durch. Versuche es noch einmal.')
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListOfficialThreadQueueQueryKey() })
  emit('changed')

  outcome.value =
    status === 'released'
      ? 'Der Thread ist jetzt offiziell. Am Eröffnungsbeitrag steht der Absender.'
      : 'Eingereicht. Bis die Administration freigibt, steht am Eröffnungsbeitrag dein Name.'
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>Offiziell machen</DialogTitle>
        <DialogDescription>
          Der Eröffnungsbeitrag erscheint danach unter dem Absender, nicht unter deinem Namen.
        </DialogDescription>
      </DialogHeader>

      <p v-if="outcome" class="text-row text-ink-2" role="status">{{ outcome }}</p>

      <div v-else class="flex flex-col gap-4">
        <p class="max-w-[62ch] text-control text-ink-5">
          Überschrift und Text bleiben, wie sie sind; es wird nur der Name getauscht. Antworten,
          auch deine eigenen, behalten ihren Namen. Wer den Beitrag geschrieben hat, bleibt intern
          festgehalten.
          <template v-if="!isAdministrator"
            >Bis die Administration freigibt, steht weiter dein Name da.</template
          >
        </p>

        <OfficialSenderSelect id="make-official-sender" v-model="sendAs" />

        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <template v-if="outcome">
          <Button type="button" @click="open = false">Schließen</Button>
        </template>
        <template v-else>
          <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
            Abbrechen
          </Button>
          <Button type="button" :disabled="isPending" @click="submit">
            <Spinner v-if="isPending" />
            {{ isAdministrator ? 'Offiziell machen' : 'Zur Freigabe einreichen' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
