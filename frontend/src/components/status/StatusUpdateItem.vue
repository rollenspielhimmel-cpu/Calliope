<script setup lang="ts">
/**
 * Eine Statusmeldung mit ihren Kommentaren.
 *
 * **Eine Komponente für zwei Orte.** Derselbe Eintrag steht im Kasten auf der Startseite und auf
 * der Seite mit allen Meldungen; was sich unterscheidet, ist der Platz, nicht der Inhalt. Also
 * entscheidet `layout` über drei Kleinigkeiten — ob die Uhrzeit zur Seite führt, ob Kommentare
 * erst in einer Vorschau stehen, und wie viele Zeilen ein Text bekommt, bevor er gekürzt wird —,
 * und alles andere ist geteilt.
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  createStatusUpdateComment,
  useListStatusUpdateComments,
} from '@/api/status-updates/status-updates'
import type {
  ListStatusUpdateComments200ResultsItem,
  ListStatusUpdates200ResultsItem,
} from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { formatActivityTime } from '@/lib/format/formatTime'
import { cutAtWord, ELLIPSIS } from '@/lib/text/shortenToFit'
import { useRefreshStatusUpdates } from '@/composables/useStatusUpdates'
import StatusBody from '@/components/status/StatusBody.vue'
import UserAvatar from '@/components/user/UserAvatar.vue'
import { Input } from '@/components/ui/input'

const props = withDefaults(
  defineProps<{
    update: ListStatusUpdates200ResultsItem
    /** `box` ist der Kasten auf der Startseite, `page` die Seite mit allen Meldungen. */
    layout?: 'box' | 'page'
    /** Aufgeklappt ankommen — für die Meldung, auf die ein Verweis von der Startseite zeigt. */
    openAtOnce?: boolean
  }>(),
  { layout: 'box', openAtOnce: false },
)

/**
 * Wie viele Kommentare im Kasten vor dem Aufklappen sichtbar sind.
 *
 * Nur dort: Auf der Seite ist Platz, und ein Zwischenschritt, der nichts spart, ist ein Klick zu
 * viel. Im Kasten schiebt ein Strang mit achtzig Kommentaren sonst alle anderen Meldungen aus dem
 * Blick — genau das, wogegen die Kürzung der langen Meldungen gebaut ist.
 */
const PREVIEW_COUNT = 3

const open = ref<boolean>(props.openAtOnce)
const showAllComments = ref<boolean>(props.layout === 'page')

const commentsQuery = useListStatusUpdateComments(
  () => props.update.id,
  // Erst fragen, wenn jemand hinsieht. Auf der Seite stehen zwanzig Meldungen; sie alle beim
  // Laden zu befragen wären zwanzig Anfragen für etwas, das die meisten nie aufklappen.
  { query: { enabled: open } },
)

const comments = computed<ListStatusUpdateComments200ResultsItem[]>(() => {
  const answer = commentsQuery.data.value
  return answer?.status === 200 ? answer.data.results : []
})

const visibleComments = computed<ListStatusUpdateComments200ResultsItem[]>(() =>
  showAllComments.value ? comments.value : comments.value.slice(-PREVIEW_COUNT),
)

function toggleComments() {
  open.value = !open.value
}

/**
 * Wie viel von einem zitierten Kommentar mitkommt.
 *
 * Ein Kommentar steht hier auf einer Zeile, und das Zitat gehört mit auf diese Zeile — genug, um zu
 * erkennen, worauf sich jemand bezieht, und kurz genug, dass die eigene Antwort noch der Hauptteil
 * bleibt. Wer den ganzen Kommentar wiederholen will, steht ohnehin direkt darüber.
 */
const QUOTE_LENGTH = 60

const draft = ref<string>('')
const commentField = ref<HTMLInputElement | undefined>(undefined)

/**
 * `Input` ist eine Komponente, keine Eingabezeile — ein Vorlagenverweis darauf liefert die Instanz.
 * Ihr Wurzelelement *ist* die Eingabezeile, also wird hier beides angenommen und das Verwertbare
 * behalten.
 */
function setCommentField(element: unknown) {
  const node =
    element instanceof HTMLInputElement ? element : (element as { $el?: unknown } | null)?.$el

  commentField.value = node instanceof HTMLInputElement ? node : undefined
}

