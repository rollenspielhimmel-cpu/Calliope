<script setup lang="ts">
/**
 * Welche Konten eine Rundmail als Absender tragen darf.
 *
 * Every administrator reads this — it is the list a sender is chosen from when a mail is written —
 * and only the root administrator changes it. So the list is shown to all and the controls only to
 * one, rather than hiding the whole panel: an administrator who cannot see which personas exist
 * cannot plan a mail, and would have to ask.
 *
 * Releasing is a name typed into a field, not a pick from a list. There is no way to look an
 * account up here, and there deliberately isn't one: a search over every account on the platform is
 * a surface to add on purpose, not to grow out of one form. The person doing this created the
 * persona and knows what it is called.
 *
 * The permanent entry has no button beside it. A switch that refuses every press is worse than no
 * switch — the sentence under the list says why it is there instead.
 *
 * **Wer welchen Absender nutzen darf** steht bei jedem Absender: „Nutzbar für" eine Rolle, und die
 * Personen, die ihn persönlich haben. Administrationen dürfen alle und stehen deshalb nirgends.
 * Darunter die Übersicht andersherum — wer welchen Absender persönlich hat —, weil eine persönliche
 * Freigabe einen Rollenwechsel übersteht und sonst leicht vergessen wird. Lesen dürfen das alle
 * Administrationen, ändern nur der Ur-Admin. Wer keine Administration hat, sieht hier nur die
 * Absender, die er nutzen darf.
 */
import { computed, ref } from 'vue'
import {
  getListBroadcastSendersQueryKey,
  getListSenderGrantsQueryKey,
  useGrantSenderToPerson,
  useGrantSenderToRole,
  useListBroadcastSenders,
  useListSenderGrants,
  useReleaseBroadcastSender,
  useRevokeSenderFromPerson,
  useRevokeSenderFromRole,
  useWithdrawBroadcastSender,
} from '@/api/moderation/moderation'
import type { ListBroadcastSenders200Item, ListSenderGrants200Item } from '@/api/models'
import { Checkbox } from '@/components/ui/checkbox'
import UserPicker from '@/components/user/UserPicker.vue'
import { useGetCurrentUser } from '@/api/auth/auth'
import { TEXT_LIMIT } from '@/api/textLimit'
import { queryClient } from '@/lib/api/queryClient'
import { ApiError } from '@/lib/api/apiFetch'
import { failureMessage } from '@/lib/format/failure'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBroadcastSenders()
const { data: currentUser } = useGetCurrentUser()

const senders = computed<ListBroadcastSenders200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const username = ref('')
const error = ref<string | undefined>(undefined)

const mayChange = computed(
  () => currentUser.value?.status === 200 && currentUser.value.data.isPrimordialAdmin,
)

const isAdministrator = computed(
  () =>
    currentUser.value?.status === 200 && currentUser.value.data.platformRole === 'administrator',
)

// Nur für die Administration abgefragt: Für alle anderen antwortet die Route mit 403, und eine
// Abfrage, die jedes Mal scheitert, wäre Lärm im Protokoll.
const { data: grantData } = useListSenderGrants({ query: { enabled: isAdministrator } })

const grants = computed<ListSenderGrants200Item[]>(() =>
  grantData.value?.status === 200 ? grantData.value.data : [],
)

function forModerators(senderId: string): boolean {
  return grants.value.some((row) => row.senderId === senderId && row.role === 'moderator')
}

function peopleOf(senderId: string): ListSenderGrants200Item[] {
  return grants.value.filter((row) => row.senderId === senderId && row.userId !== null)
}

/** Die Übersicht andersherum: je Person die Absender, die sie persönlich hat. */
const personalGrants = computed(() => {
  const byPerson = new Map<string, { userId: string; username: string; senders: string[] }>()

  for (const row of grants.value) {
    if (row.userId === null) {
      continue
    }
    const sender = senders.value.find((each) => each.id === row.senderId)
    const entry = byPerson.get(row.userId) ?? {
      userId: row.userId,
      username: row.username ?? 'Gelöschtes Konto',
      senders: [],
    }
    entry.senders.push(sender === undefined ? '?' : sender.isPermanent ? 'Admin' : sender.username)
    byPerson.set(row.userId, entry)
  }

  return [...byPerson.values()].sort((a, b) => a.username.localeCompare(b.username, 'de'))
})

