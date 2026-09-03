<script setup lang="ts">
/**
 * The fixed text pages — the rules, an FAQ — written by the administration rather than deployed.
 *
 * Plain Markdown in a textarea, not a rich-text editor: nothing else in this product takes
 * formatted input, and a stored document tree would tie every page to whichever editor made it.
 */
import { computed, ref } from 'vue'
import {
  getListCustomPagesQueryKey,
  readCustomPage,
  useDeleteCustomPage,
  useListCustomPages,
  useWriteCustomPage,
} from '@/api/custom-pages/custom-pages'
import type { ListPages200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'

/**
 * `TEXT_LIMIT` is generated from the request *bodies*, and the slug is a path parameter, so it
 * is not there. Matches `TEXT_LIMIT.customPageSlug` in the backend.
 */
const SLUG_MAX_LENGTH = 80

const { data, isPending } = useListCustomPages()

const pages = computed<ListPages200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const editing = ref<boolean>(false)
/** Empty while writing a new page; set to the slug being rewritten, which cannot be changed. */
const editingSlug = ref<string | undefined>(undefined)
const slug = ref<string>('')
const title = ref<string>('')
const body = ref<string>('')
const isPublic = ref<boolean>(false)
const error = ref<string | undefined>(undefined)

const { mutateAsync: write, isPending: isSaving } = useWriteCustomPage()
const { mutateAsync: remove, isPending: isDeleting } = useDeleteCustomPage()

function startNew() {
  editing.value = true
  editingSlug.value = undefined
  slug.value = ''
  title.value = ''
  body.value = ''
  isPublic.value = false
  error.value = undefined
}

async function startEdit(page: ListPages200Item) {
  error.value = undefined

  // The list carries no body — a list of pages is read to pick one from — so the page itself
  // is fetched before it can be edited.
  const answer = await readCustomPage(page.slug)

  if (answer.status !== 200) {
    error.value = 'Diese Seite konnte nicht geladen werden.'
    return
  }

  editing.value = true
  editingSlug.value = page.slug
  slug.value = page.slug
  title.value = answer.data.title
  body.value = answer.data.body
  isPublic.value = answer.data.isPublic
}

async function save() {
  error.value = undefined

  try {
    await write({
      slug: slug.value.trim(),
      data: { title: title.value.trim(), body: body.value.trim(), isPublic: isPublic.value },
    })
  } catch {
    error.value =
      'Das hat nicht geklappt. Der Pfad darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
    return
  }

  editing.value = false
  await queryClient.invalidateQueries({ queryKey: getListCustomPagesQueryKey() })
}

async function deleteOne(customPageSlug: string) {
  error.value = undefined

  try {
    await remove({ slug: customPageSlug })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListCustomPagesQueryKey() })
}

const isComplete = computed<boolean>(
  () =>
    slug.value.trim().length > 0 && title.value.trim().length > 0 && body.value.trim().length > 0,
)
</script>

<template>
  <ModerationPage
    title="Eigene Seiten"
    description="Regelwerk, FAQ und andere feste Textseiten. Geschrieben wird in Markdown — dieselbe einfache Textform, die das Projekt überall sonst auch nutzt."
  >
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <div>
        <Button variant="outline" size="sm" @click="startNew">Seite anlegen</Button>
      </div>

      <p v-if="pages.length === 0" class="mt-4 text-note text-ink-5">Es gibt noch keine Seite.</p>

      <ul v-else class="mt-4 flex flex-col">
        <li
          v-for="page in pages"
          :key="page.slug"
          class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-row text-ink-2">{{ page.title }}</p>
            <span class="flex flex-wrap gap-2">
              <Button variant="ghost" size="xs" @click="startEdit(page)">Bearbeiten</Button>
              <Button
                variant="ghost"
                size="xs"
                :disabled="isDeleting"
                @click="deleteOne(page.slug)"
              >
                Löschen
              </Button>
            </span>
          </div>
          <p class="mt-1 font-mono text-[12px] text-ink-5">/{{ page.slug }}</p>
          <p class="mt-1 text-[12px] text-ink-6">
            {{ page.isPublic ? 'Öffentlich lesbar' : 'Nur für Mitglieder' }}
            <template v-if="page.lastEditedBy">
              · zuletzt von {{ page.lastEditedBy.username }},
              {{ formatActivityTime(page.updatedAt) }}
            </template>
          </p>
        </li>
      </ul>

      <form
        v-if="editing"
        class="mt-8 flex max-w-[60ch] flex-col gap-4 border-t border-line-3 pt-6"
        @submit.prevent="save"
      >
        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Pfad</span>
          <Input
            v-model="slug"
            :maxlength="SLUG_MAX_LENGTH"
            :disabled="editingSlug !== undefined"
            aria-label="Pfad"
            placeholder="regelwerk"
            autocapitalize="none"
            spellcheck="false"
          />
          <p class="text-[12px] text-ink-6">
            <template v-if="editingSlug === undefined">
              Die Adresse der Seite, etwa „regelwerk". Sie lässt sich später nicht mehr ändern — ein
              anderer Pfad ist eine andere Seite.
            </template>
            <template v-else>Der Pfad einer bestehenden Seite bleibt, wie er ist.</template>
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Titel</span>
          <Input
            v-model="title"
            :maxlength="TEXT_LIMIT.writeCustomPage.title.maxLength"
            aria-label="Titel"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[12.5px] text-ink-4">Inhalt</span>
          <Textarea
            v-model="body"
            :maxlength="TEXT_LIMIT.writeCustomPage.body.maxLength"
            aria-label="Inhalt"
            rows="16"
          />
        </div>

        <label class="flex items-center gap-2 text-[12.5px] text-ink-4">
          <input v-model="isPublic" type="checkbox" class="size-4" />
          Auch ohne Konto lesbar
        </label>

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
