<script setup lang="ts">
/**
 * One message to a chosen audience. The count is shown before the button and the send asks for a
 * confirmation, because this is the one action here that cannot be taken back: a mail that has
 * left cannot be recalled, and there are hundreds of them.
 *
 * The writing surface is the one from the post composer — the same serif at the same size on the
 * same paper — but without its formatting toolbar. The mail is plain text, as every message this
 * platform sends is, so a toolbar would offer marks that the send would silently discard.
 */
import { computed, ref, watch } from 'vue'
import {
  getListBroadcastQueueQueryKey,
  getListReleasedBroadcastsQueryKey,
  useApproveBroadcast,
  useCountBroadcastRecipients,
  useDiscardBroadcast,
  useEditBroadcast,
  useListBroadcastQueue,
  useListBroadcastSenders,
  useListReleasedBroadcasts,
  useSubmitBroadcast,
} from '@/api/moderation/moderation'
import type {
  ListBroadcastQueue200Item,
  ListBroadcastSenders200Item,
  ListReleasedBroadcasts200Item,
  SubmitBroadcastBodyAudienceRolesItem,
} from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { ApiError } from '@/lib/api/apiFetch'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime } from '@/lib/format/formatTime'
import { berlinToUtc, formatBerlin, utcToBerlin } from '@/lib/format/berlinTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { pluralize } from '@/lib/format/formatText'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import BroadcastSendersPanel from '@/components/moderation/BroadcastSendersPanel.vue'
import BroadcastReplies from '@/components/moderation/BroadcastReplies.vue'
import UserPicker from '@/components/user/UserPicker.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const tab = ref<string>('compose')

/**
 * No counts here. „Wie viele Absender es gibt" is not a number anybody acts on, and the design
 * rules keep counts for things still waiting to be done.
 */
const TABS: ModerationTab[] = [
  { value: 'compose', label: 'Schreiben' },
  { value: 'queue', label: 'Warteschlange' },
  { value: 'released', label: 'Gesendete' },
  { value: 'senders', label: 'Absender' },
]

type Role = SubmitBroadcastBodyAudienceRolesItem

/** Ordered as somebody reads them: the team first, then everybody else. */
const ROLES: ReadonlyArray<{ value: Role; label: string }> = [
  { value: 'administrator', label: 'Administration' },
  { value: 'moderator', label: 'Moderation' },
  { value: 'member', label: 'Mitglieder ohne Rolle' },
]

/**
 * **Nichts vorausgewählt.**
 *
 * Standen alle drei Haken, ging eine Rundmail, die an die Administration gedacht war, an alle —
 * genau so passiert, beim ersten Durchklicken auf der Beta. Eine Voreinstellung, die im
 * Zweifelsfall die größtmögliche Reichweite wählt, ist bei etwas Unwiderruflichem die falsche
 * Richtung: Wer an alle schreiben will, setzt drei Haken; wer sich vertut, erreicht niemanden
 * statt jeden.
 */
const chosen = ref<Role[]>([])

/**
 * Ausdrücklich genannte Mitglieder, zusätzlich zu den Rollen.
 *
 * **Beides zugleich, nicht entweder/oder:** Wer die Moderation wählt und zwei Namen nennt, erreicht
 * beide. Wer nur Namen nennt, schreibt an genau die — und dann ist es keine Ankündigung mehr,
 * weshalb das Archiv in diesem Fall gar nicht erst angeboten wird.
 *
 * Name und Kennung zusammen: Die Kennung geht an den Server, der Name steht in der Liste. Ihn erst
 * nachzuschlagen hieße, für jede Zeile eine Abfrage zu stellen, deren Antwort man gerade in der
 * Hand hatte.
 */
const namedRecipients = ref<Array<{ id: string; username: string }>>([])

const memberIds = computed<string[]>(() => namedRecipients.value.map((member) => member.id))

/**
 * Sobald jemand namentlich genannt ist, ist es keine Ankündigung mehr — dann verschwindet der
 * Archiv-Haken, und was vielleicht schon gesetzt war, geht mit.
 */
const mayPublishInArchive = computed<boolean>(() => memberIds.value.length === 0)

function addRecipient(member: { id: string; username: string }) {
  if (memberIds.value.includes(member.id)) {
    return
  }

  namedRecipients.value = [...namedRecipients.value, { id: member.id, username: member.username }]
}

function removeRecipient(id: string) {
  namedRecipients.value = namedRecipients.value.filter((member) => member.id !== id)
}

/**
 * Nimmt den Archiv-Haken zurück, sobald jemand namentlich dazukommt.
 *
 * Sonst bliebe er gesetzt, verschwände nur aus dem Blick, und der Server wiese das Absenden ab —
 * mit einer Meldung über einen Haken, den man gar nicht mehr sieht.
 */
watch(mayPublishInArchive, (mayPublish) => {
  if (!mayPublish) {
    publishInArchive.value = false
  }
})

const includeUnverified = ref<boolean>(false)