const { mutateAsync: grantToRole } = useGrantSenderToRole()
const { mutateAsync: revokeFromRole } = useRevokeSenderFromRole()
const { mutateAsync: grantToPerson } = useGrantSenderToPerson()
const { mutateAsync: revokeFromPerson } = useRevokeSenderFromPerson()

async function afterGrant(change: () => Promise<unknown>, fallback: string) {
  error.value = undefined

  try {
    await change()
  } catch (failure) {
    error.value = failureMessage(failure, fallback)
  }

  await queryClient.invalidateQueries({ queryKey: getListSenderGrantsQueryKey() })
}

function toggleModerators(senderId: string, on: boolean) {
  return afterGrant(
    () =>
      on
        ? grantToRole({ senderId, role: 'moderator' })
        : revokeFromRole({ senderId, role: 'moderator' }),
    'Die Freigabe ging nicht durch. Versuch es noch einmal.',
  )
}

function addPerson(senderId: string, userId: string) {
  return afterGrant(
    () => grantToPerson({ senderId, userId }),
    'Die Freigabe ging nicht durch. Versuch es noch einmal.',
  )
}

function removePerson(senderId: string, userId: string) {
  return afterGrant(
    () => revokeFromPerson({ senderId, userId }),
    'Das Entziehen ging nicht durch. Versuch es noch einmal.',
  )
}

const { mutateAsync: release, isPending: isReleasing } = useReleaseBroadcastSender()
const { mutateAsync: withdraw, isPending: isWithdrawing } = useWithdrawBroadcastSender()

const isSaving = computed(() => isReleasing.value || isWithdrawing.value)

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListBroadcastSendersQueryKey() })
  // Ein zurückgenommener Absender nimmt seine Freigaben mit.
  await queryClient.invalidateQueries({ queryKey: getListSenderGrantsQueryKey() })
}

async function add() {
  const name = username.value.trim()

  if (name === '') {
    return
  }

  error.value = undefined

  try {
    await release({ data: { username: name } })
  } catch (failure) {
    // Named here rather than passed through from the server: the API answers in its own words, and
    // the interface says what the person at this field needs to hear. A wrong name is the one
    // mistake this form invites, so it gets the sentence that says so.
    error.value =
      failure instanceof ApiError && failure.status === 404
        ? `Unter dem Namen „${name}“ gibt es kein Konto.`
        : failure instanceof ApiError && failure.status === 403
          ? 'Dieses Konto steht ohnehin dauerhaft zur Verfügung.'
          : failureMessage(failure, 'Das Konto wurde nicht freigeschaltet. Versuch es noch einmal.')
    return
  }

  username.value = ''
  await refresh()
}

