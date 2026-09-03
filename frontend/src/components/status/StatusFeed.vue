<script setup lang="ts">
/**
 * Statusmeldungen auf der eingeloggten Startseite, angelehnt an Yoocos LiNet-Status. Feste Höhe
 * mit eigenem Scrollbereich, weil diese Box neben anderen Startseiten-Boxen (Gruppen o.ä.) steht
 * und nicht unterschiedlich lang neben ihnen enden soll — dasselbe Argument wie bei den alten
 * Yooco-Boxen mit fester Höhe.
 */
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import {
  createStatusUpdate,
  createStatusUpdateComment,
  listStatusUpdateComments,
  listStatusUpdates,
} from '@/api/status-updates/status-updates'
import type {
  ListStatusUpdateComments200ResultsItem,
  ListStatusUpdates200ResultsItem,
} from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { formatActivityTime } from '@/lib/format/formatTime'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type FeedItem = ListStatusUpdates200ResultsItem & {
  // Nur clientseitiger Zustand, kommt nicht vom Server:
  open?: boolean
  comments?: ListStatusUpdateComments200ResultsItem[]
  loadingComments?: boolean
  showAllComments?: boolean
}

/** Wie viele Kommentare vor dem Aufklappen sichtbar sind, und wie viele danach ungekürzt bleiben. */
const PREVIEW_COUNT = 3
const PAGE_SIZE = 20

const updates = ref<FeedItem[]>([])
const isPending = ref<boolean>(true)
const isError = ref<boolean>(false)

async function loadFeed() {
  isPending.value = true
  isError.value = false
  try {
    const page = await listStatusUpdates({ limit: PAGE_SIZE })
    if (page.status === 200) {
      updates.value = page.data.results
    } else {
      isError.value = true
    }
  } catch {
    isError.value = true
  } finally {
    isPending.value = false
  }
}

const draft = ref<string>('')
const posting = ref<boolean>(false)
const postError = ref<boolean>(false)

async function submitStatusUpdate() {
  const body = draft.value.trim()
  if (!body || posting.value) {
    return
  }

  posting.value = true
  postError.value = false
  try {
    const created = await createStatusUpdate({ body })
    if (created.status === 201) {
      updates.value = [created.data, ...updates.value]
      draft.value = ''
    } else {
      postError.value = true
    }
  } catch {
    postError.value = true
  } finally {
    posting.value = false
  }
}

async function toggleComments(update: FeedItem) {
  update.open = !update.open
  if (!update.open || update.comments !== undefined) {
    return
  }

  update.loadingComments = true
  try {
    const page = await listStatusUpdateComments(update.id)
    update.comments = page.status === 200 ? page.data.results : []
  } finally {
    update.loadingComments = false
  }
}

async function submitComment(update: FeedItem, input: HTMLInputElement) {
  const body = input.value.trim()
  if (!body) {
    return
  }

  const created = await createStatusUpdateComment(update.id, { body })
  if (created.status !== 201) {
    return
  }

  update.comments = [...(update.comments ?? []), created.data]
  update.commentCount += 1
  input.value = ''
}

function submitCommentOnEnter(update: FeedItem, event: KeyboardEvent) {
  void submitComment(update, event.target as HTMLInputElement)
}

onMounted(loadFeed)
</script>

