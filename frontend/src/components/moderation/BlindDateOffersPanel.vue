<script setup lang="ts">
/**
 * The plots the team puts up, typically two at a time.
 *
 * Closing rather than deleting is the whole shape of this list: applications point at an offer, and
 * one that is over still has to say what somebody applied for months later. Closed offers stay
 * visible here and nowhere else.
 *
 * **Editing exists now**, and did not before: a typo was permanent, and a description that ran into
 * the old length limit could not be repaired — the only way out was to close the offer and write a
 * second one, leaving the first in the list for good. Only open ones may be edited, for the reason
 * above.
 *
 * What the team sets besides the text. **The roles**, which become the applicant's list of choices
 * instead of a free-text field. **The deadline**, which closes nothing on its own: it is what the
 * page shows and what an application is checked against, and only the button beside each offer
 * closes one. And **the pairing and the genres**, which are what somebody scans a page of offers
 * for before reading a word of any of them.
 *
 * The open ones are shown with the same card the members' page uses, so what the team writes is
 * seen the way it will be read — including where the description is shortened.
 */
import { computed, ref } from 'vue'
import {
  getListAllBlindDateOffersQueryKey,
  useCloseBlindDateOffer,
  useCreateBlindDateOffer,
  useListAllBlindDateOffers,
  useUpdateBlindDateOffer,
} from '@/api/moderation/moderation'
import type { CreateBlindDateOfferBodyPairing, ListAllBlindDateOffers200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime, formatDeadline } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import BlindDateOfferCard from '@/components/blind-date/BlindDateOfferCard.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const { data, isPending } = useListAllBlindDateOffers()

const offers = computed<ListAllBlindDateOffers200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const open = computed(() => offers.value.filter((offer) => offer.closedAt === null))
const closed = computed(() => offers.value.filter((offer) => offer.closedAt !== null))

/* ── The form, which both creates and edits ────────────────────────────────────────────────── */

/** The offer being edited, or nothing — in which case the form creates. */
const editing = ref<string | undefined>(undefined)

const title = ref<string>('')
const description = ref<string>('')
const roles = ref<string[]>([])
const role = ref<string>('')
const genres = ref<string[]>([])
const genre = ref<string>('')
const pairing = ref<string>('')
/** A date, as `<input type="date">` gives it: `2026-09-30`, or empty for no deadline. */
const closesOn = ref<string>('')
const error = ref<string | undefined>(undefined)

// `NonNullable`, because the generated type carries `| null` — that is a valid *value* for the
// field and not a valid key for an option in a list.
const PAIRINGS: ReadonlyArray<{
  value: NonNullable<CreateBlindDateOfferBodyPairing>
  label: string
}> = [
  { value: 'fm', label: 'F × M' },
  { value: 'ff', label: 'F × F' },
  { value: 'mm', label: 'M × M' },
  { value: 'dd', label: 'D × D' },
  { value: 'any', label: 'Egal' },
]

/** Today, as `<input type="date">` wants it, so a deadline cannot be set in the past. */
const today = computed<string>(() => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
})

const roomForMoreRoles = computed<boolean>(
  () => roles.value.length < TEXT_LIMIT.createBlindDateOffer.roles.maxItems,
)

const roomForMoreGenres = computed<boolean>(
  () => genres.value.length < TEXT_LIMIT.createBlindDateOffer.genres.maxItems,
)

/** No blanks and no duplicates: a list with „Die Wirtin" twice is a choice that reads as a bug. */
function addTo(list: typeof roles, field: typeof role, room: boolean) {
  const named = field.value.trim()
  if (named === '' || !room || list.value.includes(named)) return
  list.value = [...list.value, named]
  field.value = ''
}

const addRole = () => addTo(roles, role, roomForMoreRoles.value)
const addGenre = () => addTo(genres, genre, roomForMoreGenres.value)

function removeRole(named: string) {
  roles.value = roles.value.filter((each) => each !== named)
}

function removeGenre(named: string) {
  genres.value = genres.value.filter((each) => each !== named)
}

/**
 * The deadline as a moment: the last one of the day the team picked, in their own time zone.
 *
 * Picking a day and having it end at midnight *that morning* is the classic way for a deadline to
 * be a day shorter than everybody read it as.
 */
const closesAt = computed<string | null>(() => {
  // A date-time without an offset is local time, which is what makes this the end of the team's
  // day rather than the end of a day in London.
  return closesOn.value === '' ? null : new Date(`${closesOn.value}T23:59:59.999`).toISOString()
})

function clearForm() {
  editing.value = undefined
  title.value = ''
  description.value = ''
  roles.value = []
  role.value = ''
  genres.value = []
  genre.value = ''
  pairing.value = ''
  closesOn.value = ''
  error.value = undefined
}