/**
 * Setzt einen Bezug auf einen Kommentar in das Feld.
 *
 * **Als Text, nicht als Verweis** — vorerst: Der Kommentar bleibt eine Zeile, und es braucht keine
 * Spalte in der Datenbank. Der Preis steht dazu: Ändert jemand seinen Kommentar nachträglich,
 * ändert sich das Zitat nicht mit, und der Name lässt sich nicht verlinken. Beides ist der Grund,
 * warum daraus ein echter Bezug wird — Schritt 3 des Umbaus.
 *
 * Vorangestellt statt angehängt: Wer schon etwas getippt hat, meint meistens die Antwort, und die
 * gehört hinter das Zitat.
 */
function quoteComment(comment: ListStatusUpdateComments200ResultsItem) {
  const shortened = cutAtWord(comment.body, QUOTE_LENGTH)
  const quoted = shortened === comment.body ? shortened : shortened + ELLIPSIS

  draft.value = `@${comment.createdByUsername}: „${quoted}" ${draft.value.trim()}`.trimEnd() + ' '

  void nextTick(() => {
    commentField.value?.focus()
    // Ans Ende, nicht an den Anfang: Dort schreibt man weiter.
    const end = commentField.value?.value.length ?? 0
    commentField.value?.setSelectionRange(end, end)
  })
}

const refreshStatusUpdates = useRefreshStatusUpdates()
const sending = ref<boolean>(false)

async function submitComment() {
  const body = draft.value.trim()
  if (body === '' || sending.value) {
    return
  }

  sending.value = true
  try {
    const created = await createStatusUpdateComment(props.update.id, { body })
    if (created.status !== 201) {
      return
    }

    // Erst nach der Zusage geleert: Schlägt das Absenden fehl, steht der Text noch da und ist
    // nicht verloren.
    draft.value = ''
    // Die Liste mit, nicht nur die Kommentare: Die Zahl am Sprechblasen-Knopf kommt von dort, und
    // sie steht an beiden Orten.
    await Promise.all([commentsQuery.refetch(), refreshStatusUpdates()])
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div
    :id="update.id"
    class="rounded-lg border border-line-3 bg-paper-0 px-3 py-2 shadow-card"
    :class="layout === 'page' ? 'px-4 py-3' : ''"
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
          <!-- Die Uhrzeit trägt den Weg zur Seite: die Stelle, an der bei uns ohnehin das
               Nebensächliche steht, und ein Knopf weniger in einem engen Kasten. -->
          <RouterLink
            v-if="layout === 'box'"
            :to="{ name: 'statusUpdates', hash: `#${update.id}` }"
            class="text-ink-3 hover:text-oak-deep hover:underline"
          >
            {{ formatActivityTime(update.createdAt) }}
          </RouterLink>
          <span v-else class="text-ink-3">{{ formatActivityTime(update.createdAt) }}</span>
        </p>
        <StatusBody :text="update.body" :lines="layout === 'page' ? 8 : 4" />
      </div>
      <button
        type="button"
        class="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5"
        @click="toggleComments"
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

    <div v-if="open" class="mt-2 ml-9 border-t border-line-4 pt-2">
      <p v-if="commentsQuery.isPending.value" class="text-[11.5px] text-ink-5">Wird geladen …</p>

      <template v-else>
        <button
          v-if="!showAllComments && comments.length > PREVIEW_COUNT"
          type="button"
          class="mb-1.5 block text-xs font-medium text-oak-deep"
          @click="showAllComments = true"
        >
          {{ comments.length - PREVIEW_COUNT }} weitere Kommentare anzeigen
        </button>

        <!-- Kein eigener Scrollbereich mehr. Er saß in einem Kasten, der selbst scrollt, und
             zeigte vier Kommentare durch ein Guckloch von 160 Pixeln — zwei Balken ineinander.
             Jetzt wird an einer Stelle gescrollt. -->
        <div
          v-for="comment in visibleComments"
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
            <!-- In derselben zurückgenommenen Zeile wie die Uhrzeit: eine Handlung, kein
                 Angebot, das sich vordrängt. Ein roher Knopf, weil diese Zeile Text ist und
                 keine Knopfleiste. -->
            <button
              type="button"
              class="text-ink-4 hover:text-oak-deep"
              @click="quoteComment(comment)"
            >
              · Zitieren
            </button>
          </p>
        </div>
      </template>

      <!-- `v-model` statt eines Griffs ans DOM: Das Feld merkt sich seinen Wert selbst, und
           ein direkt geleertes `input.value` schrieb es beim nächsten Zeichnen zurück. -->
      <Input
        :ref="setCommentField"
        v-model="draft"
        type="text"
        placeholder="Kommentieren …"
        class="mt-1 h-7 text-xs"
        :disabled="sending"
        :maxlength="TEXT_LIMIT.createStatusUpdateComment.body.maxLength"
        @keydown.enter="submitComment"
      />
    </div>
  </div>
</template>
