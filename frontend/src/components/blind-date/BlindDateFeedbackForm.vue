<script setup lang="ts">
/**
 * The three questions after a Blind-Date, asked once and never again.
 *
 * **Voluntary means it can be declined**, and „nein danke" is a real answer here rather than a way
 * of hiding the form: it is recorded, so the page stops asking. A prompt that came back after every
 * ending for ever would be the pressure the design system's research is about, whatever the wording
 * said.
 *
 * **The questions are about the format and never about the other person.** A rating of somebody one
 * wrote with, held by the team and invisible to them, is a private review — and the answer to „that
 * person behaved badly" is the report, which exists and is a different thing. The form says so
 * itself rather than leaving somebody to work it out.
 *
 * Two selects and a textarea, the same three controls the application form uses, because this is
 * the second form in Blind-Date and a second vocabulary for the same job is how two forms drift.
 */
import { computed, ref } from 'vue'
import {
  getGetPendingBlindDateFeedbackQueryKey,
  useSubmitBlindDateFeedback,
} from '@/api/blind-date/blind-date'
import type { GetPendingBlindDateFeedback200 } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const props = defineProps<{ invitation: GetPendingBlindDateFeedback200 }>()

const worked = ref<string>('')
const again = ref<string>('')
const note = ref<string>('')
const error = ref<string | undefined>(undefined)

const WORKED = [
  { value: 'yes', label: 'Ja' },
  { value: 'partly', label: 'Teils' },
  { value: 'no', label: 'Nein' },
]

const AGAIN = [
  { value: 'yes', label: 'Ja' },
  { value: 'maybe', label: 'Vielleicht' },
  { value: 'no', label: 'Nein' },
]

/** Both answers together, which is what the API takes: half a form is not an answer. */
const complete = computed<boolean>(() => worked.value !== '' && again.value !== '')

const { mutateAsync: send, isPending } = useSubmitBlindDateFeedback()

async function submit(answers: Record<string, unknown>) {
  error.value = undefined

  try {
    await send({ data: { pairId: props.invitation.pairId, ...answers } })
  } catch (failure) {
    error.value = failureMessage(
      failure,
      'Das ist gerade nicht durchgegangen. Versuche es später noch einmal.',
    )
    return
  }

  await queryClient.invalidateQueries({
    queryKey: getGetPendingBlindDateFeedbackQueryKey(),
  })
}

function answer() {
  if (!complete.value) return

  return submit({
    worked: worked.value,
    again: again.value,
    ...(note.value.trim() === '' ? {} : { note: note.value.trim() }),
  })
}

/** „Nein danke": nothing to say, and the page takes that as said. */
function decline() {
  return submit({})
}
</script>

<template>
  <section class="rounded-lg border border-line-3 bg-paper-0 p-4 shadow-card">
    <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Kurze Rückmeldung</p>

    <p class="mt-2 max-w-[65ch] text-note text-ink-4">
      <template v-if="invitation.wasRevealed">
        Ihr habt euch bei „{{ invitation.plotTitle }}“ zu erkennen gegeben.
      </template>
      <template v-else>
        Dein Blind-Date bei „{{ invitation.plotTitle }}“ ist zu Ende gegangen.
      </template>
      Magst du uns kurz sagen, wie es für dich war? Freiwillig, und wir fragen nur dieses eine Mal.
    </p>

    <!-- Said before the first question, not in small print underneath: somebody who reads this as
         a form about the other person answers a different form. -->
    <p class="mt-2 max-w-[65ch] text-[12.5px] leading-[1.5] text-ink-5">
      Die Fragen gehen um das Format, nicht um die andere Person — sie erfährt nichts davon. Wenn es
      Ärger mit jemandem gab, ist eine Meldung ans Team der richtige Weg.
    </p>

    <form class="mt-4 flex flex-col gap-4" @submit.prevent="answer">
      <FieldGroup>
        <Field>
          <FieldLabel for="blindDateWorked">Hat das Blind-Date für dich funktioniert?</FieldLabel>
          <Select
            :model-value="worked"
            @update:model-value="(value) => (worked = String(value ?? ''))"
          >
            <SelectTrigger id="blindDateWorked" class="w-full max-w-[260px] text-[12.5px]">
              <SelectValue placeholder="Bitte wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in WORKED" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel for="blindDateAgain">Möchtest du wieder ein Blind-Date?</FieldLabel>
          <Select
            :model-value="again"
            @update:model-value="(value) => (again = String(value ?? ''))"
          >
            <SelectTrigger id="blindDateAgain" class="w-full max-w-[260px] text-[12.5px]">
              <SelectValue placeholder="Bitte wählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in AGAIN" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel for="blindDateFeedbackNote">
            Was hat gut funktioniert, was hat gefehlt? Optional
          </FieldLabel>
          <Textarea
            id="blindDateFeedbackNote"
            v-model="note"
            :maxlength="TEXT_LIMIT.submitBlindDateFeedback.note.maxLength"
            placeholder="Was dem Team helfen würde"
            class="max-w-[70ch]"
            rows="3"
          />
          <p class="text-control text-ink-5">Liest nur das Team.</p>
        </Field>
      </FieldGroup>

      <p v-if="error" class="text-[12.5px] text-destructive" role="alert">{{ error }}</p>

      <div class="flex flex-wrap items-center gap-3">
        <Button type="submit" :disabled="isPending || !complete">
          <Spinner v-if="isPending" />
          Abschicken
        </Button>
        <!-- Beside the send button and not hidden away: declining has to be as easy as answering,
             or „freiwillig" is a word rather than a fact. -->
        <Button type="button" variant="ghost" size="sm" :disabled="isPending" @click="decline">
          Nein danke
        </Button>
      </div>
    </form>
  </section>
</template>
