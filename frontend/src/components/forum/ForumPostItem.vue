<script setup lang="ts">
/**
 * One forum post: the writing, recessed metadata, and the row of actions under it.
 *
 * A sibling of `thread/PostItem.vue` rather than a reuse of it. The two are drawn identically on
 * purpose — a post is read the same way wherever it is — but they are not the same thing: a
 * `writing_post` may be a draft and is authorised through a group's membership, neither of which
 * exists here, and the favourite kind is baked into each. What they genuinely share, the body and
 * the editor, is shared as components.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { Flag, Pencil, Trash2 } from '@lucide/vue'
import { formatActivityTime } from '@/lib/format/formatTime'
import { favouriteToggle } from '@/lib/format/favourite'
import { useFavourite } from '@/composables/useFavourite'
import type { ListForumPosts200ResultsItem, PostDocument } from '@/api/models'
import { emptyDocument } from '@/lib/document/emptyDocument'
import { sameDocument } from '@/lib/document/sameDocument'
import { Alert, AlertDescription } from '@/components/ui/alert'
import PostBody from '@/components/thread/PostBody.vue'
import PostEditor from '@/components/thread/PostEditor.vue'

const props = defineProps<{
  post: ListForumPosts200ResultsItem
  divider: boolean
  first: boolean
  /** Absent while nobody is signed in; reporting and favouriting both need an account. */
  currentUserId?: string
  mayModerate?: boolean
  /** The view decides which post is open, so two cannot be edited at once. */
  editing?: boolean
  saving?: boolean
  error?: string
}>()

const emit = defineEmits<{
  report: []
  edit: []
  cancel: []
  save: [document: PostDocument, text: string]
  delete: []
  favouriteChanged: []
}>()

const { savingFavourite, favouriteError, changeFavourite } = useFavourite()

const favourite = computed(() => favouriteToggle(props.post.isFavourite))

async function toggleFavourite() {
  if (await changeFavourite('forum_post', props.post.id, favourite.value.next)) {
    emit('favouriteChanged')
  }
}

// Only your own post is excluded. A post whose author is gone is still reportable: the writing is
// still there, and removing it is still something an operator can do.
const mayReport = computed<boolean>(
  () => props.currentUserId !== undefined && props.post.createdBy !== props.currentUserId,
)

/** The API's own rule, so the row never offers what the endpoint would refuse. */
const mayModify = computed<boolean>(
  () =>
    props.mayModerate === true ||
    (props.post.createdBy !== null && props.post.createdBy === props.currentUserId),
)

/**
 * Edited where it sits rather than in the composer below, which belongs to the answer somebody
 * may be part-way through writing.
 */
const draft = ref<PostDocument>(emptyDocument())
const draftText = ref<string>('')

const postEditor = useTemplateRef<{ focus: () => void }>('postEditor')

watch(
  () => props.editing,
  async (open) => {
    if (!open) return
    // The stored document, not a rebuild from `post.text`: that projection has no marks in it, so
    // editing a post with a heading or a bold word would silently flatten it.
    draft.value = props.post.document
    draftText.value = props.post.text
    await nextTick()
    postEditor.value?.focus()
  },
  { immediate: true },
)

/** Compared as documents: re-bolding a word changes no prose, and Speichern must still light up. */
const unchanged = computed<boolean>(() => sameDocument(draft.value, props.post.document))

/**
 * Named only when somebody other than the author edited it — moderation may, and that is the one
 * case worth saying out loud.
 */
const editedNote = computed<string | undefined>(() => {
  if (props.post.editedAt === null) return undefined

  const editor = props.post.editedByUsername
  const byAnother = editor !== null && editor !== props.post.createdByUsername
  return byAnother ? `bearbeitet von ${editor}` : 'bearbeitet'
})

const meta = computed<string>(() => {
  const author = props.post.createdByUsername ?? 'Gelöschtes Konto'
  return [author, formatActivityTime(props.post.createdAt), editedNote.value]
    .filter((part) => part !== undefined)
    .join(' · ')
})
</script>

<template>
  <article class="py-5" :class="[divider ? 'border-b border-line-2' : '', first ? 'pt-0' : '']">
    <p class="mb-[9px] text-[12px] leading-[1.3] text-ink-6">{{ meta }}</p>

    <div v-if="editing" class="flex flex-col gap-2.5">
      <PostEditor
        ref="postEditor"
        v-model:document="draft"
        v-model:text="draftText"
        :disabled="saving"
        framed
      />

      <Alert v-if="error" variant="destructive" role="alert">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <PostBody v-else :document="post.document" />

    <!-- Below the writing, recessed to the metadata's size and colour, so it does not compete
         with the prose — the same row a group's post carries. -->
    <div
      v-if="mayModify || mayReport"
      class="mt-3.5 flex items-center gap-4 text-[12px] text-ink-5"
    >
      <template v-if="editing">
        <button
          type="button"
          class="flex min-h-11 items-center font-medium text-oak-deep disabled:opacity-50 md:min-h-0"
          :disabled="saving || unchanged"
          @click="emit('save', draft, draftText)"
        >
          {{ saving ? 'Wird gespeichert …' : 'Speichern' }}
        </button>
        <button
          type="button"
          class="flex min-h-11 items-center hover:text-oak-deep md:min-h-0"
          :disabled="saving"
          @click="emit('cancel')"
        >
          Abbrechen
        </button>
      </template>

      <template v-else>
        <button
          v-if="mayModify"
          type="button"
          class="flex min-h-11 items-center gap-1.5 hover:text-oak-deep md:min-h-0"
          @click="emit('edit')"
        >
          <Pencil :size="14" :stroke-width="1.5" aria-hidden="true" />
          Bearbeiten
        </button>
        <button
          v-if="mayModify"
          type="button"
          class="flex min-h-11 items-center gap-1.5 hover:text-oak-deep md:min-h-0"
          @click="emit('delete')"
        >
          <Trash2 :size="14" :stroke-width="1.5" aria-hidden="true" />
          Löschen
        </button>
        <!-- A raw button rather than `FavouriteToggle`, as in a group's thread: this row is text
             actions sharing one baseline. The wording still comes from `favouriteToggle`. -->
        <button
          v-if="currentUserId"
          type="button"
          class="flex min-h-11 items-center gap-1.5 hover:text-oak-deep md:min-h-0"
          :title="favourite.title"
          :disabled="savingFavourite"
          @click="toggleFavourite"
        >
          <component :is="favourite.icon" :size="14" :stroke-width="1.5" aria-hidden="true" />
          {{ favourite.label }}
        </button>

        <span v-if="favouriteError" class="flex items-center text-destructive" role="alert">
          {{ favouriteError }}
        </span>

        <button
          v-if="mayReport"
          type="button"
          class="flex min-h-11 items-center gap-1.5 hover:text-oak-deep md:min-h-0"
          @click="emit('report')"
        >
          <Flag :size="14" :stroke-width="1.5" aria-hidden="true" />
          Melden
        </button>
      </template>
    </div>
  </article>
</template>
