<script setup lang="ts">
/**
 * The forum's front page: categories as headings, the sub-forums under them as the rows people
 * actually open, and what the footer of the original called „Statistik".
 *
 * Everything here is already filtered by the API to what this reader may see — a sub-forum they
 * may not read is absent rather than shown as refused, and a category left with nothing in it
 * does not appear at all. There is deliberately no "you may not see this" state to render.
 *
 * Readable without an account, which is why the page copes with there being no session: the
 * layout leaves its top bar out, and the sign-in link takes its place.
 */
import { computed } from 'vue'
import { useGetForumOverview } from '@/api/forum/forum'
import { useGetCurrentUser } from '@/api/auth/auth'
import type {
  GetForumOverview200CategoriesItem,
  GetForumOverview200CategoriesItemSubForumsItem,
} from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import { restrictedForumLabel } from '@/lib/format/forumVisibility'
import { MessagesSquare } from '@lucide/vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useGetForumOverview()
const { data: currentUserData } = useGetCurrentUser()

const signedIn = computed<boolean>(() => currentUserData.value?.status === 200)

const categories = computed<GetForumOverview200CategoriesItem[]>(() =>
  data.value?.status === 200 ? data.value.data.categories : [],
)

const totalThreads = computed<number>(() =>
  data.value?.status === 200 ? data.value.data.totalThreads : 0,
)

const totalPosts = computed<number>(() =>
  data.value?.status === 200 ? data.value.data.totalPosts : 0,
)

/**
 * Which sub-forums are open to somebody without an account. Shown only to a reader who has one,
 * and only where it differs from the ordinary case — a badge on every row would be noise.
 */
function isPublic(subForum: GetForumOverview200CategoriesItemSubForumsItem): boolean {
  return subForum.visibility === 'everyone'
}
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <h1 class="text-h1">Forum</h1>
      <p class="mt-2 max-w-[60ch] text-body text-ink-4">
        Was hier besprochen wird, steht offen — anders als in den Schreibgruppen, die privat sind.
      </p>

      <p v-if="!signedIn && !isPending" class="mt-3 text-note text-ink-5">
        Du liest gerade ohne Konto.
        <RouterLink :to="{ name: 'login' }" class="text-oak-deep underline underline-offset-2"
          >Melde dich an</RouterLink
        >, um alles zu sehen und mitzuschreiben.
      </p>

      <div v-if="isPending" class="mt-6 flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <p v-else-if="categories.length === 0" class="mt-6 max-w-[60ch] text-note text-ink-5">
        <template v-if="signedIn">
          Es gibt noch keine Foren-Abteile. Die Administration legt sie an.
        </template>
        <template v-else>
          Ohne Konto ist hier zurzeit nichts zu lesen. Melde dich an, um das Forum zu sehen.
        </template>
      </p>

      <template v-else>
        <section v-for="category in categories" :key="category.id" class="mt-8">
          <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
            {{ category.title }}
          </h2>

          <!-- The original drew this as a table with THEMEN / BEITRÄGE / LETZTER BEITRAG columns.
               Here each sub-forum is a card, and the three numbers sit as a line under the
               description — a table of four columns does not survive a 375px screen, and the
               counts are read far less often than the title they belong to. -->
          <ul class="mt-3 flex flex-col gap-2.5">
            <li
              v-for="subForum in category.subForums"
              :key="subForum.id"
              class="rounded-lg border border-line-3 bg-paper-0 p-4 shadow-card"
            >
              <div class="flex items-start gap-3">
                <span
                  class="mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg bg-paper-3 text-oak-deep"
                >
                  <MessagesSquare :size="16" :stroke-width="1.5" aria-hidden="true" />
                </span>

                <div class="min-w-0 flex-1">
                  <p class="text-h2 text-ink-1">
                    <RouterLink
                      :to="{ name: 'subForum', params: { subForumId: subForum.id } }"
                      class="text-ink-1 underline-offset-[6px] hover:underline"
                    >
                      {{ subForum.title }}
                    </RouterLink>
                    <!-- Said once, next to the title, and only where it is not the ordinary
                         case — the same rule the group privacy mark follows. -->
                    <span
                      v-if="restrictedForumLabel(subForum.visibility)"
                      class="ml-2 align-middle text-[11.5px] text-ink-6"
                    >
                      {{ restrictedForumLabel(subForum.visibility) }}
                    </span>
                    <span
                      v-else-if="signedIn && isPublic(subForum)"
                      class="ml-2 align-middle text-[11.5px] text-ink-6"
                    >
                      Auch ohne Konto lesbar
                    </span>
                  </p>

                  <p class="mt-1 max-w-[70ch] text-note text-ink-4">{{ subForum.description }}</p>

                  <p class="mt-2 text-[12px] text-ink-6">
                    {{ formatCount(subForum.threads) }} Themen ·
                    {{ formatCount(subForum.posts) }} Beiträge
                    <!-- Absent where nothing has been written that this reader may see. The
                         original showed a last post beside "0 Themen, 0 Beiträge", which cannot
                         both be true; here the two come from the same filter. -->
                    <template v-if="subForum.lastPost">
                      · zuletzt
                      {{ subForum.lastPost.createdByUsername ?? 'ein gelöschtes Konto' }},
                      {{ formatActivityTime(subForum.lastPost.createdAt) }}
                    </template>
                  </p>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <p class="mt-10 border-t border-line-3 pt-4 text-[12.5px] text-ink-5">
          Themen insgesamt: {{ formatCount(totalThreads) }} · Beiträge insgesamt:
          {{ formatCount(totalPosts) }}
        </p>
      </template>
    </div>
  </AppLayout>
</template>
