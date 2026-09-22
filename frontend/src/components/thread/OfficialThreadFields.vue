<script setup lang="ts">
/**
 * Der Haken „geht online als offizieller RSH-Thread" und was dazugehört: Absender, Termin,
 * Eröffnungsbeitrag — und für die Administration „nur für die Administration sichtbar".
 *
 * Eingebunden in den Dialog, der ein Forum-Thema anlegt, und nur für wen vorbereiten darf. Was
 * hier steht, geht an `submitOfficialThread` und nicht an die gewöhnliche Anlage: Ein offizieller
 * Thread wird mit seinem Eröffnungsbeitrag auf einmal geschrieben, weil die Freigabe den Text
 * abdecken muss.
 *
 * Die Absenderliste steht in `OfficialSenderSelect`, die auch „Offiziell machen" nutzt.
 */
import { computed } from 'vue'
import { useGetCurrentUser } from '@/api/auth/auth'
import OfficialSenderSelect from '@/components/thread/OfficialSenderSelect.vue'
import { TEXT_LIMIT } from '@/api/textLimit'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export type OfficialDraft = {
  enabled: boolean
  text: string
  /** Leer heißt „Admin". */
  sendAs: string
  /** Wie eingetippt, in Berliner Zeit; leer heißt „sobald freigegeben". */
  scheduledFor: string
  administrationOnly: boolean
}

const draft = defineModel<OfficialDraft>({ required: true })

const { data: currentUser } = useGetCurrentUser()

const isAdministrator = computed<boolean>(
  () =>
    currentUser.value?.status === 200 && currentUser.value.data.platformRole === 'administrator',
)

function update<Key extends keyof OfficialDraft>(key: Key, value: OfficialDraft[Key]) {
  draft.value = { ...draft.value, [key]: value }
}
</script>

<template>
  <div class="flex flex-col gap-4 rounded-lg border border-line-3 p-3">
    <label class="flex min-h-11 items-center gap-2.5 text-row text-ink-2 md:min-h-0">
      <Checkbox
        :model-value="draft.enabled"
        @update:model-value="(on) => update('enabled', on === true)"
      />
      Geht online als offizieller RSH-Thread
    </label>

    <template v-if="draft.enabled">
      <p class="max-w-[62ch] text-control text-ink-5">
        Er erscheint unter dem Absender, nicht unter deinem Namen; wer ihn geschrieben hat, bleibt
        intern festgehalten. Bis zu seinem Erscheinen steht er nur in der Warteschlange.
        <template v-if="!isAdministrator"
          >Veröffentlicht wird er, wenn die Administration ihn freigibt.</template
        >
      </p>

      <OfficialSenderSelect
        id="official-sender"
        :model-value="draft.sendAs"
        @update:model-value="(value) => update('sendAs', value)"
      />

      <Field>
        <FieldLabel for="official-text">Eröffnungsbeitrag</FieldLabel>
        <Textarea
          id="official-text"
          :model-value="draft.text"
          :maxlength="TEXT_LIMIT.submitOfficialThread.text.maxLength"
          rows="8"
          @update:model-value="(value) => update('text', String(value))"
        />
        <p class="text-control text-ink-5">
          Reiner Text, wie bei Rundmails. Er wird mit dem Titel zusammen freigegeben.
        </p>
      </Field>

      <Field>
        <FieldLabel for="official-scheduled"
          >Erscheint am <span class="text-ink-5">(optional)</span></FieldLabel
        >
        <Input
          id="official-scheduled"
          type="datetime-local"
          :model-value="draft.scheduledFor"
          class="max-w-[260px]"
          @update:model-value="(value) => update('scheduledFor', String(value))"
        />
        <p class="text-control text-ink-5">
          Ohne Termin erscheint er, sobald er freigegeben ist. Der Termin allein veröffentlicht
          nichts.
        </p>
      </Field>

      <label
        v-if="isAdministrator"
        class="flex min-h-11 items-center gap-2.5 text-row text-ink-2 md:min-h-0"
      >
        <Checkbox
          :model-value="draft.administrationOnly"
          @update:model-value="(on) => update('administrationOnly', on === true)"
        />
        Nur für die Administration sichtbar
      </label>
      <p v-if="isAdministrator" class="-mt-3 max-w-[62ch] text-control text-ink-5">
        Versteckt die Vorbereitung in der Warteschlange vor allen ohne Administration. Den Thread
        selbst versteckt es nicht: Er erscheint im Forum wie jeder andere.
      </p>
    </template>
  </div>
</template>
