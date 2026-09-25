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
  deleteStatusUpdate,
  deleteStatusUpdateComment,
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
import { useGetCurrentUser } from '@/api/auth/auth'
import { Bell, BellOff, Reply, Trash2 } from '@lucide/vue'
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
 * Wie viele Kommentare vor dem Aufklappen sichtbar sind.
 *
 * **An beiden Orten, nur verschieden weit.** Auf der Seite stand vorher alles offen — dort ist ja
 * Platz. Nur füllt ein Strang mit achtzig Kommentaren damit die ganze Seite: Eine Meldung steht im
 * Blick, alle anderen gehen unter, und man scrollt sich durch etwas, das man gar nicht lesen
 * wollte. Sechs zeigen, was los ist; der Rest kommt auf Klick.
 *
 * Gezeigt werden die **neuesten**: Wer aufklappt, will wissen, was gerade dazugekommen ist.
 */
function previewCount(layout: 'box' | 'page'): number {
  return layout === 'page' ? 6 : 3
}

const open = ref<boolean>(props.openAtOnce)
const showAllComments = ref<boolean>(false)

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
 * **Der neueste Kommentar steht oben**, und das Nachladen hängt die älteren unten an.
 *
 * Hin und her überlegt, und am Ende entscheidet der Zweck: Wer eine Meldung aufklappt, will
 * wissen, was gerade dazugekommen ist — nicht, womit ein Gespräch vor drei Wochen anfing. Also
 * steht das Neueste zuerst.
 *
 * Und weil die Liste rückwärts läuft, landet das Nachgeladene von selbst dort, wo es hingehört:
 * unter dem ältesten, der schon dasteht. Nichts schiebt sich über das, was man gerade liest.
 *
 * Der Server liefert alt nach neu — das ist die Reihenfolge, in der ein Gespräch entstanden ist,
 * und die soll er behalten. Gedreht wird erst hier, beim Anzeigen.
 */
const newestFirst = computed<ListStatusUpdateComments200ResultsItem[]>(() =>
  // Die Ausbreitung kopiert schon; gedreht wird die Kopie, nicht die Liste aus dem
  // Zwischenspeicher. `toReversed` wäre kürzer, steht aber erst ab ES2023 zur Verfügung, und die
  // Bibliotheksstufe des ganzen Projekts dafür anzuheben ist eine Entscheidung für mehr als diese
  // eine Zeile.
  // eslint-disable-next-line unicorn/no-array-reverse -- siehe oben: es wird eine Kopie gedreht
  [...comments.value].reverse(),
)