<template>
  <div class="rounded-xl border border-line-3 bg-paper-2 p-3">
    <div class="mb-2.5 flex items-center gap-2">
      <Input
        v-model="draft"
        placeholder="Was gibt's Neues?"
        class="h-8 text-sm"
        :maxlength="TEXT_LIMIT.createStatusUpdate.body.maxLength"
        @keydown.enter="submitStatusUpdate"
      />
      <Button size="sm" :disabled="posting || !draft.trim()" @click="submitStatusUpdate">
        <Spinner v-if="posting" />
        Posten
      </Button>
    </div>

    <p v-if="postError" class="mb-2 text-[11.5px] text-destructive">
      Die Meldung wurde nicht gespeichert. Versuche es noch einmal.
    </p>

    <!-- Feste Höhe + eigener Scrollbereich: absichtlich, siehe Kommentar oben. -->
    <div class="h-64 space-y-1.5 overflow-y-auto pr-3">
      <p v-if="isPending" class="text-[12.5px] text-ink-5">Wird geladen …</p>

      <p v-else-if="isError" class="text-[12.5px] text-ink-5">
        Die Statusmeldungen lassen sich gerade nicht laden.
      </p>

      <p v-else-if="updates.length === 0" class="text-[12.5px] text-ink-5">
        Noch keine Statusmeldungen. Schreib die erste.
      </p>

      <div
        v-for="update in updates"
        :key="update.id"
        class="rounded-lg border border-line-3 bg-paper-0 px-3 py-2 shadow-card"
      >
        <div class="flex items-start gap-2">
          <RouterLink :to="{ name: 'member', params: { userId: update.createdBy } }">
            <UserAvatar :username="update.createdByUsername" />
          </RouterLink>
          <div class="min-w-0 flex-1">
            <p class="text-xs">
              <RouterLink
                :to="{ name: 'member', params: { userId: update.createdBy } }"
                class="font-medium text-ink-2 hover:underline"
              >
                {{ update.createdByUsername }}
              </RouterLink>
              <span class="text-ink-4"> · </span>
              <span class="text-ink-3">{{ formatActivityTime(update.createdAt) }}</span>
            </p>
            <p class="text-sm leading-snug whitespace-pre-wrap text-ink-2">{{ update.body }}</p>
          </div>
          <button
            type="button"
            class="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5"
            @click="toggleComments(update)"
          >
            <svg
              class="size-3.5 text-oak-deep"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path
                d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
              />
            </svg>
            <span class="text-[11.5px] font-medium text-ink-3">{{ update.commentCount }}</span>
          </button>
        </div>

        <div v-if="update.open" class="mt-2 ml-9 border-t border-line-4 pt-2">
          <p v-if="update.loadingComments" class="text-[11.5px] text-ink-5">Wird geladen …</p>

          <template v-else-if="update.comments">
            <button
              v-if="!update.showAllComments && update.comments.length > PREVIEW_COUNT"
              type="button"
              class="mb-1.5 block text-xs font-medium text-oak-deep"
              @click="update.showAllComments = true"
            >
              {{ update.comments.length - PREVIEW_COUNT }} weitere Kommentare anzeigen
            </button>

            <div
              :class="[
                update.showAllComments && update.comments.length > 6
                  ? 'max-h-40 overflow-y-auto pr-1'
                  : '',
              ]"
            >
              <div
                v-for="comment in update.showAllComments
                  ? update.comments
                  : update.comments.slice(-PREVIEW_COUNT)"
                :key="comment.id"
                class="mb-1.5 flex items-start gap-1.5"
              >
                <RouterLink :to="{ name: 'member', params: { userId: comment.createdBy } }">
                  <UserAvatar :username="comment.createdByUsername" class="size-5" />
                </RouterLink>
                <p class="text-xs leading-snug text-ink-3">
                  <RouterLink
                    :to="{ name: 'member', params: { userId: comment.createdBy } }"
                    class="font-medium text-ink-2 hover:underline"
                  >
                    {{ comment.createdByUsername }}
                  </RouterLink>
                  {{ comment.body }}
                  <span class="text-ink-4">· {{ formatActivityTime(comment.createdAt) }}</span>
                </p>
              </div>
            </div>
          </template>

          <Input
            type="text"
            placeholder="Kommentieren …"
            class="mt-1 h-7 text-xs"
            :maxlength="TEXT_LIMIT.createStatusUpdateComment.body.maxLength"
            @keydown.enter="submitCommentOnEnter(update, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