/**
 * Die drei Wege, einzeln zu haben.
 *
 * **Postfach und Archiv sind voreingestellt, die E-Mail nicht.** Eine Rundmail ist eine Mitteilung
 * innerhalb der Community; hinaus in fremde Postfächer geht sie, wenn jemand das ausdrücklich
 * will.
 *
 * **Das Archiv war anfangs aus, und das war falsch.** Die Begründung damals war Symmetrie: Es steht
 * neben den Zustellwegen, also solle man es bewusst wählen. Aber ein Archiv, das man bei jeder
 * Rundmail einzeln anhaken muss, wird lückenhaft — und die Lücken merkt niemand, bis ein neues
 * Mitglied nachliest und die Hälfte fehlt. Genau dafür gibt es den Faden. Fünf Rundmails auf der
 * Beta sind so vorbeigelaufen, bevor es auffiel.
 *
 * Der Haken bleibt: Eine interne Notiz an die Administration gehört nicht ins Archiv. Das ist aber
 * die seltenere Entscheidung und gehört deshalb auf die aktive Seite.
 *
 * Dass mindestens einer gesetzt sein muss, prüft am Ende die Datenbank. Hier stumpft es nur den
 * Knopf ab, damit niemand erst nach dem Absenden erfährt, dass er nichts ausgewählt hat.
 */
const deliverToInbox = ref<boolean>(true)
const deliverByEmail = ref<boolean>(false)
const publishInArchive = ref<boolean>(true)
const subject = ref<string>('')
const body = ref<string>('')
/**
 * Der Termin, wie er im Feld steht: Berliner Wanduhr, leer für „sobald freigegeben".
 *
 * Nach Europe/Berlin und nicht nach der Uhr des Geräts — wer aus dem Urlaub eine Ankündigung für
 * Sonntagabend einstellt, meint den deutschen Sonntagabend. Die Umrechnung steht in
 * `lib/format/berlinTime.ts`, samt der beiden Stunden im Jahr, die aus der Reihe fallen.
 */
const scheduledFor = ref<string>('')

const scheduledForUtc = computed<string | null>(() =>
  scheduledFor.value === '' ? null : berlinToUtc(scheduledFor.value),
)

/**
 * Unter welchem Konto sie erscheint. Leer heißt das dauerhaft verfügbare — das Ur-Admin-Konto,
 * das ohne Zeile in der Tabelle immer zur Verfügung steht.
 *
 * Die Liste schlägt vor; verbindlich ist die Prüfung im Backend. Wer hier etwas anderes schickt,
 * bekommt eine Absage — siehe `mayBeSender`.
 */
const sendAs = ref<string>('')

const { data: senderData } = useListBroadcastSenders()

const senders = computed<ListBroadcastSenders200Item[]>(() =>
  senderData.value?.status === 200 ? senderData.value.data : [],
)

/** Der dauerhafte Absender führt die Liste an und ist die Voreinstellung. */
const permanentSender = computed<ListBroadcastSenders200Item | undefined>(() =>
  senders.value.find((sender) => sender.isPermanent),
)

const releasedSenders = computed<ListBroadcastSenders200Item[]>(() =>
  senders.value.filter((sender) => !sender.isPermanent),
)

const confirming = ref<boolean>(false)
const sentTo = ref<number | undefined>(undefined)
const scheduledAt = ref<string | undefined>(undefined)

/** Was beim Einreichen herauskam. Undefined, solange nichts eingereicht wurde. */
const outcome = ref<'sent' | 'scheduled' | 'waiting' | 'edited' | undefined>(undefined)
const error = ref<string | undefined>(undefined)

function toggleRole(role: Role, on: boolean) {
  chosen.value = on ? [...chosen.value, role] : chosen.value.filter((value) => value !== role)
}

const { data } = useCountBroadcastRecipients(
  computed(() => ({
    roles: chosen.value.join(','),
    memberIds: memberIds.value.join(','),
    includeUnverified: includeUnverified.value ? 'true' : 'false',
  })),
  // Asking for nobody is a 400, so the count waits until somebody is chosen — über eine Rolle
  // oder namentlich, beides zählt.
  {
    query: {
      enabled: computed(() => chosen.value.length > 0 || memberIds.value.length > 0),
    },
  },
)

/**
 * Zwei Zahlen, weil die Wege verschieden weit reichen.
 *
 * Wer seine Adresse nie bestätigt hat, liest sein Postfach, bekommt aber keine Mail. Bei „nur
 * E-Mail" ist die Differenz niemand, den irgendetwas erreicht — und genau das muss dastehen, bevor
 * jemand den Knopf drückt.
 */
const reach = computed(() => (data.value?.status === 200 ? data.value.data : undefined))

/** Der Satz über die Reichweite, aus den gewählten Wegen zusammengesetzt. */
const reachSentence = computed<string | undefined>(() => {
  if (reach.value === undefined) {
    return undefined
  }

  const ways: string[] = []
  if (deliverToInbox.value) {
    ways.push(`${reach.value.inbox} im Postfach`)
  }
  if (deliverByEmail.value) {
    ways.push(`${reach.value.email} per E-Mail`)
  }

  if (ways.length === 0) {
    return publishInArchive.value
      ? 'Geht an niemanden — sie steht nur im Forum.'
      : 'Kein Weg gewählt: So kommt sie nirgends an.'
  }

  const skipped = reach.value.inbox - reach.value.email
  // Nur beim reinen E-Mail-Weg ist das Überspringen folgenreich: Dort erreicht die Übersprungenen
  // niemand, auf keinem Weg. Steht das Postfach daneben, bekommen sie es dort, und der Zusatz wäre
  // eine Warnung vor nichts.
  const warning =
    deliverByEmail.value && !deliverToInbox.value && skipped > 0
      ? ` ${skipped} ${skipped === 1 ? 'Mitglied hat' : 'Mitglieder haben'} keine bestätigte Adresse und ${skipped === 1 ? 'wird' : 'werden'} so von nichts erreicht.`
      : ''

  return `Erreicht ${ways.join(', ')}.${warning}`
})