const visibleComments = computed<ListStatusUpdateComments200ResultsItem[]>(() =>
  showAllComments.value
    ? newestFirst.value
    : newestFirst.value.slice(0, previewCount(props.layout)),
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

/** Wer hier liest — nur das Eigene lässt sich löschen. */
const { data: userData } = useGetCurrentUser()
const currentUserId = computed<string | undefined>(() =>
  userData.value?.status === 200 ? userData.value.data.id : undefined,
)

const refreshStatusUpdates = useRefreshStatusUpdates()

/**
 * Was einem selbst gehört, darf man zurücknehmen.
 *
 * **Die Meldung nimmt ihre Kommentare mit** — ein Strang ohne seinen Anfang ist kein Strang. Ein
 * Kommentar wird dagegen nur leer: An seiner Stelle steht „Kommentar gelöscht.", damit Antworten,
 * die ihn zitieren, ihren Anker behalten.
 *
 * Beides steht vorher im Protokoll. Deshalb die Rückfrage: Es ist zurücknehmbar für die Lesenden,
 * nicht für die Aufzeichnung.
 */
const removing = ref<boolean>(false)

async function removeUpdate() {
  if (!globalThis.confirm('Diese Statusmeldung löschen? Die Kommentare darunter gehen mit.')) {
    return
  }

  removing.value = true
  try {
    await deleteStatusUpdate(props.update.id)
    await refreshStatusUpdates()
  } finally {
    removing.value = false
  }
}

async function removeComment(commentId: string) {
  if (!globalThis.confirm('Diesen Kommentar löschen?')) {
    return
  }

  removing.value = true
  try {
    await deleteStatusUpdateComment(props.update.id, commentId)
    await Promise.all([commentsQuery.refetch(), refreshStatusUpdates()])
  } finally {
    removing.value = false
  }
}
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
        <p class="pl-9 text-xs leading-7" :class="layout === 'page' ? 'pr-40' : 'pr-16'">
          <RouterLink
            :to="{ name: 'member', params: { userId: update.createdBy } }"
            class="font-medium text-ink-2 hover:underline"
          >
            {{ update.createdByUsername }}
          </RouterLink>
          <span class="text-ink-4"> · </span>
          <!-- **Die Uhrzeit ist eine Angabe, kein Weg.**
               Sie trug eine Weile den Verweis auf die Seite — ein Knopf weniger in einem engen
               Kasten. Nur klickt niemand auf eine Uhrzeit, um irgendwohin zu kommen: Wer es
               versehentlich tat, stand plötzlich auf einer anderen Seite. Der Weg dorthin steht
               unter dem Kasten, wo man ihn sucht. -->
          <span class="text-ink-3">{{ formatActivityTime(update.createdAt) }}</span>
        </p>
        <StatusBody :text="update.body" :lines="layout === 'page' ? 8 : 3" />
        <!-- **Die Glocke neben der Sprechblase**, nicht als Satz unter dem Feld.
             Durchgestrichen und grau heißt: von hier kommt nichts. In Farbe: es kommt etwas.
             Ein Zustand, den man sieht, statt eines Satzes, den man lesen muss — und er steht
             dort, wo auch die Kommentare stehen, um die es geht. -->
        <div class="absolute top-0 right-0 flex items-center gap-1">
          <!-- Nur an der eigenen Meldung, und ganz links in der Reihe: Löschen ist selten und
               endgültig, also steht es nicht dort, wo der Daumen ohnehin hinfährt. -->
          <button
            v-if="update.createdBy === currentUserId"
            type="button"
            class="rounded-full p-1 text-ink-5 hover:text-destructive"
            :disabled="removing"
            aria-label="Statusmeldung löschen"
            title="Statusmeldung löschen"
            @click="removeUpdate"
          >
            <Trash2 :size="13" :stroke-width="1.5" aria-hidden="true" />
          </button>

          <button
            v-if="subscribed !== undefined"
            type="button"
            class="rounded-full p-1"
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

          <!-- **Auf der Seite mit Wort, im Kasten ohne.** Eine Pille mit einer Zahl sieht aus wie
             eine Anzeige, nicht wie ein Knopf — auf der Seite sah es deshalb aus, als ließe sich
             dort gar nicht kommentieren. Im Kasten ist kein Platz für das Wort, dort hilft die
             Beschriftung für Vorlesegeräte. -->
          <button
            type="button"
            class="flex items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5 whitespace-nowrap"
            :aria-expanded="open"
            :aria-label="open ? 'Kommentare zuklappen' : 'Kommentare anzeigen'"
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
            <span class="text-[11.5px] font-medium text-ink-3">
              {{
                layout === 'page'
                  ? update.commentCount === 0
                    ? 'Kommentieren'
                    : pluralize(update.commentCount, 'Kommentar', 'Kommentare')
                  : update.commentCount
              }}
            </span>
          </button>
        </div>
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
            <!--
              **Zitat und Antwort stehen in einer Box.** Vorher war das Zitat ein Kasten und die
              Antwort stand darunter im Freien; zwei Dinge, die zusammengehören, sahen aus wie
              zwei. Jetzt trägt die Box beides: oben, worauf geantwortet wird, direkt darunter die
              Antwort.

              Ohne Zitat bleibt die Antwort nackt, wie jeder andere Kommentar auch — die Box
              bedeutet etwas, und was sie bedeutet, soll sie nicht umsonst sagen.
            -->
            <component
              :is="comment.quotedComment ? QuotedComment : 'div'"
              v-bind="comment.quotedComment ? { quoted: comment.quotedComment } : {}"
            >
              <!-- `leading-5` ist genau die Höhe des Bildes daneben (`size-5`), also steht eine
                   einzeilige Antwort mittig dazu statt drei Pixel zu hoch. Bei mehreren Zeilen
                   bleibt das Bild an der ersten, wo der Name steht — das ist richtig so. -->
              <p class="text-xs leading-5 text-ink-3">
                <RouterLink
                  :to="{ name: 'member', params: { userId: comment.createdBy } }"
                  class="font-medium text-ink-2 hover:underline"
                >
                  {{ comment.createdByUsername }}
                </RouterLink>
                <!-- **Zwei Sätze, nicht einer.** „Kommentar gelöscht." heißt, jemand hat sein
                     eigenes Wort zurückgenommen; „durch Rollenspielhimmel" heißt, die Plattform
                     hat eingegriffen. Wer das verwechselt, hält Moderation für Reue — oder
                     umgekehrt. -->
                <span v-if="comment.deletedBy" class="text-ink-5 italic">
                  {{
                    comment.deletedBy === 'moderation'
                      ? 'Kommentar durch Rollenspielhimmel gelöscht.'
                      : 'Kommentar gelöscht.'
                  }}
                </span>
                <template v-else>{{ comment.body }}</template>
                <span class="text-ink-4">· {{ formatActivityTime(comment.createdAt) }} ·</span>
                <!-- **„Antworten", nicht „Zitieren", und mit Pfeil.**
                   „Zitieren" beschreibt die Technik; „Antworten" das, was man vorhat — und
                   zitieren *ist* auf einen bestimmten Kommentar antworten, der Streifen darüber
                   zeigt danach, auf welchen. Der Pfeil ist das Zeichen, nach dem man sucht: In
                   derselben zurückgenommenen Farbe wie die Uhrzeit übersah man das Wort allein.

                   Bleibt in der Metazeile und wird keine Knopfleiste: eine Handlung, kein
                   Angebot, das sich vordrängt. -->
                <button
                  v-if="!comment.deletedBy"
                  type="button"
                  class="ml-0.5 inline-flex items-baseline gap-0.5 text-ink-4 hover:text-oak-deep"
                  @click="quoteComment(comment)"
                >
                  <Reply :size="11" :stroke-width="1.75" class="self-center" aria-hidden="true" />
                  Antworten
                </button>

                <button
                  v-if="!comment.deletedBy && comment.createdBy === currentUserId"
                  type="button"
                  class="ml-1 inline-flex items-baseline gap-0.5 text-ink-4 hover:text-destructive"
                  :disabled="removing"
                  @click="removeComment(comment.id)"
                >
                  <Trash2 :size="11" :stroke-width="1.75" class="self-center" aria-hidden="true" />
                  Löschen
                </button>
              </p>
            </component>
          </div>
        </div>

        <!-- Unter der Liste: Dort stehen die älteren, und dort kommen sie auch dazu. Über der
             Liste schöbe das Nachgeladene sich über das, was man gerade liest. -->
        <button
          v-if="!showAllComments && comments.length > previewCount(layout)"
          type="button"
          class="mb-1.5 block w-full text-center text-xs font-medium text-oak-deep"
          @click="showAllComments = true"
        >
          {{
            pluralize(
              comments.length - previewCount(layout),
              'weiteren Kommentar',
              'weitere Kommentare',
            )
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
           ein direkt geleertes `input.value` schrieb es beim nächsten Zeichnen zurück.

           **Der Fokusrahmen ist hier feiner als sonst.** Drei Pixel Braun direkt neben der
           gedämpften Füllung des Zitats darüber ließen die beiden verschwimmen — zwei kräftige
           Brauntöne aneinander, das sieht nach alter Oberfläche aus. Einer reicht, um zu zeigen,
           wo man tippt. Überall sonst bleibt der Rahmen, wie er ist. -->
      <Input
        :ref="setCommentField"
        v-model="draft"
        type="text"
        placeholder="Kommentieren …"
        class="mt-1 h-7 text-xs focus-visible:ring-1"
        :disabled="sending"
        :maxlength="TEXT_LIMIT.createStatusUpdateComment.body.maxLength"
        @keydown.enter="submitComment"
      />
    </div>
  </div>
</template>
