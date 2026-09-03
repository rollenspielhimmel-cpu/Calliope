<script setup lang="ts">
/**
 * One forum thread: its posts, oldest first, and a box to answer in.
 *
 * The posts are drawn the way a thread's posts are drawn — recessed metadata and a hairline
 * divider, no boxes — because that rule comes from what members said about reading, and a forum
 * post is read the same way a group post is.
 *
 * Whether a reply is offered comes from the thread's `effectiveVisibility`, which the API has
 * already resolved as the stricter of the thread's own setting and its sub-forum's.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  getGetForumThreadQueryKey,
  getListForumPostsQueryKey,
  useCreateForumPost,
  useDeleteForumPost,
  useGetForumThread,
  useListForumPosts,
  useUpdateForumPost,
} from '@/api/forum/forum'
import { useGetCurrentUser } from '@/api/auth/auth'
import { GetCurrentUser200PlatformRole } from '@/api/models'
import type { ListForumPosts200ResultsItem, ListForumPostsBody, PostDocument } from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { emptyDocument } from '@/lib/document/emptyDocument'
import { failureMessage } from '@/lib/format/failure'
import { firstMessage, postSchema } from '@/lib/validation/fieldSchemas'
import { queryClient } from '@/lib/api/queryClient'
import { listKeyPrefix } from '@/lib/api/queryKeys'
import { formatActivityTime } from '@/lib/format/formatTime'
import { usePagedList } from '@/composables/usePagedList'
import { restrictedForumLabel } from '@/lib/format/forumVisibility'
import { ChevronLeft, Eye, FolderInput } from '@lucide/vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import ListPagination from '@/components/common/ListPagination.vue'
import ForumPostItem from '@/components/forum/ForumPostItem.vue'
import MoveThreadDialog from '@/components/forum/MoveThreadDialog.vue'
import ThreadVisibilityDialog from '@/components/forum/ThreadVisibilityDialog.vue'
import ModerationToolButton from '@/components/moderation/ModerationToolButton.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import DeletePostDialog from '@/components/thread/DeletePostDialog.vue'
import PostEditor from '@/components/thread/PostEditor.vue'
import ReportDialog from '@/components/report/ReportDialog.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const PAGE_SIZE = 20

const route = useRoute()
const threadId = computed<string>(() => String(route.params.threadId))

const { data: currentUserData } = useGetCurrentUser()
const signedIn = computed<boolean>(() => currentUserData.value?.status === 200)

const currentUserId = computed<string | undefined>(() =>
  currentUserData.value?.status === 200 ? currentUserData.value.data.id : undefined,
)

/**
 * The same rule the write endpoints apply — `mayModeratePlatform` covers both roles — so the row
 * of actions never offers what the API would refuse.
 */
const mayModerate = computed<boolean>(
  () =>
    currentUserData.value?.status === 200 &&
    (currentUserData.value.data.platformRole === GetCurrentUser200PlatformRole.moderator ||
      currentUserData.value.data.platformRole === GetCurrentUser200PlatformRole.administrator),
)

const { data: threadData, isPending: threadPending } = useGetForumThread(threadId)

const thread = computed(() =>
  threadData.value?.status === 200 ? threadData.value.data : undefined,
)

const { page, offset, total, itemsPerPage, goToPage } = usePagedList(
  PAGE_SIZE,
  () => totalResults.value,
)

const body = computed<ListForumPostsBody>(() => ({
  limit: PAGE_SIZE,
  offset: offset.value,
  sortAttribute: 'createdAt',
  sortOrder: 'asc',
}))

const { data, isPending } = useListForumPosts(threadId, body)

const posts = computed<ListForumPosts200ResultsItem[]>(() =>
  data.value?.status === 200 ? data.value.data.results : [],
)

const totalResults = computed<number>(() =>
  data.value?.status === 200 ? data.value.data.totalResults : 0,
)

watch(threadId, () => goToPage(1))

/** Everything on this page reads the same list, so one invalidation serves all of it. */
async function refreshPosts() {
  await queryClient.invalidateQueries({
    queryKey: listKeyPrefix(getListForumPostsQueryKey(threadId.value, body.value)),
  })
}

const document = ref<PostDocument>(emptyDocument())
const text = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: reply, isPending: isSending } = useCreateForumPost()

