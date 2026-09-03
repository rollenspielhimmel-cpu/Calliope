<script setup lang="ts">
/**
 * The optional profile questions, defined here rather than in the code.
 *
 * A question a member leaves unanswered does not appear on their profile at all — that is the
 * rule from the product document, and it is why an unanswered question is stored as no row
 * rather than as an empty one.
 */
import { computed, ref } from 'vue'
import {
  getListProfileQuestionsQueryKey,
  useCreateProfileQuestion,
  useDeleteProfileQuestion,
  useListProfileQuestions,
  useUpdateProfileQuestion,
} from '@/api/users/users'
import type { ListProfileQuestions200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { TEXT_LIMIT } from '@/api/textLimit'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
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

type Kind = 'text' | 'choice'

const KIND_LABELS: Record<Kind, string> = {
  text: 'Freie Textantwort',
  choice: 'Auswahl aus Antwortmöglichkeiten',
}

const { data, isPending } = useListProfileQuestions()

const questions = computed<ListProfileQuestions200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

/** Grouped the way the profile shows them, so the order here is the order there. */
const sections = computed<{ name: string; questions: ListProfileQuestions200Item[] }[]>(() => {
  const grouped = new Map<string, ListProfileQuestions200Item[]>()

  for (const question of questions.value) {
    grouped.set(question.section, [...(grouped.get(question.section) ?? []), question])
  }

  return [...grouped.entries()].map(([name, list]) => ({ name, questions: list }))
})

const editing = ref<boolean>(false)
const editingId = ref<string | undefined>(undefined)
const section = ref<string>('')
const prompt = ref<string>('')
const kind = ref<Kind>('text')
const position = ref<number>(0)
/** One per line: a list of options is a list of lines, which is how somebody types one. */
const options = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: create, isPending: isCreating } = useCreateProfileQuestion()
const { mutateAsync: update, isPending: isUpdating } = useUpdateProfileQuestion()
const { mutateAsync: remove, isPending: isDeleting } = useDeleteProfileQuestion()

const isSaving = computed<boolean>(() => isCreating.value || isUpdating.value)

function startNew() {
  editing.value = true
  editingId.value = undefined
  section.value = ''
  prompt.value = ''
  kind.value = 'text'
  position.value = questions.value.length
  options.value = ''
  error.value = undefined
}

function startEdit(question: ListProfileQuestions200Item) {
  editing.value = true
  editingId.value = question.id
  section.value = question.section
  prompt.value = question.prompt
  kind.value = question.kind
  position.value = question.position
  options.value = question.options.map((option) => option.label).join('\n')
  error.value = undefined
}

async function save() {
  error.value = undefined

  const body = {
    section: section.value.trim(),
    prompt: prompt.value.trim(),
    kind: kind.value,
    position: position.value,
    options:
      kind.value === 'choice'
        ? options.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        : [],
  }

  if (body.kind === 'choice' && body.options.length === 0) {
    error.value = 'Eine Auswahlfrage braucht mindestens eine Antwortmöglichkeit.'
    return
  }

  try {
    if (editingId.value === undefined) {
      await create({ data: body })
    } else {
      await update({ questionId: editingId.value, data: body })
    }
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  editing.value = false
  await queryClient.invalidateQueries({ queryKey: getListProfileQuestionsQueryKey() })
}

async function deleteOne(questionId: string) {
  error.value = undefined

  try {
    await remove({ questionId })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListProfileQuestionsQueryKey() })
}

const isComplete = computed<boolean>(
  () => section.value.trim().length > 0 && prompt.value.trim().length > 0,
)
</script>

<template>
  <ModerationPage
    title="Profilfelder"
    description="Die freiwilligen Fragen, die ein Profil stellt. Was ein Mitglied nicht beantwortet, steht auf seinem Profil auch nicht — es bleibt dann beim selbst geschriebenen Text."
  >
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <div>
        <Button variant="outline" size="sm" @click="startNew">Frage anlegen</Button>
      </div>

      <p v-if="questions.length === 0" class="mt-4 text-note text-ink-5">
        Es gibt noch keine Frage. Bis dahin zeigt ein Profil nur die festen Felder.
      </p>

      <section v-for="group in sections" :key="group.name" class="mt-6">
        <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          {{ group.name }}
        </h2>

        <ul class="mt-2 flex flex-col">
          <li
            v-for="question in group.questions"
            :key="question.id"
            class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-row text-ink-2">{{ question.prompt }}</p>
              <span class="flex flex-wrap gap-2">
                <Button variant="ghost" size="xs" @click="startEdit(question)">Bearbeiten</Button>
                <Button
                  variant="ghost"
                  size="xs"
                  :disabled="isDeleting"
                  @click="deleteOne(question.id)"
                >
                  Löschen
                </Button>
              </span>
            </div>
            <p class="mt-1 text-[12px] text-ink-6">
              {{ KIND_LABELS[question.kind] }}
              <template v-if="question.options.length > 0">
                · {{ question.options.map((option) => option.label).join(', ') }}
              </template>
            </p>
          </li>
        </ul>
      </section>

      <form
        v-if="editing"
        class="mt-8 flex max-w-[60ch] flex-col gap-4 border-t border-line-3 pt-6"
        @submit.prevent="save"
      >
        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Profilbereich</span>
          <Input
            v-model="section"
            :maxlength="TEXT_LIMIT.createProfileQuestion.section.maxLength"
            aria-label="Profilbereich"
            placeholder="Persönliches"
          />
          <p class="text-[12px] text-ink-6">
            Unter welcher Überschrift die Frage steht, etwa „Persönliches" oder „Rollenspiele und
            ich". Gleich geschriebene Bereiche stehen zusammen.
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Frage</span>
          <Input
            v-model="prompt"
            :maxlength="TEXT_LIMIT.createProfileQuestion.prompt.maxLength"
            aria-label="Frage"
            placeholder="Lieblingsserien"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Art der Antwort</span>
          <Select :model-value="kind" @update:model-value="(value) => (kind = value as Kind)">
            <SelectTrigger aria-label="Art der Antwort" class="w-full text-[12.5px] sm:w-[320px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="(label, value) in KIND_LABELS" :key="value" :value="value">
                {{ label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div v-if="kind === 'choice'" class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Antwortmöglichkeiten</span>
          <textarea
            v-model="options"
            aria-label="Antwortmöglichkeiten"
            rows="6"
            class="min-h-11 rounded-lg border border-line-5 bg-paper-2 px-3 py-2 text-[13px] text-ink-2 outline-none md:min-h-0"
          ></textarea>
          <p class="text-[12px] text-ink-6">
            Eine pro Zeile. Nimmst du eine heraus, verschwinden auch die Antworten, die sie gewählt
            hatten — eine Antwort auf eine Möglichkeit, die es nicht mehr gibt, sagt nichts mehr
            aus.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <Button type="submit" :disabled="!isComplete || isSaving">
            <Spinner v-if="isSaving" />
            Speichern
          </Button>
          <Button variant="outline" type="button" @click="editing = false">Abbrechen</Button>
        </div>
      </form>
    </template>

    <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </ModerationPage>
</template>