const { mutateAsync: submitBroadcast, isPending } = useSubmitBroadcast()
const { mutateAsync: editBroadcast, isPending: isSavingEdit } = useEditBroadcast()

const isComplete = computed<boolean>(
  () =>
    chosen.value.length > 0 &&
    subject.value.trim().length > 0 &&
    body.value.trim().length > 0 &&
    // Irgendwo ankommen muss sie. Die Datenbank sagt dasselbe und hat das letzte Wort; hier steht
    // es, damit niemand erst nach dem Absenden erfährt, dass er keinen Weg gewählt hat.
    (deliverToInbox.value || deliverByEmail.value || publishInArchive.value),
)

/**
 * Eingereicht heißt nicht verschickt — außer beim Ur-Admin, der mit dem Schreiben freigibt.
 *
 * Was gerade geschehen ist, sagt deshalb die Antwort und nicht dieses Formular: `released` ging
 * raus, alles andere wartet. Eine Oberfläche, die das aus der eigenen Rolle erriete, läge an dem
 * Tag falsch, an dem sich die Regel ändert.
 */
/**
 * Welche Rundmail gerade bearbeitet wird, oder keine.
 *
 * Dasselbe Formular für beides: Ein zweites, das dieselben Felder noch einmal aufführt, wäre zwei
 * Stellen, an denen man einen neuen Haken vergisst.
 */
const editing = ref<string | undefined>(undefined)

/**
 * Ist der Termin schon vorbei?
 *
 * **Dann schickt das Freigeben sofort**, statt zu warten — „frühestens" heißt frühestens. Richtig,
 * aber überraschend, wenn im Eintrag ein Zeitpunkt von gestern steht und der Knopf „Freigeben"
 * heißt. Deshalb sagt die Oberfläche es in dem Moment, in dem jemand drückt.
 */
function isOverdue(entry: ListBroadcastQueue200Item): boolean {
  return entry.scheduledFor !== null && Date.parse(entry.scheduledFor) <= Date.now()
}

/**
 * Holt eine Rundmail ins Formular.
 *
 * **Was hier hineingeht, ist der gespeicherte Stand** und nicht das, was gerade im Formular stand —
 * wer bearbeiten will, will das ändern, was dasteht.
 */
function startEditing(entry: ListBroadcastQueue200Item) {
  editing.value = entry.publicationId
  subject.value = entry.subject
  body.value = entry.body
  chosen.value = [...entry.audienceRoles]
  // Nur die Kennungen kommen zurueck; die Namen holt der Waehler beim Anzeigen nach.
  namedRecipients.value = [...entry.namedRecipients]
  includeUnverified.value = entry.includeUnverified
  deliverToInbox.value = entry.deliverToInbox
  deliverByEmail.value = entry.deliverByEmail
  publishInArchive.value = entry.publishInArchive
  sendAs.value = entry.sendAsUserId ?? ''
  scheduledFor.value = entry.scheduledFor === null ? '' : utcToBerlin(entry.scheduledFor)
  outcome.value = undefined
  error.value = undefined
  confirming.value = false
  tab.value = 'compose'
}

function cancelEditing() {
  editing.value = undefined
  resetForm()
}

function resetForm() {
  confirming.value = false
  subject.value = ''
  scheduledFor.value = ''
  sendAs.value = ''
  body.value = ''
  chosen.value = []
  namedRecipients.value = []
  includeUnverified.value = false
  deliverToInbox.value = true
  deliverByEmail.value = false
  publishInArchive.value = true
}

async function submit() {
  error.value = undefined
  outcome.value = undefined
  sentTo.value = undefined
  scheduledAt.value = undefined

  if (editing.value !== undefined) {
    await saveEdit(editing.value)
    return
  }

  try {
    const answer = await submitBroadcast({
      data: {
        subject: subject.value.trim(),
        body: body.value.trim(),
        audienceRoles: chosen.value,
        memberIds: memberIds.value,
        includeUnverified: includeUnverified.value,
        deliverToInbox: deliverToInbox.value,
        deliverByEmail: deliverByEmail.value,
        publishInArchive: publishInArchive.value,
        sendAsUserId: sendAs.value === '' ? null : sendAs.value,
        scheduledFor: scheduledForUtc.value,
      },
    })

    if (answer.status === 201) {
      // Drei Ausgänge, nicht zwei — und der mittlere ist der, den der Ur-Admin mit Termin nimmt:
      // freigegeben, aber noch nicht raus. Bevor er hier stand, bekam er den Satz für „wartet auf
      // eine fremde Freigabe" zu lesen, obwohl seine längst erteilt war.
      outcome.value =
        answer.data.status === 'released'
          ? 'sent'
          : answer.data.status === 'approved'
            ? 'scheduled'
            : 'waiting'
      sentTo.value = answer.data.recipientCount ?? undefined
      scheduledAt.value = answer.data.scheduledFor ?? undefined
    }
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht. Versuch es noch einmal.')
    return
  }

  resetForm()

  await queryClient.invalidateQueries({ queryKey: getListBroadcastQueueQueryKey() })
}

