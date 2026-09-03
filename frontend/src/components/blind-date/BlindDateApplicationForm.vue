<script setup lang="ts">
/**
 * The application form, for one of the offered plots or for a plot the member names themselves.
 *
 * Both routes through the same form: the only difference is whether the plot is filled in and
 * locked. A second form for the proactive case would be the same six fields with one of them
 * typed by hand, and two forms drift.
 *
 * The role is the one field that changes shape. Where the team named the roles of an offered plot,
 * this is a choice between them — the team knows its characters, and four people describing the
 * same role in four ways is not something a matching decision can be made from. Where it named
 * none, and for a proactive application, which has no list to choose from, it stays free text.
 */
import { computed, ref, watch } from 'vue'
import { useCreateBlindDateApplication } from '@/api/blind-date/blind-date'
import type { ListBlindDateOffers200Item } from '@/api/models'
import { failureMessage } from '@/lib/format/failure'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Button } from '@/components/ui/button'
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

const props = defineProps<{
  /** Set when applying to one of the team's offers; absent for a proactive application. */
  offer?: ListBlindDateOffers200Item
}>()

const emit = defineEmits<{ applied: []; cancel: [] }>()

/** The roles this offer names, or none — which is what decides the shape of the role field. */
const roles = computed<string[]>(() => props.offer?.roles ?? [])

const plotTitle = ref<string>(props.offer?.title ?? '')
const writingStyle = ref<string>('prose')
const postLength = ref<string>('medium')
const roleGender = ref<string>('')
const pairing = ref<string>('')
const note = ref<string>('')
const error = ref<string | undefined>(undefined)

// The plot follows the offer this was opened for. Not editable there: applying to an offer means
// that plot, and a changed title would leave the team matching two different things.
//
// The role is cleared along with it, because a role belongs to the plot it was named for: carrying
// „Die Wirtin" across to another offer would submit a role that offer does not have.
watch(
  () => props.offer,
  (offer) => {
    if (offer !== undefined) plotTitle.value = offer.title
    roleGender.value = ''
  },
)

const STYLES = [
  { value: 'prose', label: 'Roman' },
  { value: 'asterisk', label: 'Sternchen' },
]

const LENGTHS = [
  { value: 'short', label: 'Kurz' },
  { value: 'medium', label: 'Mittel' },
  { value: 'long', label: 'Lang' },
]

const complete = computed<boolean>(
  () =>
    plotTitle.value.trim() !== '' && roleGender.value.trim() !== '' && pairing.value.trim() !== '',
)

const { mutateAsync: apply, isPending } = useCreateBlindDateApplication()

async function submit() {
  if (!complete.value) return

  error.value = undefined

  try {
    await apply({
      data: {
        offerId: props.offer?.id ?? null,
        plotTitle: plotTitle.value.trim(),
        writingStyle: writingStyle.value as 'prose' | 'asterisk',
        postLength: postLength.value as 'short' | 'medium' | 'long',
        roleGender: roleGender.value.trim(),
        pairing: pairing.value.trim(),
        ...(note.value.trim() === '' ? {} : { note: note.value.trim() }),
      },
    })
  } catch (failure) {
    error.value = failureMessage(
      failure,
      'Die Bewerbung ist nicht durchgegangen. Versuche es später noch einmal.',
    )
    return
  }

  emit('applied')
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <FieldGroup>
      <Field>
        <FieldLabel for="blindDatePlot">Handlung</FieldLabel>
        <Input
          id="blindDatePlot"
          v-model="plotTitle"
          :readonly="offer !== undefined"
          :maxlength="TEXT_LIMIT.createBlindDateApplication.plotTitle.maxLength"
          placeholder="Titel einer offiziellen RSH-Handlung"
          class="max-w-[420px]"
        />
        <p class="text-control text-ink-5">
          <template v-if="offer">Du bewirbst dich auf diese angebotene Handlung.</template>
          <template v-else>
            Nenne eine offizielle RSH-Handlung, in der du schreiben möchtest.
          </template>
        </p>
      </Field>

      <Field>
        <FieldLabel for="blindDateStyle">Schreibweise</FieldLabel>
        <Select
          :model-value="writingStyle"
          @update:model-value="(value) => (writingStyle = String(value ?? 'prose'))"
        >
          <SelectTrigger id="blindDateStyle" class="w-full max-w-[260px] text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="style in STYLES" :key="style.value" :value="style.value">
              {{ style.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel for="blindDateLength">Postlänge</FieldLabel>
        <Select
          :model-value="postLength"
          @update:model-value="(value) => (postLength = String(value ?? 'medium'))"
        >
          <SelectTrigger id="blindDateLength" class="w-full max-w-[260px] text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="length in LENGTHS" :key="length.value" :value="length.value">
              {{ length.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field v-if="roles.length > 0">
        <FieldLabel for="blindDateRole">Rolle</FieldLabel>
        <Select
          :model-value="roleGender"
          @update:model-value="(value) => (roleGender = String(value ?? ''))"
        >
          <SelectTrigger id="blindDateRole" class="w-full max-w-[420px] text-[12.5px]">
            <SelectValue placeholder="Rolle wählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="role in roles" :key="role" :value="role">{{ role }}</SelectItem>
          </SelectContent>
        </Select>
        <p class="text-control text-ink-5">
          Die Rollen dieser Handlung, wie das Team sie angelegt hat.
        </p>
      </Field>

      <Field v-else>
        <FieldLabel for="blindDateRole">Geschlecht deiner Rolle</FieldLabel>
        <Input
          id="blindDateRole"
          v-model="roleGender"
          :maxlength="TEXT_LIMIT.createBlindDateApplication.roleGender.maxLength"
          placeholder="z.B. weiblich, männlich, egal"
          class="max-w-[420px]"
        />
      </Field>

      <Field>
        <FieldLabel for="blindDatePairing">Pairing</FieldLabel>
        <Input
          id="blindDatePairing"
          v-model="pairing"
          :maxlength="TEXT_LIMIT.createBlindDateApplication.pairing.maxLength"
          placeholder="Was du dir vorstellst — oder „offen“"
          class="max-w-[420px]"
        />
      </Field>

      <Field>
        <FieldLabel for="blindDateNote">Sonstiges, optional</FieldLabel>
        <Textarea
          id="blindDateNote"
          v-model="note"
          :maxlength="TEXT_LIMIT.createBlindDateApplication.note.maxLength"
          placeholder="Was das Team sonst noch wissen sollte"
          class="max-w-[70ch]"
          rows="3"
        />
        <p class="text-control text-ink-5">
          Liest nur das Team. Deine Schreibpartnerin oder dein Schreibpartner sieht das nicht.
        </p>
      </Field>
    </FieldGroup>

    <p v-if="error" class="text-[12.5px] text-destructive" role="alert">{{ error }}</p>

    <div class="flex flex-wrap items-center gap-3">
      <Button type="submit" :disabled="isPending || !complete">
        <Spinner v-if="isPending" />
        Bewerbung abschicken
      </Button>
      <Button type="button" variant="ghost" size="sm" @click="emit('cancel')">Abbrechen</Button>
    </div>
  </form>
</template>
