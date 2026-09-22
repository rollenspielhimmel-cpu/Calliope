<script setup lang="ts">
/**
 * Solid rather than destructive: the design system reserves the red fill for acts that destroy a
 * body of writing including other people's, and names a single post as outside it — one
 * paragraph, removed by whoever wrote it or by somebody who administers the group.
 *
 * The name is there when it is somebody else's, because removing your own paragraph and
 * moderating another member's are not the same act and the confirmation is where that registers.
 */
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { computed, ref } from 'vue'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  /** Absent for your own post, and for one whose author deleted their account. */
  authorName?: string
  pending: boolean
  error?: string
  /**
   * Ein offizieller Beitrag geht nur mit Grund; der steht mit dem gelöschten Text im Protokoll.
   * Gesetzt heißt: fragen, mit dieser Obergrenze.
   */
  reasonMaxLength?: number
}>()
const emit = defineEmits<{ confirmed: [reason: string | undefined] }>()

const reason = ref<string>('')
const asksForReason = computed<boolean>(() => props.reasonMaxLength !== undefined)
const missingReason = computed<boolean>(
  () => asksForReason.value && reason.value.trim().length === 0,
)

function confirm() {
  emit('confirmed', asksForReason.value ? reason.value.trim() : undefined)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-confirm">
      <DialogHeader>
        <DialogTitle>
          <template v-if="props.authorName"> Beitrag von {{ props.authorName }} löschen? </template>
          <template v-else>Beitrag löschen?</template>
        </DialogTitle>
        <DialogDescription>Der Beitrag verschwindet aus dem Thema.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-note text-ink-4">
        <Alert v-if="props.error" variant="destructive" role="alert">
          <AlertDescription>{{ props.error }}</AlertDescription>
        </Alert>

        <p v-if="props.authorName">
          Du löschst, was jemand anderes geschrieben hat. Das lässt sich nicht zurückholen.
        </p>
        <p v-else>Das lässt sich nicht zurückholen.</p>

        <Field v-if="asksForReason">
          <FieldLabel for="delete-post-reason">Grund</FieldLabel>
          <Input
            id="delete-post-reason"
            v-model="reason"
            :maxlength="props.reasonMaxLength"
            :disabled="pending"
          />
          <p class="text-control text-ink-5">
            Ein offizieller Beitrag verschwindet nicht spurlos: Grund und Text bleiben im Protokoll,
            das nur die Administration liest.
          </p>
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="pending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="pending || missingReason" @click="confirm">
          <Spinner v-if="pending" />
          Beitrag löschen
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