/** Loads an offer into the form. The date field wants `2026-09-30`, not a moment. */
function edit(offer: ListAllBlindDateOffers200Item) {
  editing.value = offer.id
  title.value = offer.title
  description.value = offer.description
  roles.value = [...offer.roles]
  role.value = ''
  genres.value = [...offer.genres]
  genre.value = ''
  pairing.value = offer.pairing ?? ''
  closesOn.value = offer.closesAt === null ? '' : offer.closesAt.slice(0, 10)
  error.value = undefined
}

const { mutateAsync: create, isPending: isCreating } = useCreateBlindDateOffer()
const { mutateAsync: update, isPending: isUpdating } = useUpdateBlindDateOffer()
const { mutateAsync: close, isPending: isClosing } = useCloseBlindDateOffer()

const isSaving = computed<boolean>(() => isCreating.value || isUpdating.value)

const complete = computed<boolean>(
  () => title.value.trim() !== '' && description.value.trim() !== '',
)

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListAllBlindDateOffersQueryKey() })
}

async function save() {
  if (!complete.value) return

  error.value = undefined

  const body = {
    title: title.value.trim(),
    description: description.value.trim(),
    roles: roles.value,
    genres: genres.value,
    ...(closesAt.value === null ? {} : { closesAt: closesAt.value }),
    ...(pairing.value === ''
      ? {}
      : { pairing: pairing.value as NonNullable<CreateBlindDateOfferBodyPairing> }),
  }

  try {
    if (editing.value === undefined) {
      await create({ data: body })
    } else {
      await update({ offerId: editing.value, data: body })
    }
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  clearForm()
  await refresh()
}

async function closeOne(offerId: string) {
  error.value = undefined

  try {
    await close({ offerId })
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  // An offer being edited that somebody just closed would leave the form pointing at nothing.
  if (editing.value === offerId) clearForm()
  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Was gerade zur Bewerbung steht. Üblicherweise zwei gleichzeitig. Wer sich proaktiv bewirbt,
      nennt stattdessen eine eigene offizielle RSH-Handlung — dafür braucht es hier nichts.
    </p>

    <form class="mt-4 flex flex-col gap-2.5" @submit.prevent="save">
      <p v-if="editing" class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
        Handlung bearbeiten
      </p>

      <Input
        v-model="title"
        aria-label="Titel der Handlung"
        placeholder="Titel der Handlung"
        :maxlength="TEXT_LIMIT.createBlindDateOffer.title.maxLength"
        class="max-w-[420px]"
      />
      <Textarea
        v-model="description"
        aria-label="Beschreibung"
        placeholder="Worum es geht"
        :maxlength="TEXT_LIMIT.createBlindDateOffer.description.maxLength"
        class="max-w-[70ch]"
        rows="6"
      />
      <p class="text-[12px] text-ink-6">
        {{ description.length }} von
        {{ TEXT_LIMIT.createBlindDateOffer.description.maxLength }} Zeichen. Auf der Karte werden
        die ersten 280 gezeigt, der Rest steht hinter „Weiterlesen".
      </p>

      <!-- Pairing first, as on the card: it is a fact about the plot, the genres are a mood. -->
      <div class="mt-1">
        <label
          for="blindDateOfferPairing"
          class="font-mono text-[11px] tracking-wide text-ink-label uppercase"
        >
          Pairing
        </label>
        <Select
          :model-value="pairing"
          @update:model-value="(value) => (pairing = String(value ?? ''))"
        >
          <SelectTrigger
            id="blindDateOfferPairing"
            class="mt-1.5 w-full max-w-[200px] text-[12.5px]"
          >
            <SelectValue placeholder="Keine Angabe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in PAIRINGS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="mt-1">
        <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Genres</p>
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Ein paar Schlagworte, nach denen jemand die Übersicht überfliegt — „Mystery", „Dark
          Fantasy", „Slice of Life".
        </p>

        <ul v-if="genres.length > 0" class="mt-2 flex flex-wrap gap-1.5">
          <li
            v-for="named in genres"
            :key="named"
            class="flex items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5 text-[11px] text-ink-3"
          >
            {{ named }}
            <button
              type="button"
              class="text-ink-5 hover:text-ink-2"
              :aria-label="`${named} entfernen`"
              @click="removeGenre(named)"
            >
              ×
            </button>
          </li>
        </ul>

        <div v-if="roomForMoreGenres" class="mt-2 flex flex-wrap items-center gap-2">
          <Input
            v-model="genre"
            aria-label="Genre hinzufügen"
            placeholder="z.B. Mystery"
            :maxlength="TEXT_LIMIT.createBlindDateOffer.genres.items.maxLength"
            class="max-w-[220px]"
            @keydown.enter.prevent="addGenre"
          />
          <Button variant="ghost" size="sm" :disabled="genre.trim() === ''" @click="addGenre">
            Hinzufügen
          </Button>
        </div>
      </div>

      <!-- The roles, which become the applicant's list of choices. Added one at a time and shown
           as they will be read, so what is being built is visible before it is offered. -->
      <div class="mt-1">
        <p class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Rollen</p>
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Wer sich auf diese Handlung bewirbt, wählt eine davon aus. Ohne Rollen beschreibt die
          Bewerbung die gewünschte Rolle wie bisher selbst.
        </p>

        <ul v-if="roles.length > 0" class="mt-2 flex flex-col">
          <li
            v-for="named in roles"
            :key="named"
            class="flex items-baseline justify-between gap-2 border-t border-line-2 py-1.5 first:border-t-0 first:pt-0"
          >
            <span class="text-[12.5px] text-ink-3">{{ named }}</span>
            <Button variant="ghost" size="xs" @click="removeRole(named)">Entfernen</Button>
          </li>
        </ul>

        <div v-if="roomForMoreRoles" class="mt-2 flex flex-wrap items-center gap-2">
          <Input
            v-model="role"
            aria-label="Rolle hinzufügen"
            placeholder="z.B. Die Wirtin"
            :maxlength="TEXT_LIMIT.createBlindDateOffer.roles.items.maxLength"
            class="max-w-[280px]"
            @keydown.enter.prevent="addRole"
          />
          <Button variant="ghost" size="sm" :disabled="role.trim() === ''" @click="addRole">
            Hinzufügen
          </Button>
        </div>
        <p v-else class="mt-2 text-[12px] text-ink-6">
          Mehr als {{ TEXT_LIMIT.createBlindDateOffer.roles.maxItems }} Rollen sind nicht möglich.
        </p>
      </div>

      <!-- The deadline. Closes nothing on its own — see the comment at the top of this file. -->
      <div class="mt-1">
        <label
          for="blindDateOfferClosesOn"
          class="font-mono text-[11px] tracking-wide text-ink-label uppercase"
        >
          Bis wann besteht Bewerbungsmöglichkeit?
        </label>
        <Input
          id="blindDateOfferClosesOn"
          v-model="closesOn"
          type="date"
          :min="today"
          class="mt-1.5 max-w-[200px]"
        />
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Optional. Die Handlung bleibt danach stehen und nimmt keine Bewerbungen mehr an —
          geschlossen wird sie nur hier von Hand.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" :disabled="isSaving || !complete">
          <Spinner v-if="isSaving" />
          {{ editing ? 'Änderungen speichern' : 'Anbieten' }}
        </Button>
        <Button v-if="editing" type="button" variant="ghost" size="sm" @click="clearForm">
          Abbrechen
        </Button>
      </div>
    </form>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <section class="mt-6">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Offen <span class="ml-1 normal-case">({{ open.length }})</span>
        </h3>

        <p v-if="open.length === 0" class="mt-2 text-note text-ink-5">
          Zurzeit steht nichts zur Bewerbung. Proaktive Bewerbungen sind weiterhin möglich.
        </p>

        <!-- The members' own card, so what is written here is seen the way it will be read. -->
        <div v-else class="mt-3 grid gap-3.5 sm:grid-cols-2">
          <div v-for="offer in open" :key="offer.id" class="flex flex-col gap-2">
            <BlindDateOfferCard :offer="offer" />
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="xs" @click="edit(offer)">Bearbeiten</Button>
              <Button variant="ghost" size="xs" :disabled="isClosing" @click="closeOne(offer.id)">
                Schließen
              </Button>
              <span class="text-[12px] text-ink-6">
                seit {{ formatActivityTime(offer.createdAt) }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="closed.length > 0" class="mt-7">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Geschlossen <span class="ml-1 normal-case">({{ closed.length }})</span>
        </h3>
        <p class="mt-1 text-[12px] text-ink-6">
          Bleiben stehen, weil Bewerbungen darauf verweisen.
        </p>

        <ul class="mt-2 flex flex-col">
          <li
            v-for="offer in closed"
            :key="offer.id"
            class="border-t border-line-3 py-2.5 first:border-t-0 first:pt-0"
          >
            <p class="text-[13px] text-ink-4">{{ offer.title }}</p>
            <p class="mt-0.5 text-[12px] text-ink-6">
              geschlossen {{ formatActivityTime(offer.closedAt!) }}
              <template v-if="offer.closesAt">
                · Frist war {{ formatDeadline(offer.closesAt) }}
              </template>
            </p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
