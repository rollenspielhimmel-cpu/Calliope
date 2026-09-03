<script setup lang="ts">
/**
 * Warnings and suspensions for one member: what was decided before, and what the ladder would
 * suggest next.
 *
 * The suggestion is prefilled and never enforced — how heavily an incident weighs is a human
 * decision, so the severity, the action and the hours all stay editable, and going straight to a
 * suspension without a warning first is a normal thing to do rather than an override.
 */
import { computed, ref, watch } from 'vue'
import {
  getListStrikeHistoryQueryKey,
  getSuggestNextStrikeActionQueryKey,
  useIssueSuspension,
  useIssueWarning,
  useLiftSuspension,
  useListStrikeHistory,
  useSuggestNextStrikeAction,
} from '@/api/moderation/moderation'
import type { IssueWarningBody, ListStrikeHistory200Item } from '@/api/models'
import { queryClient } from '@/lib/api/queryClient'
import { formatActivityTime, formatUntil } from '@/lib/format/formatTime'
import {
  STRIKE_ACTION_LABELS,
  STRIKE_SEVERITIES,
  STRIKE_SEVERITY_LABELS,
  strikeSuggestion,
} from '@/lib/format/strike'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
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

type Severity = IssueWarningBody['severity']

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ userId: string; username: string }>()

const { data: historyData, isPending } = useListStrikeHistory(() => props.userId, {
  query: { enabled: open },
})

const { data: suggestionData } = useSuggestNextStrikeAction(() => props.userId, {
  query: { enabled: open },
})

const history = computed<ListStrikeHistory200Item[]>(() =>
  historyData.value?.status === 200 ? historyData.value.data : [],
)

const suggestion = computed(() =>
  suggestionData.value?.status === 200 ? suggestionData.value.data : undefined,
)

const suggestionText = computed<string | undefined>(() =>
  suggestion.value === undefined ? undefined : strikeSuggestion(suggestion.value),
)

const severity = ref<Severity>('borderline')
const reason = ref<string>('')
const hours = ref<number>(24)
const asSuspension = ref<boolean>(false)
const error = ref<string | undefined>(undefined)

/**
 * Filled from the suggestion each time it opens, never while somebody is typing into it.
 *
 * `immediate`, because a suggestion already in the cache when the dialog mounts open changes
 * neither of the two and would otherwise leave the form on its defaults.
 */
watch(
  [open, suggestion],
  () => {
    if (!open.value) return
    const next = suggestion.value
    if (next === undefined) return
    asSuspension.value = next.action === 'suspension'
    hours.value = next.suggestedHours ?? 24
  },
  { immediate: true },
)

watch(open, (isOpen) => {
  if (!isOpen) return
  reason.value = ''
  error.value = undefined
})

const { mutateAsync: warn, isPending: isWarning } = useIssueWarning()
const { mutateAsync: suspend, isPending: isSuspending } = useIssueSuspension()
const { mutateAsync: lift, isPending: isLifting } = useLiftSuspension()

const isBusy = computed<boolean>(() => isWarning.value || isSuspending.value || isLifting.value)

async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListStrikeHistoryQueryKey(props.userId) }),
    queryClient.invalidateQueries({ queryKey: getSuggestNextStrikeActionQueryKey(props.userId) }),
  ])
}

