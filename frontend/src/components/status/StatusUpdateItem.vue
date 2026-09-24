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
  setStatusUpdateSubscription,
  useGetStatusUpdateSubscription,
  useListStatusUpdateComments,
} from '@/api/status-updates/status-updates'
import type {
  ListStatusUpdateComments200ResultsItem,
  ListStatusUpdates200ResultsItem,
} from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { formatActivityTime } from '@/lib/format/formatTime'
import { pluralize } from '@/lib/format/formatText'
import { useRefreshStatusUpdates } from '@/composables/useStatusUpdates'
import { Bell, BellOff } from '@lucide/vue'
import QuotedComment from '@/components/status/QuotedComment.vue'
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
 *
 * Gezeigt werden die **ersten** drei: Man liest von vorn und klappt nach unten auf.
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

/**
 * Die Vorschau zeigt den **Anfang** des Gesprächs, nicht sein Ende.
 *
 * Vorher standen die letzten drei da. Die Reihenfolge war schon immer alt nach neu — aber wer
 * mitten hineinschaut, liest den Schluss zuerst und muss nach oben aufklappen, um den Anfang zu
 * bekommen. Das sah aus wie eine verkehrte Reihenfolge, auch wenn es keine war.
 *
 * Jetzt liest man von vorn und klappt nach unten auf, in die Richtung, in die das Gespräch läuft.
 */
const visibleComments = computed<ListStatusUpdateComments200ResultsItem[]>(() =>
  showAllComments.value ? comments.value : comments.value.slice(0, PREVIEW_COUNT),
)

function toggleComments() {
  open.value = !open.value
}

const draft = ref<string>('')

/**
 * Der Kommentar, auf den sich die Antwort bezieht, solange sie getippt wird.
 *
 * **Als Bezug, nicht als Text.** Früher schrieb „Zitieren" `@name: „die ersten 60 Zeichen …"` in
 * das Feld. Der Rest war damit für immer weg, der Name ließ sich nicht verlinken, und er wäre
 * eingefroren, sobald jemand sich umbenennt. Jetzt geht die Kennung mit, und das Zitat wird beim
 * Anzeigen aus dem echten Kommentar gebaut.
 */
const quoted = ref<ListStatusUpdateComments200ResultsItem | undefined>(undefined)
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
 * Legt den Bezug über das Eingabefeld.
 *
 * Der getippte Text bleibt stehen: Wer schon angefangen hat zu antworten und dann zitiert, meint
 * beides. Der Blinkstrich geht zurück ins Feld, damit man einfach weiterschreibt.
 */
function quoteComment(comment: ListStatusUpdateComments200ResultsItem) {
  quoted.value = comment

  void nextTick(() => {
    commentField.value?.focus()
    const end = commentField.value?.value.length ?? 0
    commentField.value?.setSelectionRange(end, end)
  })
}

/**
 * Ob von hier Mitteilungen kommen — und ob das jemand ausdrücklich so gesetzt hat.
 *
 * **Drei Stellungen, nicht zwei.** Ohne Eintrag gilt die Regel: Die Verfasserin und alle, die
 * kommentiert haben, hören mit. Ausdrücklich an bekommt auch mit, wer nie etwas geschrieben hat;
 * ausdrücklich aus gibt Ruhe, auch wenn man mitgeschrieben hat.
 *
 * Immer gefragt, anders als die Kommentare: Die Glocke steht sichtbar am Eintrag und muss von
 * Anfang an das Richtige zeigen. Es ist eine kleine Abfrage je Meldung, und vue-query hält sie.
 */
const subscriptionQuery = useGetStatusUpdateSubscription(() => props.update.id)

const subscribed = computed<boolean | undefined>(() => {
  const answer = subscriptionQuery.data.value
  return answer?.status === 200 ? answer.data.subscribed : undefined
})

const switching = ref<boolean>(false)