async function remove(userId: string) {
  error.value = undefined

  try {
    await withdraw({ userId })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das Konto wurde nicht entzogen. Versuch es noch einmal.')
    return
  }

  await refresh()
}
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Unter welchem Namen eine Rundmail bei den Empfängern ankommt. Wer sie schreibt, wählt hier aus
      — intern bleibt festgehalten, wer sie verfasst hat.
    </p>
    <p v-if="mayChange" class="mt-2 max-w-[70ch] text-[12.5px] text-ink-6">
      Freischalten und entziehen kannst nur du. Ein Konto muss dafür nicht im Team sein: Ein
      „Weihnachtsmann“, bei dem sich niemand anmeldet, ist genau der Fall, für den das gedacht ist.
    </p>
    <p v-else-if="isAdministrator" class="mt-2 max-w-[70ch] text-[12.5px] text-ink-6">
      Freischalten kann nur der Ur-Admin. Fehlt dir hier ein Konto, frag dort nach.
    </p>
    <p v-else class="mt-2 max-w-[70ch] text-[12.5px] text-ink-6">
      Hier stehen die Absender, unter denen du vorbereiten darfst. Welche das sind, legt der
      Ur-Admin fest.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <section class="mt-6">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Steht zur Verfügung <span class="ml-1 normal-case">({{ senders.length }})</span>
        </h3>

        <ul class="mt-2 flex flex-col">
          <li
            v-for="sender in senders"
            :key="sender.id"
            class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 py-3"
          >
            <div class="min-w-0">
              <RouterLink
                :to="{ name: 'member', params: { userId: sender.id } }"
                class="text-row text-ink-2 underline-offset-[5px] hover:underline"
              >
                {{ sender.username }}
              </RouterLink>
              <p v-if="sender.isPermanent" class="mt-0.5 max-w-[60ch] text-[12px] text-ink-6">
                Steht dauerhaft zur Verfügung und kann nicht entzogen werden. Das ist die Stimme der
                Seite selbst.
              </p>

              <!-- Wer außer der Administration ihn nutzen darf. -->
              <div v-if="isAdministrator" class="mt-2 flex flex-col gap-1.5">
                <label class="flex items-center gap-2 text-[12.5px] text-ink-4">
                  <Checkbox
                    :model-value="forModerators(sender.id)"
                    :disabled="!mayChange"
                    :aria-label="`${sender.username}: nutzbar für die Moderation`"
                    @update:model-value="(on) => toggleModerators(sender.id, on === true)"
                  />
                  Nutzbar für die Moderation
                </label>

                <p v-if="peopleOf(sender.id).length > 0" class="text-[12.5px] text-ink-4">
                  Persönlich:
                  <template
                    v-for="(person, index) in peopleOf(sender.id)"
                    :key="person.userId ?? index"
                  >
                    <span v-if="index > 0">, </span>
                    <span>{{ person.username ?? 'Gelöschtes Konto' }}</span>
                    <button
                      v-if="mayChange"
                      type="button"
                      class="ml-1 text-ink-6 underline-offset-[3px] hover:underline"
                      @click="removePerson(sender.id, person.userId ?? '')"
                    >
                      entfernen
                    </button>
                  </template>
                </p>

                <div v-if="mayChange" class="max-w-[320px]">
                  <UserPicker
                    :exclude-ids="peopleOf(sender.id).map((person) => person.userId ?? '')"
                    label="Person hinzufügen"
                    placeholder="Name eintippen"
                    @pick="(person) => addPerson(sender.id, person.id)"
                  />
                </div>
              </div>
            </div>

            <Button
              v-if="mayChange && !sender.isPermanent"
              variant="ghost"
              size="xs"
              :disabled="isSaving"
              @click="remove(sender.id)"
            >
              Entziehen
            </Button>
          </li>
        </ul>
      </section>

      <!-- Andersherum: wer was persönlich hat. Eine persönliche Freigabe übersteht einen
           Rollenwechsel, und hier fällt sie auf, statt vergessen zu werden. -->
      <section v-if="isAdministrator" class="mt-7">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Persönliche Freigaben
        </h3>
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Wer einen Absender persönlich hat, darf damit vorbereiten und einreichen, auch ohne
          Teamrolle. Die Freigabe bleibt, wenn sich die Rolle ändert. Freigeben muss immer die
          Administration.
        </p>
        <p v-if="personalGrants.length === 0" class="mt-2 text-note text-ink-5">
          Niemand hat einen Absender persönlich.
        </p>
        <ul v-else class="mt-2 flex flex-col">
          <li
            v-for="person in personalGrants"
            :key="person.userId"
            class="flex flex-wrap items-baseline gap-x-3 border-b border-line-2 py-2.5"
          >
            <span class="text-row text-ink-2">{{ person.username }}</span>
            <span class="text-[12.5px] text-ink-4">als {{ person.senders.join(', ') }}</span>
          </li>
        </ul>
      </section>

      <section v-if="mayChange" class="mt-7">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          Konto freischalten
        </h3>
        <p class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          Den genauen Kontonamen eintragen. Groß- und Kleinschreibung ist egal.
        </p>

        <form class="mt-3 flex max-w-[420px] flex-col gap-3" @submit.prevent="add">
          <Field>
            <FieldLabel for="broadcast-sender-username">Kontoname</FieldLabel>
            <Input
              id="broadcast-sender-username"
              v-model="username"
              :maxlength="TEXT_LIMIT.releaseBroadcastSender.username.maxLength"
              autocomplete="off"
            />
          </Field>

          <div>
            <Button type="submit" size="sm" :disabled="isSaving || username.trim() === ''">
              Freischalten
            </Button>
          </div>
        </form>
      </section>

      <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
