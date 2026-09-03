<script setup lang="ts">
/**
 * The plots the team puts up, typically two at a time.
 *
 * Closing rather than deleting is the whole shape of this list: applications point at an offer,
 * and one that is over still has to say what somebody applied for months later. Closed offers stay
 * visible here and nowhere else.
 *
 * Two things the team sets besides the text. **The roles**, which become the applicant's list of
 * choices instead of a free-text field — the team knows the plot's characters, and four people
 * describing the same role in four ways is not something a matching decision can be made from.
 * Naming none is allowed and keeps the old free text.
 *
 * **The deadline**, which closes nothing: it is what the page shows and what an application is
 * checked against. Only the button beside each offer closes one, because deciding a round is over
 * is the team's, and a plot vanishing on its own would be the software making that call.
 */
import { computed, ref } from 'vue'
import {
  getListAllBlindDateOffersQueryKey,
  useCloseBlindDateOffer,
  useCreateBlindDateOffer,
  useListAllBlindDateOffers,
} from '@/api/moderation/moderation'
import type { ListAllBlindDateOffers200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { formatActivityTime, formatDeadline } from '@/lib/format/formatTime'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListAllBlindDateOffers()

const offers = computed<ListAllBlindDateOffers200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const open = computed(() => offers.value.filter((offer) => offer.closedAt === null))
const closed = computed(() => offers.value.filter((offer) => offer.closedAt !== null))

const title = ref<string>('')
const description = ref<string>('')
const roles = ref<string[]>([])
const role = ref<string>('')
/** A date, as `<input type="date">` gives it: `2026-09-30`, or empty for no deadline. */
const closesOn = ref<string>('')
const error = ref<string | undefined>(undefined)

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

/** No blanks and no duplicates: a list with „Die Wirtin" twice is a choice that reads as a bug. */
function addRole() {
  const named = role.value.trim()

  if (named === '' || !roomForMoreRoles.value || roles.value.includes(named)) return

  roles.value = [...roles.value, named]
  role.value = ''
}

function removeRole(named: string) {
  roles.value = roles.value.filter((each) => each !== named)
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

const { mutateAsync: create, isPending: isCreating } = useCreateBlindDateOffer()
const { mutateAsync: close, isPending: isClosing } = useCloseBlindDateOffer()

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListAllBlindDateOffersQueryKey() })
}

async function add() {
  if (title.value.trim() === '' || description.value.trim() === '') return

  error.value = undefined

  try {
    await create({
      data: {
        title: title.value.trim(),
        description: description.value.trim(),
        roles: roles.value,
        ...(closesAt.value === null ? {} : { closesAt: closesAt.value }),
      },
    })
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  title.value = ''
  description.value = ''
  roles.value = []
  role.value = ''
  closesOn.value = ''
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

  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Was gerade zur Bewerbung steht. Üblicherweise zwei gleichzeitig. Wer sich proaktiv bewirbt,
      nennt stattdessen eine eigene offizielle RSH-Handlung — dafür braucht es hier nichts.
    </p>

    <form class="mt-4 flex flex-col gap-2.5" @submit.prevent="add">
      <Input
        v-model="title"
        aria-label="Titel der Handlung"
        placeholder="Titel der Handlung"
        :maxlength="TEXT_LIMIT.createBlindDateOffer.title.maxLength"
        class="max-w-[420px]"
      />
      <Textarea
        v-model="description"
        aria-label="Kurzbeschreibung"
        placeholder="Worum es geht, in ein paar Sätzen"
        :maxlength="TEXT_LIMIT.createBlindDateOffer.description.maxLength"
        class="max-w-[70ch]"
        rows="3"
      />
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

      <div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          :disabled="isCreating || title.trim() === '' || description.trim() === ''"
        >
          Anbieten
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

        <ul v-else class="mt-2 flex flex-col">
          <li
            v-for="offer in open"
            :key="offer.id"
            class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-row text-ink-2">{{ offer.title }}</p>
              <Button variant="ghost" size="xs" :disabled="isClosing" @click="closeOne(offer.id)">
                Schließen
              </Button>
            </div>
            <p class="mt-1 max-w-[70ch] text-[12.5px] text-ink-4">{{ offer.description }}</p>
            <p v-if="offer.roles.length > 0" class="mt-1 max-w-[70ch] text-[12.5px] text-ink-5">
              Rollen: {{ offer.roles.join(' · ') }}
            </p>
            <p class="mt-1 text-[12px] text-ink-6">
              seit {{ formatActivityTime(offer.createdAt) }}
              <template v-if="offer.closesAt">
                · Bewerbung bis {{ formatDeadline(offer.closesAt) }}
              </template>
            </p>
          </li>
        </ul>
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
            </p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