async function submit() {
  const note = reason.value.trim()
  if (note.length === 0) return

  error.value = undefined

  try {
    if (asSuspension.value) {
      await suspend({
        userId: props.userId,
        data: { severity: severity.value, reason: note, hours: hours.value },
      })
    } else {
      await warn({ userId: props.userId, data: { severity: severity.value, reason: note } })
    }
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  reason.value = ''
  await refresh()
}

async function liftSuspension() {
  error.value = undefined

  try {
    await lift({ userId: props.userId })
  } catch {
    error.value = 'Das ist gerade nicht möglich. Versuche es später noch einmal.'
    return
  }

  await refresh()
}

/** The suspension in force, if any — the newest one whose moment has not passed. */
const activeSuspension = computed<ListStrikeHistory200Item | undefined>(() =>
  history.value.find(
    (entry) =>
      entry.action === 'suspension' &&
      entry.suspendedUntil !== null &&
      new Date(entry.suspendedUntil) > new Date(),
  ),
)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>„{{ props.username }}“ — Verwarnungen und Sperrungen</DialogTitle>
        <DialogDescription v-if="suggestionText">
          {{ suggestionText }} Die Leiter ist ein Vorschlag, keine Regel.
        </DialogDescription>
      </DialogHeader>

      <div class="flex max-h-[60vh] flex-col gap-4 overflow-auto">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <p v-if="activeSuspension" class="text-note text-ink-5">
          Gesperrt bis
          {{ activeSuspension.suspendedUntil ? formatUntil(activeSuspension.suspendedUntil) : '' }}.
          <Button variant="ghost" size="xs" :disabled="isLifting" @click="liftSuspension">
            Sperrung aufheben
          </Button>
        </p>

        <form class="flex flex-col gap-3" @submit.prevent="submit">
          <FieldGroup>
            <Field>
              <FieldLabel for="strikeSeverity">Gewichtung</FieldLabel>
              <Select
                :model-value="severity"
                @update:model-value="(value) => (severity = value as Severity)"
              >
                <SelectTrigger id="strikeSeverity" class="w-full text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in STRIKE_SEVERITIES"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel for="strikeReason">Begründung</FieldLabel>
              <Textarea
                id="strikeReason"
                v-model="reason"
                :maxlength="TEXT_LIMIT.issueWarning.reason.maxLength"
                placeholder="Wofür, in einem Satz"
                rows="3"
              />
            </Field>
          </FieldGroup>

          <label class="flex items-center gap-2 text-[12.5px] text-ink-4">
            <input v-model="asSuspension" type="checkbox" class="size-4" />
            Als Sperrung eintragen, nicht nur als Verwarnung
          </label>

          <template v-if="asSuspension">
            <Field>
              <FieldLabel for="strikeHours">Dauer in Stunden</FieldLabel>
              <Input
                id="strikeHours"
                v-model.number="hours"
                type="number"
                min="1"
                :max="24 * 30"
                class="w-[120px]"
              />
            </Field>
            <!-- Said outright: unlike a ban, this text reaches the member at their next sign-in. -->
            <p class="text-[12px] text-ink-6">
              Die betroffene Person sieht bei der Anmeldung das Ende der Sperrung und diese
              Begründung im Klartext.
            </p>
          </template>

          <div>
            <Button type="submit" variant="outline" size="sm" :disabled="isBusy">
              <Spinner v-if="isBusy" />
              Eintragen
            </Button>
          </div>
        </form>

        <div class="border-t border-line-3 pt-3">
          <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
            <Spinner />
            Einen Moment.
          </div>

          <p v-else-if="history.length === 0" class="text-note text-ink-5">
            Für dieses Konto ist nichts eingetragen.
          </p>

          <ul v-else class="flex flex-col">
            <li
              v-for="entry in history"
              :key="entry.id"
              class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
            >
              <p class="text-row text-ink-2">
                {{ STRIKE_ACTION_LABELS[entry.action] }}
                <span class="text-ink-5">· {{ STRIKE_SEVERITY_LABELS[entry.severity] }}</span>
              </p>
              <p class="mt-1 text-[12.5px] text-ink-4">{{ entry.reason }}</p>
              <p class="mt-1 text-[12px] text-ink-6">
                {{ entry.issuedBy?.username ?? 'ein gelöschtes Konto' }},
                {{ formatActivityTime(entry.issuedAt) }}
                <template v-if="entry.suspendedUntil">
                  · bis {{ formatUntil(entry.suspendedUntil) }}
                </template>
              </p>
            </li>
          </ul>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
