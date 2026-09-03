<script setup lang="ts">
/**
 * The forum's shape, as administration keeps it: which categories exist, which sub-forums sit
 * under them, in what order, and who may read each one.
 *
 * Unlike the forum's own page this hides nothing — a sub-forum only administration may read is
 * still listed here, because this is where it is edited.
 *
 * Reordering is a pair of arrows rather than dragging: the design system reserves `GripVertical`
 * for drag-reorder "only if it ships", and two buttons need no pointer, work on a phone and are
 * one keystroke each. They swap a row with its neighbour, which is the whole of what `position`
 * means here.
 */
import { computed, ref } from 'vue'
import {
  getGetForumStructureQueryKey,
  useCreateForumCategory,
  useCreateSubForum,
  useDeleteForumCategory,
  useDeleteSubForum,
  useGetForumStructure,
  useUpdateForumCategory,
  useUpdateSubForum,
} from '@/api/forum/forum'
import type { GetForumStructure200Item, GetForumStructure200ItemSubForumsItem } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { FORUM_VISIBILITY_LABELS } from '@/lib/format/forumVisibility'
import type { ForumVisibility } from '@/lib/format/forumVisibility'
import { TEXT_LIMIT } from '@/api/textLimit'
import { ChevronDown, ChevronUp } from '@lucide/vue'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Visibility = ForumVisibility
type Category = GetForumStructure200Item
type SubForum = GetForumStructure200ItemSubForumsItem

/** Named for who reads it, in the order the enum is declared: open first — shared with the
 * forum's own pages, so the four settings cannot be worded two ways. */
const VISIBILITY_LABELS = FORUM_VISIBILITY_LABELS

const { data, isPending } = useGetForumStructure()

const categories = computed<Category[]>(() => (data.value?.status === 200 ? data.value.data : []))

const error = ref<string | undefined>(undefined)

const { mutateAsync: createCategory, isPending: isCreatingCategory } = useCreateForumCategory()
const { mutateAsync: updateCategory } = useUpdateForumCategory()
const { mutateAsync: removeCategory } = useDeleteForumCategory()
const { mutateAsync: createSubForum, isPending: isCreatingSubForum } = useCreateSubForum()
const { mutateAsync: updateSubForum } = useUpdateSubForum()
const { mutateAsync: removeSubForum } = useDeleteSubForum()

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getGetForumStructureQueryKey() })
}

/** Every write goes through here, so a refusal is said once rather than at seven call sites. */
async function run(action: () => Promise<unknown>, whenRefused?: string) {
  error.value = undefined

  try {
    await action()
  } catch {
    error.value = whenRefused ?? 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return false
  }

  await refresh()
  return true
}

// ── Categories ───────────────────────────────────────────────────────────────────────────
const newCategoryTitle = ref<string>('')
const editingCategoryId = ref<string | undefined>(undefined)
const categoryTitle = ref<string>('')

async function addCategory() {
  const title = newCategoryTitle.value.trim()
  if (title.length === 0) return

  if (await run(() => createCategory({ data: { title, position: categories.value.length } }))) {
    newCategoryTitle.value = ''
  }
}

function startCategoryEdit(category: Category) {
  editingCategoryId.value = category.id
  categoryTitle.value = category.title
  error.value = undefined
}

async function saveCategory(category: Category) {
  const title = categoryTitle.value.trim()
  if (title.length === 0) return

  if (
    await run(() =>
      updateCategory({ categoryId: category.id, data: { title, position: category.position } }),
    )
  ) {
    editingCategoryId.value = undefined
  }
}

async function deleteCategory(category: Category) {
  await run(
    () => removeCategory({ categoryId: category.id }),
    'Diese Kategorie hält noch Unterforen. Verschieb oder lösch die zuerst.',
  )
}

/** Swaps a category with its neighbour by writing both positions. */
async function moveCategory(index: number, by: -1 | 1) {
  const category = categories.value[index]
  const neighbour = categories.value[index + by]
  if (category === undefined || neighbour === undefined) return

  await run(async () => {
    await updateCategory({
      categoryId: category.id,
      data: { title: category.title, position: neighbour.position },
    })
    await updateCategory({
      categoryId: neighbour.id,
      data: { title: neighbour.title, position: category.position },
    })
  })
}

// ── Sub-forums ───────────────────────────────────────────────────────────────────────────
/** Set to the category a new sub-forum is being written into, or to the sub-forum being edited. */
const addingTo = ref<string | undefined>(undefined)
const editingSubForumId = ref<string | undefined>(undefined)

const form = ref<{
  categoryId: string
  title: string
  description: string
  visibility: Visibility
}>({ categoryId: '', title: '', description: '', visibility: 'members' })

function startAdd(category: Category) {
  addingTo.value = category.id
  editingSubForumId.value = undefined
  form.value = {
    categoryId: category.id,
    title: '',
    description: '',
    visibility: 'members',
  }
  error.value = undefined
}

