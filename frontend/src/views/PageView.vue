<script setup lang="ts">
/**
 * A page the administration writes: the rules, an FAQ, the Blind-Date regulations.
 *
 * The half that was missing. Pages could be written in the moderation area since they shipped, and
 * `GET /api/pages/{slug}` has always served them — there was simply nowhere for a member to read
 * one, so every link to one pointed into nothing.
 *
 * **The body is plain text**, because that is what the editor beside it is: a textarea. It is
 * rendered with its line breaks kept and nothing else interpreted — no markdown, no HTML. Somebody
 * typing `<b>` into the administration form should see `<b>`, not bold text, and certainly not a
 * tag the browser acts on.
 *
 * `access: 'anyone'`, because a page may be public and which ones are is the data's own business:
 * the API answers 404 for a private page read without a session, so the guard here must not refuse
 * first.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useReadPage } from '@/api/pages/pages'
import { formatActivityTime } from '@/lib/format/formatTime'
import AppLayout from '@/components/layout/AppLayout.vue'
import { Spinner } from '@/components/ui/spinner'

const route = useRoute()
const slug = computed<string>(() => String(route.params.slug))

const { data, isPending } = useReadPage(slug)

const page = computed(() => (data.value?.status === 200 ? data.value.data : undefined))
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
        <Spinner />
        Einen Moment.
      </div>

      <template v-else-if="page">
        <h1 class="text-h1">{{ page.title }}</h1>

        <!-- `whitespace-pre-line` keeps the paragraphs the writer typed and nothing more. The
             body is interpolated, never `v-html`: a page is written by an administrator, but a
             text field that renders markup is a hole waiting for the day somebody pastes into
             it. -->
        <div class="mt-5 max-w-[70ch] text-body leading-[1.7] whitespace-pre-line text-ink-3">
          {{ page.body }}
        </div>

        <p class="mt-8 border-t border-line-2 pt-3 text-[12px] text-ink-6">
          Zuletzt geändert {{ formatActivityTime(page.updatedAt) }}
          <template v-if="page.lastEditedBy">von {{ page.lastEditedBy.username }}</template>
        </p>
      </template>

      <template v-else>
        <h1 class="text-h1">Seite nicht gefunden</h1>
        <p class="mt-5 max-w-[60ch] text-note text-ink-5">
          Diese Seite gibt es nicht, oder sie ist nicht öffentlich. Melde dich an, falls du ein
          Konto hast.
        </p>
      </template>
    </div>
  </AppLayout>
</template>