/**
 * Speichert eine Bearbeitung.
 *
 * **Jede Bearbeitung setzt die Freigabe zurück** — das entscheidet der Server, nicht diese Datei.
 * Für die Warteschlange ändert das nichts, dort ist ohnehin nichts freigegeben; ein Geplantes
 * wandert dadurch zurück nach oben und braucht wieder ein zweites Augenpaar. Genau das ist der
 * Sinn: Sonst ließe man Harmloses absegnen und tauschte danach den Text.
 */
async function saveEdit(publicationId: string) {
  try {
    await editBroadcast({
      publicationId,
      data: {
        subject: subject.value.trim(),
        body: body.value.trim(),
        audienceRoles: chosen.value,
        memberIds: memberIds.value,
        includeUnverified: includeUnverified.value,
        deliverToInbox: deliverToInbox.value,
        deliverByEmail: deliverByEmail.value,
        publishInArchive: publishInArchive.value,
        sendAsUserId: sendAs.value === '' ? null : sendAs.value,
        scheduledFor: scheduledForUtc.value,
      },
    })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das ging nicht. Versuch es noch einmal.')
    return
  }

  outcome.value = 'edited'
  editing.value = undefined
  resetForm()

  await queryClient.invalidateQueries({ queryKey: getListBroadcastQueueQueryKey() })
}

/**
 * Was aus einer gesendeten Rundmail geworden ist, in Worten statt in einer Zahl.
 *
 * **Eine Zahl reicht nicht mehr, seit es zwei Wege gibt.** `recipientCount ?? 0` stand hier und
 * meldete „an 0 Personen", sobald eine Rundmail nur per E-Mail hinausging — die Null hieß „dieser
 * Weg war nicht gewählt" und las sich wie „hat niemanden erreicht".
 */
function reachOf(entry: ListReleasedBroadcasts200Item): string {
  const ways: string[] = []

  if (entry.recipientCount !== null) {
    ways.push(`${pluralize(entry.recipientCount, 'Person', 'Personen')} im Postfach`)
  }
  if (entry.emailRecipientCount !== null) {
    ways.push(`${pluralize(entry.emailRecipientCount, 'Person', 'Personen')} per E-Mail`)
  }

  // Nur ins Archiv gelegt: Dann ist „an niemanden" die Wahrheit und keine Auslassung.
  return ways.length === 0 ? 'nur ins Archiv' : `an ${ways.join(' und ')}`
}

// ── Die Warteschlange ────────────────────────────────────────────────────────────────────────

const { data: queueData } = useListBroadcastQueue()
const { data: releasedData } = useListReleasedBroadcasts()

const queuedBroadcasts = computed<ListBroadcastQueue200Item[]>(() =>
  queueData.value?.status === 200 ? queueData.value.data : [],
)

/**
 * Zwei Abschnitte, weil es zwei Zustände sind — und der Unterschied ist, wer am Zug ist.
 *
 * **Was wartet, wartet auf einen Menschen.** Was freigegeben ist, wartet nur noch auf die Uhr und
 * geht von selbst raus. Beides stand hier untereinander unter der Überschrift „Warteschlange", und
 * das las sich für das Freigegebene wie „hängt fest" — genau so ist es gelesen worden. Der Satz
 * darunter sagte zwar das Richtige, aber der Ort sagte etwas anderes, und der Ort gewinnt.
 */
const waitingBroadcasts = computed<ListBroadcastQueue200Item[]>(() =>
  queuedBroadcasts.value.filter((entry) => entry.status === 'awaiting_approval'),
)

const scheduledBroadcasts = computed<ListBroadcastQueue200Item[]>(() =>
  queuedBroadcasts.value.filter((entry) => entry.status === 'approved'),
)

const releasedBroadcasts = computed<ListReleasedBroadcasts200Item[]>(() =>
  releasedData.value?.status === 200 ? releasedData.value.data : [],
)

const { mutateAsync: approveBroadcast, isPending: isApproving } = useApproveBroadcast()
const { mutateAsync: discardBroadcast, isPending: isDiscarding } = useDiscardBroadcast()

const queueError = ref<string | undefined>(undefined)

async function refreshBoth() {
  await queryClient.invalidateQueries({ queryKey: getListBroadcastQueueQueryKey() })
  await queryClient.invalidateQueries({ queryKey: getListReleasedBroadcastsQueryKey() })
}

async function approve(publicationId: string) {
  queueError.value = undefined

  try {
    await approveBroadcast({ publicationId })
  } catch (failure) {
    // Die eigene Einreichung ist der Fall, den jemand wirklich erlebt — der bekommt seinen Satz.
    queueError.value =
      failure instanceof ApiError && failure.status === 403
        ? 'Deine eigene Einreichung muss jemand anderes aus der Administration freigeben.'
        : failureMessage(failure, 'Die Freigabe ging nicht durch.')
    return
  }

  await refreshBoth()
}

