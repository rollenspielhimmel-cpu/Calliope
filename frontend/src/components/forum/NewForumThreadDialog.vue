<script setup lang="ts">
/**
 * Opening a thread: a title and the first post, written together. A thread with nothing in it
 * would stand in the list as a row nobody can answer, which is why the API takes both at once.
 *
 * The writing surface is `PostEditor`, the same one the group composer uses — a forum post and a
 * group post are the same document, and only the table they land in differs.
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCreateForumThread } from '@/api/forum/forum'
import type { PostDocument } from '@/api/models'
import { emptyDocument } from '@/lib/document/emptyDocument'
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
import PostEditor from '@/components/thread/PostEditor.vue'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ subForumId: string }>()
const emit = defineEmits<{ opened: [] }>()

const router = useRouter()

const title = ref<string>('')
const document = ref<PostDocument>(emptyDocument())
const text = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: openThread, isPending } = useCreateForumThread()

// Emptied each time it opens, so a dialog closed without sending does not keep the abandoned text.
watch(open, (isOpen) => {
  if (!isOpen) return
  title.value = ''
  document.value = emptyDocument()
  text.value = ''
  error.value = undefined
})

const isComplete = computed<boolean>(
  () => title.value.trim().length > 0 && text.value.trim().length > 0,
)

async function submit() {
  if (!isComplete.value) return

  error.value = undefined

  let threadId: string

  try {
    const answer = await openThread({
      subForumId: props.subForumId,
      data: { title: title.value.trim(), document: document.value },
    })

    if (answer.status !== 200) {
      error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
      return
    }

    threadId = answer.data.threadId
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  open.value = false
  emit('opened')
  // Straight into the thread that was just opened: that is what somebody wanted to do.
  await router.push({ name: 'forumThread', params: { threadId } })
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-wide">
      <DialogHeader>
        <DialogTitle>Thema eröffnen</DialogTitle>
        <DialogDescription>
          Der Titel steht in der Themenliste, der Text ist der erste Beitrag.
        </DialogDescription>
      </DialogHeader>

      <div class="flex max-h-[60vh] flex-col gap-4 overflow-auto">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <FieldGroup>
          <Field>
            <FieldLabel for="forumThreadTitle">Titel</FieldLabel>
            <Input
              id="forumThreadTitle"
              v-model="title"
              :maxlength="TEXT_LIMIT.createForumThread.title.maxLength"
              autocomplete="off"
            />
          </Field>
        </FieldGroup>

        <PostEditor v-model:document="document" v-model:text="text" :disabled="isPending" framed />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="!isComplete || isPending" @click="submit">
          <Spinner v-if="isPending" />
          Eröffnen
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