async function submit() {
  if (text.value.trim().length === 0) return

  error.value = undefined

  try {
    await reply({ threadId: threadId.value, data: { document: document.value } })
  } catch {
    // The composer keeps what was written: the member's copy is the one that matters.
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  document.value = emptyDocument()
  text.value = ''

  await refreshPosts()

  // The answer lands at the end, which is where the last page is.
  goToPage(Math.max(1, Math.ceil((totalResults.value + 1) / PAGE_SIZE)))
}

/** An empty edit is a mistake; an empty composer is just a composer nobody has typed in yet. */
const EDITED_POST = postSchema(TEXT_LIMIT.updateForumPost.document, 'Ein Beitrag braucht Text.')

const { mutateAsync: savePost, isPending: savingPost } = useUpdateForumPost()

const editingPostId = ref<string | undefined>(undefined)
const editError = ref<string | undefined>(undefined)

function startEditing(postId: string) {
  editError.value = undefined
  editingPostId.value = postId
}

function stopEditing() {
  editError.value = undefined
  editingPostId.value = undefined
}

async function saveEdit(postId: string, edited: PostDocument, editedText: string) {
  // Checked here rather than with `maxlength`, for the reason the composer states: prose that
  // stops dead mid-word is worse than being told why.
  editError.value = firstMessage(EDITED_POST.safeParse(editedText))
  if (editError.value !== undefined) return

  try {
    await savePost({ threadId: threadId.value, postId, data: { document: edited } })
  } catch (failure) {
    editError.value = failureMessage(
      failure,
      'Der Beitrag konnte nicht gespeichert werden. Versuche es noch einmal.',
    )
    return
  }

  await refreshPosts()
  stopEditing()
}

const deletingPost = ref<ListForumPosts200ResultsItem | undefined>(undefined)
const deletePostError = ref<string | undefined>(undefined)

const { mutateAsync: removePost, isPending: removingPost } = useDeleteForumPost()

/** Named only when it is somebody else's and that account still exists. */
const deletingPostAuthor = computed<string | undefined>(() =>
  deletingPost.value !== undefined && deletingPost.value.createdBy !== currentUserId.value
    ? (deletingPost.value.createdByUsername ?? undefined)
    : undefined,
)

async function confirmDeletePost() {
  const post = deletingPost.value
  if (post === undefined) return

  deletePostError.value = undefined

  try {
    await removePost({ threadId: threadId.value, postId: post.id })
  } catch (failure) {
    deletePostError.value = failureMessage(
      failure,
      'Der Beitrag konnte nicht gelöscht werden. Versuche es noch einmal.',
    )
    return
  }

  // The post being edited may be the one just deleted.
  if (editingPostId.value === post.id) stopEditing()
  await refreshPosts()
  deletingPost.value = undefined

  // Removing the last post removes the thread with it, and `getForumThread` then answers 404 —
  // which is the "Kein Thema gefunden" state below, and is the truth.
  await queryClient.invalidateQueries({
    queryKey: getGetForumThreadQueryKey(threadId.value),
  })
}

// A moved thread leaves the reader where they were, on the thread: nothing about it has
// changed but where its breadcrumb points, and that redraws itself.
const movingThread = ref<boolean>(false)
const changingVisibility = ref<boolean>(false)

const reportedPost = ref<ListForumPosts200ResultsItem | undefined>(undefined)

const reportingPost = computed<boolean>({
  get: () => reportedPost.value !== undefined,
  set: (open) => {
    if (!open) reportedPost.value = undefined
  },
})
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <div v-if="threadPending" class="flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <template v-else-if="thread">
        <RouterLink
          :to="{ name: 'subForum', params: { subForumId: thread.subForumId } }"
          class="inline-flex items-center gap-1 text-[12.5px] text-ink-5 hover:text-oak-deep"
        >
          <ChevronLeft :size="14" :stroke-width="1.5" aria-hidden="true" />
          {{ thread.subForumTitle }}
        </RouterLink>

        <div class="mt-3 flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-h1">
              {{ thread.title }}
              <!-- Said once, next to the title, and only where it is not the ordinary case —
                   the same rule the sub-forum's own mark follows on the front page. -->
              <span
                v-if="restrictedForumLabel(thread.effectiveVisibility)"
                class="ml-2 align-middle text-[11.5px] text-ink-6"
              >
                {{ restrictedForumLabel(thread.effectiveVisibility) }}
              </span>
            </h1>
            <p class="mt-1 text-[12px] text-ink-6">
              von {{ thread.createdByUsername ?? 'einem gelöschten Konto' }},
              {{ formatActivityTime(thread.createdAt) }}
            </p>
          </div>

          <!-- Small and quiet, as on a profile: these are the operators' tools, not the page. -->
          <TooltipProvider v-if="mayModerate">
            <div class="flex flex-none items-center gap-1">
              <ModerationToolButton
                :icon="FolderInput"
                label="Thema verschieben"
                @click="movingThread = true"
              />
              <ModerationToolButton
                :icon="Eye"
                label="Sichtbarkeit des Themas"
                :active="thread.visibility !== null"
                @click="changingVisibility = true"
              />
            </div>
          </TooltipProvider>
        </div>

        <div v-if="isPending" class="mt-6 flex items-center gap-2 text-note text-ink-5">
          <Spinner />
          Einen Moment.
        </div>

        <!-- Posts are not boxed: recessed metadata and a hairline, as in a group thread. -->
        <div v-else class="mt-6 flex flex-col">
          <ForumPostItem
            v-for="(post, index) in posts"
            :key="post.id"
            :post="post"
            :first="index === 0"
            :divider="index < posts.length - 1"
            :current-user-id="currentUserId"
            :may-moderate="mayModerate"
            :editing="editingPostId === post.id"
            :saving="savingPost && editingPostId === post.id"
            :error="editingPostId === post.id ? editError : undefined"
            @report="reportedPost = post"
            @favourite-changed="refreshPosts"
            @edit="startEditing(post.id)"
            @cancel="stopEditing"
            @save="(edited, editedText) => saveEdit(post.id, edited, editedText)"
            @delete="deletingPost = post"
          />
        </div>

        <div v-if="totalResults > PAGE_SIZE" class="mt-7 border-t border-line-2 pt-3">
          <ListPagination v-model:page="page" :total="total" :items-per-page="itemsPerPage" />
        </div>

        <section v-if="signedIn" class="mt-8 border-t border-line-3 pt-6">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Antworten</h2>

          <Alert v-if="error" variant="destructive" role="alert" class="mt-3">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <PostEditor
            v-model:document="document"
            v-model:text="text"
            :disabled="isSending"
            framed
            class="mt-3"
          />

          <div class="mt-3">
            <Button :disabled="text.trim().length === 0 || isSending" @click="submit">
              <Spinner v-if="isSending" />
              Beitrag senden
            </Button>
          </div>
        </section>

        <p v-else class="mt-8 border-t border-line-3 pt-6 text-note text-ink-5">
          <RouterLink :to="{ name: 'login' }" class="text-oak-deep underline underline-offset-2"
            >Melde dich an</RouterLink
          >, um zu antworten.
        </p>
      </template>

      <template v-else>
        <h1 class="text-h1">Kein Thema gefunden</h1>
        <p class="mt-5 max-w-[60ch] text-note text-ink-5">
          Es gibt dieses Thema nicht, oder du darfst es nicht lesen.
        </p>
      </template>
    </div>
  </AppLayout>

  <MoveThreadDialog
    v-if="thread && mayModerate"
    v-model:open="movingThread"
    :thread-id="thread.id"
    :title="thread.title"
    :sub-forum-id="thread.subForumId"
    :visibility="thread.visibility"
  />

  <ThreadVisibilityDialog
    v-if="thread && mayModerate"
    v-model:open="changingVisibility"
    :thread-id="thread.id"
    :title="thread.title"
    :visibility="thread.visibility"
    :effective-visibility="thread.effectiveVisibility"
  />

  <ReportDialog
    v-if="reportedPost"
    v-model:open="reportingPost"
    target-type="forum_post"
    :target-id="reportedPost.id"
    :subject="reportedPost.createdByUsername ?? 'Gelöschtes Konto'"
  />

  <DeletePostDialog
    v-if="deletingPost"
    :open="deletingPost !== undefined"
    :author-name="deletingPostAuthor"
    :pending="removingPost"
    :error="deletePostError"
    @update:open="deletingPost = $event ? deletingPost : undefined"
    @confirmed="confirmDeletePost"
  />
</template>
