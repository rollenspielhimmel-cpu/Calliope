<script setup lang="ts">
/**
 * Answering the optional questions the administration defined. Its own section with its own save
 * button rather than woven into the profile form beside it: the questions are not fixed fields,
 * so they cannot be declared to that form up front.
 *
 * Every question is marked optional, because on a form where everything is optional silence
 * would otherwise read as an obligation — the reason the fixed fields are marked the same way.
 */
import { computed, ref, watch } from 'vue'
import {
  getGetProfileAnswersQueryKey,
  useGetProfileAnswers,
  useListProfileQuestions,
  useSetProfileAnswers,
} from '@/api/users/users'
import type { ListProfileQuestions200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The generated `TEXT_LIMIT` only covers flat body properties, and the answers arrive as an
 * array, so this restates `TEXT_LIMIT.profileDetail` from the backend.
 */
const ANSWER_MAX_LENGTH = 500

const props = defineProps<{ userId: string }>()
const emit = defineEmits<{ saved: [] }>()

const { data: questionData } = useListProfileQuestions()
const { data: answerData } = useGetProfileAnswers(() => props.userId)

const questions = computed<ListProfileQuestions200Item[]>(() =>
  questionData.value?.status === 200 ? questionData.value.data : [],
)

/** Keyed by question, holding either the typed text or the chosen option's id. */
const values = ref<Record<string, string>>({})
const error = ref<string | undefined>(undefined)

// Filled from what is stored, once. A text answer comes back as its text; a chosen option comes
// back as its *label*, so it is matched to the option that carries it to recover the id.
watch(
  [questions, answerData],
  () => {
    if (answerData.value?.status !== 200) return

    const stored: Record<string, string> = {}

    for (const answer of answerData.value.data) {
      const question = questions.value.find((one) => one.id === answer.questionId)

      if (question?.kind === 'choice') {
        const chosen = question.options.find((option) => option.label === answer.answer)
        if (chosen) stored[answer.questionId] = chosen.id
      } else {
        stored[answer.questionId] = answer.answer
      }
    }

    values.value = stored
  },
  { immediate: true },
)

const { mutateAsync: save, isPending } = useSetProfileAnswers()

async function submit() {
  error.value = undefined

  const answers = questions.value.map((question) => {
    const value = values.value[question.id] ?? ''

    // Neither field set withdraws the answer, and the question then leaves the profile again.
    if (value.trim().length === 0) {
      return { questionId: question.id }
    }

    return question.kind === 'choice'
      ? { questionId: question.id, optionId: value }
      : { questionId: question.id, text: value }
  })

  try {
    await save({ data: { answers } })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({
    queryKey: getGetProfileAnswersQueryKey(props.userId),
  })
  emit('saved')
}
</script>

<template>
  <div v-if="questions.length > 0" class="flex flex-col gap-4">
    <p class="text-[12.5px] text-ink-5">
      Alles hier ist freiwillig. Was du offen lässt, steht auf deinem Profil auch nicht.
    </p>

    <div v-for="question in questions" :key="question.id" class="flex flex-col gap-1.5">
      <span class="text-[12.5px] text-ink-4">
        {{ question.prompt }}
        <span class="ml-1 text-[11.5px] text-ink-6">optional</span>
      </span>

      <Select
        v-if="question.kind === 'choice'"
        :model-value="values[question.id] ?? ''"
        @update:model-value="(value) => (values[question.id] = String(value ?? ''))"
      >
        <SelectTrigger :aria-label="question.prompt" class="w-full text-[12.5px]">
          <SelectValue placeholder="Keine Angabe" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in question.options" :key="option.id" :value="option.id">
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <Input
        v-else
        v-model="values[question.id]"
        :maxlength="ANSWER_MAX_LENGTH"
        :aria-label="question.prompt"
      />
    </div>

    <div>
      <Button variant="outline" size="sm" :disabled="isPending" @click="submit">
        <Spinner v-if="isPending" />
        Antworten speichern
      </Button>
    </div>

    <p v-if="error" class="text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </div>
</template>