async function discard(publicationId: string) {
  queueError.value = undefined

  try {
    await discardBroadcast({ publicationId })
  } catch (failure) {
    queueError.value = failureMessage(failure, 'Das Verwerfen ging nicht durch.')
    return
  }

  await refreshBoth()
}

const ROLE_LABELS: Record<string, string> = {
  administrator: 'Administration',
  moderator: 'Moderation',
  member: 'Mitglieder ohne Rolle',
}

function rolesOf(roles: string[]): string {
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')
}
</script>

<template>
  <ModerationPage
    title="Rundmail"
    description="Eine Nachricht an das Team, an alle anderen, oder an alle zusammen. Reiner Text, wie jede andere Mail hier — gesperrte Konten bekommen sie nie."
  >
    <ModerationTabs v-model="tab" :tabs="TABS" label="Ansichten" />

    <div class="mt-5">
      <template v-if="tab === 'compose'">
        <!-- Dasselbe Formular für Neues und für Bearbeitetes. Ein zweites mit denselben Feldern
             wären zwei Stellen, an denen man einen neuen Haken vergisst. -->
        <div
          v-if="editing !== undefined"
          class="mb-5 flex max-w-[684px] flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <p class="text-row text-ink-2">Du bearbeitest eine eingereichte Rundmail.</p>
          <button
            type="button"
            class="min-h-11 text-[12.5px] text-ink-5 hover:text-oak-deep md:min-h-0"
            @click="cancelEditing"
          >
            Abbrechen
          </button>
        </div>

        <form class="flex max-w-[684px] flex-col gap-5" @submit.prevent="confirming = true">
          <FieldGroup>
            <Field>
              <FieldLabel>Empfängerkreis</FieldLabel>
              <div class="flex flex-col gap-1">
                <label
                  v-for="role in ROLES"
                  :key="role.value"
                  class="flex min-h-11 items-center gap-2.5 text-[12.5px] text-ink-4 md:min-h-0 md:py-1"
                >
                  <Checkbox
                    :model-value="chosen.includes(role.value)"
                    @update:model-value="(on) => toggleRole(role.value, on === true)"
                  />
                  {{ role.label }}
                </label>

                <!-- **Namen neben den Rollen, nicht statt ihrer.** Wer die Moderation wählt und
                     zwei Namen nennt, erreicht beide; wer nur Namen nennt, schreibt an genau die. -->
                <div class="mt-1 border-t border-line-3 pt-2">
                  <UserPicker
                    :exclude-ids="memberIds"
                    label="Einzelne Mitglieder"
                    placeholder="Name eintippen"
                    @pick="addRecipient"
                  />

                  <ul v-if="namedRecipients.length > 0" class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <li
                      v-for="member in namedRecipients"
                      :key="member.id"
                      class="flex items-baseline gap-1.5 text-[12.5px] text-ink-3"
                    >
                      {{ member.username }}
                      <button
                        type="button"
                        class="text-[12px] text-ink-5 hover:text-oak-deep"
                        @click="removeRecipient(member.id)"
                      >
                        entfernen
                      </button>
                    </li>
                  </ul>
                </div>

                <label
                  class="mt-1 flex min-h-11 items-center gap-2.5 border-t border-line-3 pt-2 text-[12.5px] text-ink-4 md:min-h-0"
                >
                  <Checkbox
                    :model-value="includeUnverified"
                    @update:model-value="(on) => (includeUnverified = on === true)"
                  />
                  Auch an unbestätigte Adressen
                </label>
              </div>

              <p class="text-control text-ink-5">
                <!-- **Nicht „Gruppe".** Eine Gruppe ist auf dieser Plattform eine Schreibgruppe;
                     hier geht es um Rollen. Der alte Satz ließ lesen, ob eine Rundmail an eine
                     Schreibgruppe gehen kann — und war seit den namentlich Genannten ohnehin
                     falsch, weil ein Name allein auch reicht. -->
                <template v-if="chosen.length === 0 && namedRecipients.length === 0">
                  Wähle eine Rolle aus oder nenne Mitglieder.
                </template>
                <template v-else-if="reachSentence === undefined">Wird gezählt.</template>
                <template v-else>{{ reachSentence }}</template>
                An unbestätigte Adressen zu schreiben heißt, an Postfächer zu schreiben, die
                niemandem nachweislich gehören.
              </p>
            </Field>

            <!--
              Drei Haken statt einer Auswahl aus dreien: Es sind drei getrennte Fragen, und jede
              Kombination ist erlaubt außer keiner. Eine Liste mit „Postfach / E-Mail / beides"
              müsste für das Archiv jede Zeile verdoppeln.
            -->
            <Field>
              <FieldLabel>Wege</FieldLabel>
              <div class="flex flex-col gap-1">
                <label
                  class="flex min-h-11 items-center gap-2.5 text-[12.5px] text-ink-4 md:min-h-0 md:py-1"
                >
                  <Checkbox
                    :model-value="deliverToInbox"
                    @update:model-value="(on) => (deliverToInbox = on === true)"
                  />
                  Ins Postfach auf der Plattform
                </label>
                <label
                  class="flex min-h-11 items-center gap-2.5 text-[12.5px] text-ink-4 md:min-h-0 md:py-1"
                >
                  <Checkbox
                    :model-value="deliverByEmail"
                    @update:model-value="(on) => (deliverByEmail = on === true)"
                  />
                  Per E-Mail
                </label>
                <!-- **Fällt weg, sobald jemand namentlich genannt ist.** Eine Rundmail an vier
                     Leute ist keine Ankündigung; sie im Forum abzulegen hieße, sie allen zu zeigen.
                     Ausgeblendet statt abgestumpft: Ein grauer Haken lädt zum Rätseln ein, und der
                     Satz darunter sagt es ohnehin. Der Server weist es unabhängig davon ab. -->
                <label
                  v-if="mayPublishInArchive"
                  class="mt-1 flex min-h-11 items-center gap-2.5 border-t border-line-3 pt-2 text-[12.5px] text-ink-4 md:min-h-0"
                >
                  <Checkbox
                    :model-value="publishInArchive"
                    @update:model-value="(on) => (publishInArchive = on === true)"
                  />
                  Auch im Forum ablegen
                </label>

                <p v-else class="mt-1 border-t border-line-3 pt-2 text-[12px] text-ink-6">
                  Sie geht an namentlich genannte Mitglieder und kommt deshalb nicht ins Archiv.
                </p>
              </div>

              <p class="text-control text-ink-5">
                Im Forum steht sie zum Nachlesen und darf beantwortet werden — unabhängig davon, wie
                sie zugestellt wird.
              </p>
            </Field>

            <!--
              Nur wenn es überhaupt eine Wahl gibt: Solange niemand freigeschaltet ist, geht jede
              Rundmail unter dem einen dauerhaften Konto raus, und ein Feld mit einer einzigen
              Möglichkeit ist eine Frage ohne Antwortmöglichkeit.
            -->
            <Field v-if="releasedSenders.length > 0">
              <FieldLabel for="broadcastSender">Absender</FieldLabel>
              <select
                id="broadcastSender"
                v-model="sendAs"
                class="h-11 max-w-[320px] rounded-lg border border-input bg-transparent px-3 text-sm md:h-9"
              >
                <option value="">{{ permanentSender?.username ?? 'Admin' }}</option>
                <option v-for="sender in releasedSenders" :key="sender.id" :value="sender.id">
                  {{ sender.username }}
                </option>
              </select>
              <p class="text-control text-ink-5">
                Unter diesem Namen kommt sie an. Wer sie geschrieben hat, bleibt intern
                festgehalten. Freigeschaltet werden Konten unter „Absender".
              </p>
            </Field>

            <Field>
              <FieldLabel for="broadcastSubject">Betreff</FieldLabel>
              <Input
                id="broadcastSubject"
                v-model="subject"
                name="broadcastSubject"
                :maxlength="TEXT_LIMIT.submitBroadcast.subject.maxLength"
                autocomplete="off"
              />
            </Field>

            <!--
              Leer ist der Normalfall und heißt „sobald freigegeben". Ein Terminfeld, das
              vorausgefüllt wäre, würde jede Rundmail zu einer geplanten machen — und der Satz
              darunter sagt ausdrücklich Berliner Zeit, weil das Feld die Uhr des Geräts anzeigt
              und beides auseinanderfallen kann.
            -->
            <Field>
              <FieldLabel for="broadcastSchedule"
                >Termin <span class="text-ink-6">optional</span></FieldLabel
              >
              <Input
                id="broadcastSchedule"
                v-model="scheduledFor"
                name="broadcastSchedule"
                type="datetime-local"
                class="max-w-[260px]"
              />
              <p class="text-control text-ink-5">
                <template v-if="scheduledFor === ''">
                  Ohne Termin geht sie raus, sobald sie freigegeben ist.
                </template>
                <template v-else>
                  Geht frühestens am {{ formatBerlin(scheduledForUtc ?? '') }} raus — deutsche Zeit,
                  unabhängig davon, wo du gerade bist. Freigegeben sein muss sie trotzdem.
                </template>
              </p>
            </Field>

            <Field>
              <FieldLabel for="broadcastBody">Nachricht</FieldLabel>
              <!-- The composer's writing surface: `prose-post` is the same serif at the same size the
               thread is read in, so a long message is written in the type it will be read in.
               Framed like a post edited in place, because it stands on ordinary paper here. -->
              <textarea
                id="broadcastBody"
                v-model="body"
                name="broadcastBody"
                :maxlength="TEXT_LIMIT.submitBroadcast.body.maxLength"
                rows="14"
                class="prose-post w-full resize-y rounded-lg border border-line-4 bg-paper-1 px-4 py-3 caret-oak outline-none focus-visible:border-line-5"
              ></textarea>
              <p class="text-control text-ink-5">
                Schreib die ganze Nachricht, mit Anrede und Gruß. Angehängt wird nur die Zeile, dass
                sie vom Team verschickt wurde. Formatierung gibt es nicht — was hier steht, kommt
                genau so an.
              </p>
            </Field>
          </FieldGroup>

          <div>
            <Button type="submit" :disabled="!isComplete || isPending">Weiter</Button>
          </div>
        </form>

        <!-- The one thing here that cannot be undone gets said in full before it happens. -->
        <div
          v-if="confirming"
          class="mt-6 max-w-[60ch] rounded-lg border border-line-4 bg-paper-1 p-4"
        >
          <p class="text-row text-ink-2">{{ reachSentence }}</p>

          <!--
            **Der Termin gehört in die Bestätigung.** Ohne ihn bestätigt man eine Rundmail, ohne je
            zu sehen, wann sie rausgeht — und wenn im Feld etwas steht, das man nicht dort haben
            wollte, ist die Bestätigung die letzte Stelle, an der das auffallen kann. Genau das ist
            passiert: eine Rundmail lag „in der Warteschlange", weil ein Termin gesetzt war, den
            niemand bemerkt hatte.
          -->
          <p v-if="scheduledFor !== ''" class="mt-1 text-row text-ink-2">
            Sie geht am {{ formatBerlin(scheduledForUtc ?? '') }} raus, nicht sofort.
          </p>

          <p class="mt-1 text-[12.5px] text-ink-5">
            <template v-if="scheduledFor === ''">
              Sie geht raus, sobald sie freigegeben ist — verschickte Rundmails lassen sich nicht
              zurückholen.
            </template>
            <template v-else>
              Freigegeben sein muss sie trotzdem; der Termin allein schickt nichts. Verschickte
              Rundmails lassen sich nicht zurückholen.
            </template>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button :disabled="isPending || isSavingEdit" @click="submit">
              <Spinner v-if="isPending || isSavingEdit" />
              {{ editing === undefined ? 'Zur Freigabe einreichen' : 'Änderung speichern' }}
            </Button>
            <Button
              variant="outline"
              :disabled="isPending || isSavingEdit"
              @click="confirming = false"
            >
              Abbrechen
            </Button>
          </div>
        </div>

        <!-- Was geschehen ist, sagt die Antwort und nicht die eigene Rolle — siehe `submit`. -->
        <p v-if="outcome === 'sent'" class="mt-4 text-note text-ink-5" role="status">
          Die Nachricht ist an {{ pluralize(sentTo ?? 0, 'Person', 'Personen') }} unterwegs.
        </p>

        <p v-else-if="outcome === 'scheduled'" class="mt-4 text-note text-ink-5" role="status">
          Freigegeben. Sie geht am
          {{ scheduledAt === undefined ? 'vereinbarten Termin' : formatBerlin(scheduledAt) }}
          von selbst raus — bis dahin steht sie unter „Warteschlange" und lässt sich noch ändern.
        </p>

        <p v-else-if="outcome === 'waiting'" class="mt-4 text-note text-ink-5" role="status">
          Eingereicht. Sie steht jetzt in der Warteschlange und geht raus, sobald jemand anderes aus
          der Administration sie freigibt.
        </p>

        <!-- Ein Satz für beide Fälle, weil das Ergebnis dasselbe ist: Nach einer Bearbeitung steht
             sie in der Warteschlange, gleich woher sie kam. Ob eine Freigabe zurückgenommen wurde,
             wusste nur, wer sie vorher hatte — und dem sagt es der Hinweis unter „Geplant". -->
        <p v-else-if="outcome === 'edited'" class="mt-4 text-note text-ink-5" role="status">
          Gespeichert. Sie steht wieder in der Warteschlange und braucht eine Freigabe.
        </p>

        <p v-if="error" class="mt-4 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
      </template>

      <!-- ── Warteschlange und Geplant ─────────────────────────────────────────────────────── -->
      <!--
        **Zwei Abschnitte, weil zwei verschiedene Leute am Zug sind.** Oben wartet etwas auf einen
        Menschen, unten nur noch auf die Uhr. Beides stand einmal untereinander unter „Warteschlange",
        und das Freigegebene las sich dort wie „hängt fest" — der Satz darunter sagte das Richtige,
        aber der Ort sagte etwas anderes, und der Ort gewinnt.
      -->
      <template v-else-if="tab === 'queue'">
        <p v-if="waitingBroadcasts.length === 0" class="max-w-[70ch] text-note text-ink-5">
          Nichts wartet auf eine Freigabe.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="entry in waitingBroadcasts"
            :key="entry.publicationId"
            class="border-b border-line-2 py-4"
          >
            <p class="text-row text-ink-2">{{ entry.subject }}</p>
            <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
              {{ entry.body }}
            </p>
            <p class="mt-2 text-[12px] text-ink-6">
              An {{ rolesOf(entry.audienceRoles)
              }}<template v-if="entry.includeUnverified">, auch an unbestätigte Adressen</template>
              · Als {{ entry.sendAsUsername ?? 'Admin' }} · Von
              {{ entry.writtenByUsername ?? 'einem gelöschten Konto' }},
              {{ formatActivityTime(entry.writtenAt) }}
            </p>
            <p v-if="entry.scheduledFor" class="mt-1 text-[12px] text-ink-4">
              Termin: {{ formatBerlin(entry.scheduledFor) }}
            </p>

            <p v-if="isOverdue(entry)" class="mt-1 text-[12px] text-ink-3">
              Der Termin ist verstrichen — Freigeben schickt sie sofort.
            </p>

            <div class="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                :disabled="isApproving || isDiscarding"
                @click="approve(entry.publicationId)"
              >
                {{ entry.scheduledFor && !isOverdue(entry) ? 'Freigeben' : 'Freigeben und senden' }}
              </Button>
              <Button
                variant="outline"
                size="sm"
                :disabled="isApproving || isDiscarding"
                @click="startEditing(entry)"
              >
                Bearbeiten
              </Button>
              <Button
                variant="ghost"
                size="sm"
                :disabled="isApproving || isDiscarding"
                @click="discard(entry.publicationId)"
              >
                Verwerfen
              </Button>
            </div>
          </li>
        </ul>

        <section v-if="scheduledBroadcasts.length > 0" class="mt-8">
          <h2 class="font-serif text-h2 text-ink-1">Geplant</h2>
          <p class="mt-1 max-w-[70ch] text-[12.5px] text-ink-5">
            Freigegeben und wartet nur noch auf den Termin. Niemand muss hier etwas tun.
          </p>

          <ul class="mt-3 flex flex-col">
            <li
              v-for="entry in scheduledBroadcasts"
              :key="entry.publicationId"
              class="border-b border-line-2 py-4"
            >
              <p class="text-row text-ink-2">{{ entry.subject }}</p>
              <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
                {{ entry.body }}
              </p>
              <p class="mt-2 text-[12px] text-ink-6">
                An {{ rolesOf(entry.audienceRoles)
                }}<template v-if="entry.includeUnverified"
                  >, auch an unbestätigte Adressen</template
                >
                · Als {{ entry.sendAsUsername ?? 'Admin' }} · Von
                {{ entry.writtenByUsername ?? 'einem gelöschten Konto' }}
              </p>
              <p class="mt-1 text-[12px] text-ink-4">
                Geht am {{ formatBerlin(entry.scheduledFor ?? '') }} von selbst raus · Freigegeben
                von {{ entry.approvedByUsername ?? 'einem gelöschten Konto' }}
              </p>

              <div class="mt-3 flex flex-wrap gap-2">
                <!-- Bearbeiten nimmt die Freigabe zurück, und deshalb steht der Satz daneben: Wer
                     hier tippt, holt die Rundmail zurück in die Warteschlange und braucht wieder
                     ein zweites Augenpaar. Das soll niemand erst hinterher merken. -->
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="isApproving || isDiscarding"
                  @click="startEditing(entry)"
                >
                  Bearbeiten
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="isApproving || isDiscarding"
                  @click="discard(entry.publicationId)"
                >
                  Verwerfen
                </Button>
              </div>
              <p class="mt-1.5 text-[12px] text-ink-6">
                Bearbeiten nimmt die Freigabe zurück — sie wandert dann wieder in die Warteschlange.
              </p>
            </li>
          </ul>
        </section>

        <p v-if="queueError" class="mt-3 text-[12.5px] text-destructive" role="alert">
          {{ queueError }}
        </p>
      </template>

      <!-- ── Gesendete ─────────────────────────────────────────────────────────────────────── -->
      <template v-else-if="tab === 'released'">
        <p v-if="releasedBroadcasts.length === 0" class="max-w-[70ch] text-note text-ink-5">
          Es ist noch keine Rundmail rausgegangen.
        </p>

        <ul v-else class="flex flex-col">
          <li
            v-for="entry in releasedBroadcasts"
            :key="entry.publicationId"
            class="border-b border-line-2 py-4"
          >
            <p class="text-row text-ink-2">{{ entry.subject }}</p>
            <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
              {{ entry.body }}
            </p>

            <!-- Nach außen der Absender, hier beide echten Namen: Das ist der Sinn der Spur, und
                 diese Liste sieht ohnehin nur die Administration. -->
            <p class="mt-2 text-[12px] text-ink-6">
              Als {{ entry.sendAsUsername ?? 'Admin' }} {{ reachOf(entry) }},
              {{
                entry.releasedAt === null ? 'ohne Zeitangabe' : formatActivityTime(entry.releasedAt)
              }}
            </p>
            <!-- Der Bearbeiter steht nur da, wenn er ein anderer ist. Wer seinen eigenen Entwurf
                 nachbessert, hat nichts erklärt bekommen müssen; zwei gleiche Namen nebeneinander
                 wären Rauschen. -->
            <p class="mt-0.5 text-[12px] text-ink-6">
              Geschrieben von {{ entry.writtenByUsername ?? 'einem gelöschten Konto'
              }}<template
                v-if="
                  entry.editedByUsername !== null &&
                  entry.editedByUsername !== entry.writtenByUsername
                "
              >
                · Bearbeitet von {{ entry.editedByUsername }}</template
              >
              · Freigegeben von {{ entry.approvedByUsername ?? 'einem gelöschten Konto' }}
            </p>

            <BroadcastReplies :broadcast-id="entry.broadcastId" />
          </li>
        </ul>
      </template>

      <BroadcastSendersPanel v-else />
    </div>
  </ModerationPage>
</template>