function startEdit(subForum: SubForum) {
  editingSubForumId.value = subForum.id
  addingTo.value = undefined
  form.value = {
    categoryId: subForum.categoryId,
    title: subForum.title,
    description: subForum.description,
    visibility: subForum.visibility,
  }
  error.value = undefined
}

function closeForm() {
  addingTo.value = undefined
  editingSubForumId.value = undefined
}

const isFormComplete = computed<boolean>(
  () => form.value.title.trim().length > 0 && form.value.description.trim().length > 0,
)

async function saveSubForum(position: number) {
  if (!isFormComplete.value) return

  const body = {
    categoryId: form.value.categoryId,
    title: form.value.title.trim(),
    description: form.value.description.trim(),
    visibility: form.value.visibility,
    position,
  }

  const id = editingSubForumId.value

  if (
    await run(() =>
      id === undefined
        ? createSubForum({ data: body })
        : updateSubForum({ subForumId: id, data: body }),
    )
  ) {
    closeForm()
  }
}

async function deleteSubForum(subForum: SubForum) {
  await run(
    () => removeSubForum({ subForumId: subForum.id }),
    'Dieses Unterforum hält noch Themen. Verschieb die zuerst, oder schließ es über die Sichtbarkeit.',
  )
}

/** Swaps a sub-forum with its neighbour inside its own category. */
async function moveSubForum(category: Category, index: number, by: -1 | 1) {
  const subForum = category.subForums[index]
  const neighbour = category.subForums[index + by]
  if (subForum === undefined || neighbour === undefined) return

  await run(async () => {
    await updateSubForum({
      subForumId: subForum.id,
      data: { ...subForum, position: neighbour.position },
    })
    await updateSubForum({
      subForumId: neighbour.id,
      data: { ...neighbour, position: subForum.position },
    })
  })
}
</script>