async function toggleSubscription() {
  if (subscribed.value === undefined || switching.value) {
    return
  }

  switching.value = true
  try {
    await setStatusUpdateSubscription(props.update.id, { subscribed: !subscribed.value })
    await subscriptionQuery.refetch()
  } finally {
    switching.value = false
  }
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
    const created = await createStatusUpdateComment(props.update.id, {
      body,
      quotedCommentId: quoted.value?.id,
    })
    if (created.status !== 201) {
      return
    }

    // Erst nach der Zusage geleert: Schlägt das Absenden fehl, stehen Text und Zitat noch da und
    // sind nicht verloren.
    draft.value = ''
    quoted.value = undefined
    // **Drei Dinge, nicht eines.** Die Kommentare selbst; die Liste, weil die Zahl am
    // Sprechblasen-Knopf von dort kommt und an beiden Orten steht; und die Glocke, weil
    // Mitkommentieren nach der Regel bedeutet, ab jetzt mitzuhören — sie stand sonst grau da,
    // bis jemand neu lud, und log damit über den eigenen Zustand.
    await Promise.all([
      commentsQuery.refetch(),
      subscriptionQuery.refetch(),
      refreshStatusUpdates(),
    ])
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
    <!--
      **Bild und Sprechblase stehen über dem Text, nicht neben ihm.**

      Als Nachbarn in einem Flex-Kasten machten beide die Textspalte auf ihrer *ganzen* Höhe
      schmaler: Auch die vierte Zeile hielt vor der Sprechblase an und hinter dem Bild, obwohl
      dort längst nichts mehr steht. Freigestellt hält nur die Kopfzeile Abstand — links vom Bild,
      rechts von der Blase —, und der Text darunter läuft über die volle Breite.

      `leading-7` ist genau die Höhe des Bildes (`size-7`), also steht die Kopfzeile mittig
      daneben, ohne dass dafür etwas ausgerichtet werden müsste.
    -->
    <div class="relative">
      <RouterLink
        :to="{ name: 'member', params: { userId: update.createdBy } }"
        class="absolute top-0 left-0"
      >
        <UserAvatar :username="update.createdByUsername" />
      </RouterLink>
      <div>
        <p class="pr-12 pl-9 text-xs leading-7">
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
        <StatusBody :text="update.body" :lines="layout === 'page' ? 8 : 3" />
        <!-- **Die Glocke neben der Sprechblase**, nicht als Satz unter dem Feld.
             Durchgestrichen und grau heißt: von hier kommt nichts. In Farbe: es kommt etwas.
             Ein Zustand, den man sieht, statt eines Satzes, den man lesen muss — und er steht
             dort, wo auch die Kommentare stehen, um die es geht. -->
        <button
          v-if="subscribed !== undefined"
          type="button"
          class="absolute top-0 right-11 rounded-full p-1"
          :disabled="switching"
          :title="subscribed ? 'Keine Mitteilungen mehr' : 'Mitteilungen einschalten'"
          :aria-label="subscribed ? 'Keine Mitteilungen mehr' : 'Mitteilungen einschalten'"
          :aria-pressed="subscribed"
          @click="toggleSubscription"
        >
          <component
            :is="subscribed ? Bell : BellOff"
            :size="14"
            :stroke-width="1.5"
            :class="subscribed ? 'text-oak-deep' : 'text-ink-5'"
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          class="absolute top-0 right-0 flex items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5"
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
    </div>

    <!-- Keine Einrückung: Der Meldungstext darüber läuft bis zum Rand, und ein Kommentarblock,
         der neun Pixel weiter innen anfängt, sieht daneben aus wie ein Versehen. Die Trennlinie
         sagt schon, dass hier etwas anderes beginnt. -->
    <div v-if="open" class="mt-2 border-t border-line-4 pt-2">
      <p v-if="commentsQuery.isPending.value" class="text-[11.5px] text-ink-5">Wird geladen …</p>

      <template v-else>
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
          <div class="min-w-0 flex-1">
            <QuotedComment
              v-if="comment.quotedComment"
              :quoted="comment.quotedComment"
              class="mb-1"
            />
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
        </div>

        <!-- Unter der Liste, nicht darüber: Das Gespräch läuft nach unten, und was fehlt, fehlt
             hinten. Darüber stehend forderte er auf, nach oben zu lesen. -->
        <button
          v-if="!showAllComments && comments.length > PREVIEW_COUNT"
          type="button"
          class="mb-1.5 block text-xs font-medium text-oak-deep"
          @click="showAllComments = true"
        >
          {{
            pluralize(comments.length - PREVIEW_COUNT, 'weiteren Kommentar', 'weitere Kommentare')
          }}
          anzeigen
        </button>
      </template>

      <!-- Was zitiert wird, steht über dem Feld statt im Feld: Der eigene Text bleibt der eigene,
           und beim Absenden geht die Kennung mit statt einer Abschrift. -->
      <QuotedComment
        v-if="quoted"
        :quoted="quoted"
        removable
        class="mt-1"
        @remove="quoted = undefined"
      />

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
