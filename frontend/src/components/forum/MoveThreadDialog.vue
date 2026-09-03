<script setup lang="ts">
/**
 * Moving a thread into another sub-forum.
 *
 * The choices come from `getForumOverview`, which is already filtered to what this account may
 * read — so a sub-forum that would be refused is never offered. Grouped under their categories,
 * because that is how the forum's front page is read and a flat list of a dozen names is not.
 *
 * The one thing this has to say out loud is what the move does to who can read the thread. A
 * thread with a setting of its own keeps it, and the stricter of the two still wins; a thread
 * without one takes on wherever it lands. Only the second case can change who sees it, and it is
 * named rather than left to be discovered.
 */
import { computed, ref, watch } from 'vue'
import {
  getGetForumThreadQueryKey,
  useGetForumOverview,
  useMoveForumThread,
} from '@/api/forum/forum'
import type { GetForumOverview200CategoriesItem } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { FORUM_VISIBILITY_LABELS } from '@/lib/format/forumVisibility'
import type { ForumVisibility } from '@/lib/format/forumVisibility'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  threadId: string
  title: string
  subForumId: string
  /** The thread's own setting, or null where it simply follows its sub-forum. */
  visibility: ForumVisibility | null
}>()

const { data } = useGetForumOverview()

const categories = computed<GetForumOverview200CategoriesItem[]>(() =>
  data.value?.status === 200 ? data.value.data.categories : [],
)

const target = ref<string>('')
const error = ref<string | undefined>(undefined)

// Starts where the thread already is, so the dialog opens showing the truth rather than empty.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    target.value = props.subForumId
    error.value = undefined
  },
  { immediate: true },
)

const chosen = computed(() =>
  categories.value.flatMap((category) => category.subForums).find((one) => one.id === target.value),
)

/**
 * Said only when it is true: the thread has no setting of its own, so it will be read at whatever
 * the target says — and that is different from what it says now.
 */
const willChangeReaders = computed<boolean>(() => {
  const here = categories.value
    .flatMap((category) => category.subForums)
    .find((one) => one.id === props.subForumId)

  return (
    props.visibility === null &&
    chosen.value !== undefined &&
    here !== undefined &&
    chosen.value.visibility !== here.visibility
  )
})

const { mutateAsync: moveThread, isPending } = useMoveForumThread()

async function confirm() {
  if (target.value === '' || target.value === props.subForumId) {
    open.value = false
    return
  }

  error.value = undefined

  try {
    await moveThread({ threadId: props.threadId, data: { subForumId: target.value } })
  } catch (failure) {
    error.value = failureMessage(
      failure,
      'Das Thema konnte nicht verschoben werden. Versuche es noch einmal.',
    )
    return
  }

  await queryClient.invalidateQueries({
    queryKey: getGetForumThreadQueryKey(props.threadId),
  })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>„{{ props.title }}“ verschieben</DialogTitle>
        <DialogDescription>
          Die Beiträge bleiben, wie sie sind. Das Thema rutscht nicht nach oben — Verschieben zählt
          nicht als Aktivität.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-note text-ink-4">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <FieldGroup>
          <Field>
            <FieldLabel for="moveThreadTarget">Abteil</FieldLabel>
            <Select
              :model-value="target"
              @update:model-value="(value) => (target = String(value ?? ''))"
            >
              <SelectTrigger id="moveThreadTarget" class="w-full text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup v-for="category in categories" :key="category.id">
                  <SelectLabel>{{ category.title }}</SelectLabel>
                  <SelectItem
                    v-for="subForum in category.subForums"
                    :key="subForum.id"
                    :value="subForum.id"
                  >
                    {{ subForum.title }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p v-if="chosen" class="text-control text-ink-5">
              Lesbar für: {{ FORUM_VISIBILITY_LABELS[chosen.visibility] }}
            </p>
          </Field>
        </FieldGroup>

        <p v-if="willChangeReaders" class="text-control text-ink-4">
          Dieses Thema hat keine eigene Sichtbarkeit und übernimmt deshalb die des Abteils. Nach dem
          Verschieben lesen es andere als bisher.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="isPending || target === ''" @click="confirm">
          <Spinner v-if="isPending" />
          Verschieben
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
