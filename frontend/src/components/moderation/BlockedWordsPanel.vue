<script setup lang="ts">
/**
 * The words the community does not print. Administrator-only, beside the domain list and for the
 * same reason: this decides what everybody may print, not what happens to one account.
 *
 * **Nothing here changes what anybody wrote.** The word is hidden when text is read, so taking one
 * off the list makes every older text readable again exactly as written, and adding one hides it
 * everywhere at once without a single post being edited. The panel says so, because somebody
 * deciding whether to add a word needs to know it is reversible.
 *
 * The other thing it says out loud is that the match is a substring. That is what catches German
 * compounds — „Arschgeweih" would otherwise print in full — and it is also the trap: a short entry
 * masks the middle of innocent words. Whoever types the word is the only one who can judge that,
 * so the warning belongs beside the field rather than in a comment.
 */
import { computed, ref } from 'vue'
import {
  getListBlockedWordsQueryKey,
  useBlockWord,
  useListBlockedWords,
  useUnblockWord,
} from '@/api/moderation/moderation'
import type { ListBlockedWords200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBlockedWords()

const words = computed<ListBlockedWords200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const word = ref<string>('')
const note = ref<string>('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: block, isPending: isBlocking } = useBlockWord()
const { mutateAsync: unblock, isPending: isUnblocking } = useUnblockWord()

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListBlockedWordsQueryKey() })
}

async function add() {
  const value = word.value.trim().toLowerCase()
  if (value.length < 2) return

  error.value = undefined

  try {
    await block({
      data: { word: value, ...(note.value.trim() === '' ? {} : { note: note.value.trim() }) },
    })
  } catch {
    error.value = 'Das hat nicht geklappt. Ein Wort braucht mindestens zwei Zeichen.'
    return
  }

  word.value = ''
  note.value = ''
  await refresh()
}

async function remove(value: string) {
  error.value = undefined

  try {
    await unblock({ word: value })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Diese Wörter werden überall dort, wo sie in geschriebenen Texten auftauchen, als
      <span class="font-mono">***</span> angezeigt — in Beiträgen, Statusmeldungen, Nachrichten und
      Profiltexten.
    </p>

    <!-- The two facts somebody needs before they type: that it is reversible, and that it matches
         inside words. Both are consequences of the design rather than warnings about bugs. -->
    <p class="mt-2 max-w-[70ch] text-[12.5px] leading-[1.5] text-ink-5">
      Der ursprüngliche Text bleibt unverändert gespeichert. Ein Wort von der Liste zu nehmen macht
      alle älteren Texte wieder normal lesbar; ein neues Wort wirkt sofort auch rückwirkend.
      Verglichen wird <strong class="font-medium text-ink-4">auch innerhalb von Wörtern</strong> —
      das erwischt zusammengesetzte Wörter, trifft bei kurzen Einträgen aber auch harmlose.
    </p>

    <form class="mt-4 flex flex-wrap items-center gap-2" @submit.prevent="add">
      <Input
        v-model="word"
        aria-label="Wort"
        placeholder="Wort"
        :maxlength="TEXT_LIMIT.blockWord.word.maxLength"
        autocapitalize="none"
        spellcheck="false"
        class="w-full sm:w-[220px]"
      />
      <Input
        v-model="note"
        :maxlength="TEXT_LIMIT.blockWord.note.maxLength"
        aria-label="Notiz, optional"
        placeholder="Notiz, optional"
        class="w-full sm:w-[320px]"
      />
      <Button type="submit" variant="outline" size="sm" :disabled="isBlocking">
        Auf die Liste
      </Button>
    </form>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>

    <div v-if="isPending" class="mt-4 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="words.length === 0" class="mt-4 text-note text-ink-5">
      Die Liste ist leer. Was daraufgehört, entscheidet ihr — vorbelegt wird hier nichts.
    </p>

    <ul v-else class="mt-4 flex flex-col">
      <li
        v-for="entry in words"
        :key="entry.word"
        class="border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="font-mono text-row text-ink-2">{{ entry.word }}</p>
          <Button variant="ghost" size="xs" :disabled="isUnblocking" @click="remove(entry.word)">
            Von der Liste nehmen
          </Button>
        </div>
        <p v-if="entry.note" class="mt-1 text-[12.5px] text-ink-4">{{ entry.note }}</p>
        <p class="mt-1 text-[12px] text-ink-6">
          {{ entry.addedBy?.username ?? 'ein gelöschtes Konto' }},
          {{ formatActivityTime(entry.addedAt) }}
        </p>
      </li>
    </ul>
  </div>
</template>
