<script setup lang="ts">
/**
 * One sub-forum: what it is for, and the threads in it.
 *
 * A thread the reader may not see is absent and is not counted — the API decides that, and there
 * is no "hidden" state to render here. Opening a thread needs a session even where reading needs
 * none, which is what the sign-in line at the foot says.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getListForumThreadsQueryKey, useListForumThreads } from '@/api/forum/forum'
import { useGetCurrentUser } from '@/api/auth/auth'
import type { ListForumThreads200ThreadsResultsItem, ListForumThreadsBody } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { listKeyPrefix } from '@/lib/api/queryKeys'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import { usePagedList } from '@/composables/usePagedList'
import { ChevronLeft } from '@lucide/vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import ListPagination from '@/components/common/ListPagination.vue'
import NewForumThreadDialog from '@/components/forum/NewForumThreadDialog.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const PAGE_SIZE = 20

const route = useRoute()
const subForumId = computed<string>(() => String(route.params.subForumId))

const { data: currentUserData } = useGetCurrentUser()
const signedIn = computed<boolean>(() => currentUserData.value?.status === 200)

const { page, offset, total, itemsPerPage, goToPage } = usePagedList(
  PAGE_SIZE,
  () => totalResults.value,
)

const body = computed<ListForumThreadsBody>(() => ({
  limit: PAGE_SIZE,
  offset: offset.value,
  sortAttribute: 'lastActivityAt',
  sortOrder: 'desc',
}))

const { data, isPending } = useListForumThreads(subForumId, body)

const subForum = computed(() => (data.value?.status === 200 ? data.value.data.subForum : undefined))

const threads = computed<ListForumThreads200ThreadsResultsItem[]>(() =>
  data.value?.status === 200 ? data.value.data.threads.results : [],
)

const totalResults = computed<number>(() =>
  data.value?.status === 200 ? data.value.data.threads.totalResults : 0,
)

// A different sub-forum is a different list, so whatever page was open is about another set.
watch(subForumId, () => goToPage(1))

const opening = ref<boolean>(false)

async function refresh() {
  await queryClient.invalidateQueries({
    queryKey: listKeyPrefix(getListForumThreadsQueryKey(subForumId.value, body.value)),
  })
}
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <RouterLink
        :to="{ name: 'forum' }"
        class="inline-flex items-center gap-1 text-[12.5px] text-ink-5 hover:text-oak-deep"
      >
        <ChevronLeft :size="14" :stroke-width="1.5" aria-hidden="true" />
        Forum
      </RouterLink>

      <div v-if="isPending" class="mt-6 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <template v-else-if="subForum">
        <div class="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p class="text-[12px] text-ink-6">{{ subForum.categoryTitle }}</p>
            <h1 class="mt-0.5 text-h1">{{ subForum.title }}</h1>
          </div>
          <Button v-if="signedIn" variant="outline" size="sm" @click="opening = true">
            Thema eröffnen
          </Button>
        </div>

        <p class="mt-2 max-w-[70ch] text-body text-ink-4">{{ subForum.description }}</p>

        <p v-if="!signedIn" class="mt-3 text-note text-ink-5">
          Du liest gerade ohne Konto.
          <RouterLink :to="{ name: 'login' }" class="text-oak-deep underline underline-offset-2"
            >Melde dich an</RouterLink
          >, um mitzuschreiben.
        </p>

        <p v-if="threads.length === 0" class="mt-8 text-note text-ink-5">
          Hier ist noch kein Thema eröffnet.
          <template v-if="signedIn">Sei die erste Person.</template>
        </p>

        <ul v-else class="mt-6 flex flex-col gap-2.5">
          <li
            v-for="thread in threads"
            :key="thread.id"
            class="rounded-lg border border-line-3 bg-paper-0 p-4 shadow-card"
          >
            <RouterLink
              :to="{ name: 'forumThread', params: { threadId: thread.id } }"
              class="text-h2 text-ink-1 underline-offset-[6px] hover:underline"
            >
              {{ thread.title }}
            </RouterLink>
            <p class="mt-1 text-[12px] text-ink-6">
              von {{ thread.createdByUsername ?? 'einem gelöschten Konto' }} ·
              {{ formatCount(thread.posts) }} Beiträge · zuletzt
              {{ formatActivityTime(thread.lastActivityAt) }}
            </p>
          </li>
        </ul>

        <div v-if="totalResults > PAGE_SIZE" class="mt-7 border-t border-line-2 pt-3">
          <ListPagination v-model:page="page" :total="total" :items-per-page="itemsPerPage" />
        </div>

        <NewForumThreadDialog
          v-model:open="opening"
          :sub-forum-id="subForum.id"
          @opened="refresh"
        />
      </template>

      <template v-else>
        <h1 class="mt-3 text-h1">Kein Forenabteil gefunden</h1>
        <p class="mt-5 max-w-[60ch] text-note text-ink-5">
          Es gibt dieses Abteil nicht, oder du darfst es nicht lesen.
        </p>
      </template>
    </div>
  </AppLayout>
</template>
