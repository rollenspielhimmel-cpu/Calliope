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
 */
import { computed, ref } from 'vue'
import {
  getListBroadcastSendersQueryKey,
  useListBroadcastSenders,
  useReleaseBroadcastSender,
  useWithdrawBroadcastSender,
} from '@/api/moderation/moderation'
import type { ListBroadcastSenders200Item } from '@/api/models'
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

const mayChange = computed(
  () => currentUser.value?.status === 200 && currentUser.value.data.isPrimordialAdmin,
)

const username = ref('')
const error = ref<string | undefined>(undefined)

const { mutateAsync: release, isPending: isReleasing } = useReleaseBroadcastSender()
const { mutateAsync: withdraw, isPending: isWithdrawing } = useWithdrawBroadcastSender()

const isSaving = computed(() => isReleasing.value || isWithdrawing.value)

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListBroadcastSendersQueryKey() })
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
    <p v-else class="mt-2 max-w-[70ch] text-[12.5px] text-ink-6">
      Freischalten kann nur der Ur-Admin. Fehlt dir hier ein Konto, frag dort nach.
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