<template>
  <ModerationPage
    title="Forum-Struktur"
    description="Welche Kategorien und Unterforen es gibt, in welcher Reihenfolge sie stehen und wer sie lesen darf. Ein Thema in ein geschlossenes Unterforum zu verschieben blendet es aus — die strengere der beiden Einstellungen gilt."
  >
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <p v-if="categories.length === 0" class="text-note text-ink-5">
        Es gibt noch keine Kategorie. Leg unten die erste an.
      </p>

      <section v-for="(category, categoryIndex) in categories" :key="category.id" class="mb-8">
        <div
          class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-3 pb-2"
        >
          <template v-if="editingCategoryId === category.id">
            <Input
              v-model="categoryTitle"
              :maxlength="TEXT_LIMIT.updateForumCategory.title.maxLength"
              aria-label="Name der Kategorie"
              class="w-full sm:w-[320px]"
            />
            <span class="flex gap-2">
              <Button variant="outline" size="xs" @click="saveCategory(category)">Speichern</Button>
              <Button variant="ghost" size="xs" @click="editingCategoryId = undefined">
                Abbrechen
              </Button>
            </span>
          </template>

          <template v-else>
            <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
              {{ category.title }}
            </h2>
            <span class="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                :disabled="categoryIndex === 0"
                aria-label="Kategorie nach oben"
                @click="moveCategory(categoryIndex, -1)"
              >
                <ChevronUp :size="14" :stroke-width="1.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                :disabled="categoryIndex === categories.length - 1"
                aria-label="Kategorie nach unten"
                @click="moveCategory(categoryIndex, 1)"
              >
                <ChevronDown :size="14" :stroke-width="1.5" aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="xs" @click="startCategoryEdit(category)">
                Umbenennen
              </Button>
              <Button variant="ghost" size="xs" @click="deleteCategory(category)">Löschen</Button>
            </span>
          </template>
        </div>

        <ul class="mt-3 flex flex-col gap-2.5">
          <li
            v-for="(subForum, subForumIndex) in category.subForums"
            :key="subForum.id"
            class="rounded-lg border border-line-3 bg-paper-0 p-3.5 shadow-card"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-row text-ink-2">
                {{ subForum.title }}
                <span class="ml-2 text-[11.5px] text-ink-6">
                  {{ VISIBILITY_LABELS[subForum.visibility] }}
                </span>
              </p>
              <span class="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  :disabled="subForumIndex === 0"
                  aria-label="Unterforum nach oben"
                  @click="moveSubForum(category, subForumIndex, -1)"
                >
                  <ChevronUp :size="14" :stroke-width="1.5" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  :disabled="subForumIndex === category.subForums.length - 1"
                  aria-label="Unterforum nach unten"
                  @click="moveSubForum(category, subForumIndex, 1)"
                >
                  <ChevronDown :size="14" :stroke-width="1.5" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="xs" @click="startEdit(subForum)">Bearbeiten</Button>
                <Button variant="ghost" size="xs" @click="deleteSubForum(subForum)">Löschen</Button>
              </span>
            </div>
            <p class="mt-1 text-[12.5px] text-ink-4">{{ subForum.description }}</p>

            <!-- The form appears under the row it edits, rather than in a dialog: the list is
                 what somebody is comparing against while they write. -->
            <form
              v-if="editingSubForumId === subForum.id"
              class="mt-3 flex flex-col gap-3 border-t border-line-3 pt-3"
              @submit.prevent="saveSubForum(subForum.position)"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel :for="`title-${subForum.id}`">Titel</FieldLabel>
                  <Input
                    :id="`title-${subForum.id}`"
                    v-model="form.title"
                    :maxlength="TEXT_LIMIT.updateSubForum.title.maxLength"
                  />
                </Field>

                <Field>
                  <FieldLabel :for="`description-${subForum.id}`">Beschreibung</FieldLabel>
                  <Textarea
                    :id="`description-${subForum.id}`"
                    v-model="form.description"
                    :maxlength="TEXT_LIMIT.updateSubForum.description.maxLength"
                    rows="2"
                  />
                </Field>

                <Field>
                  <FieldLabel :for="`category-${subForum.id}`">Kategorie</FieldLabel>
                  <Select
                    :model-value="form.categoryId"
                    @update:model-value="(value) => (form.categoryId = String(value ?? ''))"
                  >
                    <SelectTrigger :id="`category-${subForum.id}`" class="w-full text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="one in categories" :key="one.id" :value="one.id">
                        {{ one.title }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p class="text-control text-ink-5">
                    Eine andere Kategorie zu wählen verschiebt das Unterforum dorthin.
                  </p>
                </Field>

                <Field>
                  <FieldLabel :for="`visibility-${subForum.id}`">Sichtbar für</FieldLabel>
                  <Select
                    :model-value="form.visibility"
                    @update:model-value="(value) => (form.visibility = value as Visibility)"
                  >
                    <SelectTrigger :id="`visibility-${subForum.id}`" class="w-full text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="(label, value) in VISIBILITY_LABELS"
                        :key="value"
                        :value="value"
                      >
                        {{ label }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>

              <div class="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" size="sm" :disabled="!isFormComplete">
                  Speichern
                </Button>
                <Button variant="ghost" size="sm" type="button" @click="closeForm">
                  Abbrechen
                </Button>
              </div>
            </form>
          </li>
        </ul>

        <div class="mt-3">
          <Button
            v-if="addingTo !== category.id"
            variant="outline"
            size="sm"
            @click="startAdd(category)"
          >
            Unterforum anlegen
          </Button>
        </div>

        <form
          v-if="addingTo === category.id"
          class="mt-3 flex max-w-[60ch] flex-col gap-3 rounded-lg border border-line-3 bg-paper-0 p-3.5 shadow-card"
          @submit.prevent="saveSubForum(category.subForums.length)"
        >
          <FieldGroup>
            <Field>
              <FieldLabel :for="`new-title-${category.id}`">Titel</FieldLabel>
              <Input
                :id="`new-title-${category.id}`"
                v-model="form.title"
                :maxlength="TEXT_LIMIT.createSubForum.title.maxLength"
              />
            </Field>

            <Field>
              <FieldLabel :for="`new-description-${category.id}`">Beschreibung</FieldLabel>
              <Textarea
                :id="`new-description-${category.id}`"
                v-model="form.description"
                :maxlength="TEXT_LIMIT.createSubForum.description.maxLength"
                rows="2"
              />
              <p class="text-control text-ink-5">
                Die Zeile, die auf der Forumsseite unter dem Titel steht.
              </p>
            </Field>

            <Field>
              <FieldLabel :for="`new-visibility-${category.id}`">Sichtbar für</FieldLabel>
              <Select
                :model-value="form.visibility"
                @update:model-value="(value) => (form.visibility = value as Visibility)"
              >
                <SelectTrigger :id="`new-visibility-${category.id}`" class="w-full text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="(label, value) in VISIBILITY_LABELS"
                    :key="value"
                    :value="value"
                  >
                    {{ label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          <div class="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              :disabled="!isFormComplete || isCreatingSubForum"
            >
              <Spinner v-if="isCreatingSubForum" />
              Anlegen
            </Button>
            <Button variant="ghost" size="sm" type="button" @click="closeForm">Abbrechen</Button>
          </div>
        </form>
      </section>

      <form
        class="mt-8 flex flex-wrap items-end gap-2 border-t border-line-3 pt-6"
        @submit.prevent="addCategory"
      >
        <Field class="w-full sm:w-[320px]">
          <FieldLabel for="newCategory">Kategorie anlegen</FieldLabel>
          <Input
            id="newCategory"
            v-model="newCategoryTitle"
            :maxlength="TEXT_LIMIT.createForumCategory.title.maxLength"
            placeholder="Community"
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          :disabled="newCategoryTitle.trim().length === 0 || isCreatingCategory"
        >
          <Spinner v-if="isCreatingCategory" />
          Anlegen
        </Button>
      </form>
    </template>

    <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </ModerationPage>
</template>
