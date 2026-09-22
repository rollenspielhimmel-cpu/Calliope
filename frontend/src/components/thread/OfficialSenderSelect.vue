<script setup lang="ts">
/**
 * „Erscheint als": die Absender, unter denen diese Person offizielle Threads vorbereiten darf.
 *
 * Die Liste ist die der Rundmails und zeigt nur, was diese Person nutzen darf. Ist „Admin" nicht
 * dabei, ist der erste eigene Absender vorgewählt — sonst ginge die Einreichung mit einer Wahl
 * zurück, die niemand getroffen hat.
 */
import { computed, watch } from 'vue'
import { useListBroadcastSenders } from '@/api/moderation/moderation'
import type { ListBroadcastSenders200Item } from '@/api/models'
import { Field, FieldLabel } from '@/components/ui/field'

/** Leer heißt „Admin". */
const sendAs = defineModel<string>({ required: true })

defineProps<{ id: string }>()

const { data: senderData } = useListBroadcastSenders()

const senders = computed<ListBroadcastSenders200Item[]>(() =>
  senderData.value?.status === 200 ? senderData.value.data : [],
)

const permanentSender = computed(() => senders.value.find((sender) => sender.isPermanent))
const releasedSenders = computed(() => senders.value.filter((sender) => !sender.isPermanent))

// Ohne „Admin" in der eigenen Liste der erste eigene Absender — auch, wenn die Liste schon im
// Zwischenspeicher lag und sich deshalb nie „ändert".
watch(
  [permanentSender, releasedSenders],
  () => {
    if (sendAs.value === '' && permanentSender.value === undefined) {
      sendAs.value = releasedSenders.value[0]?.id ?? ''
    }
  },
  { immediate: true },
)
</script>

<template>
  <Field>
    <FieldLabel :for="id">Erscheint als</FieldLabel>
    <select
      :id="id"
      :value="sendAs"
      class="h-11 max-w-[320px] rounded-lg border border-input bg-transparent px-3 text-sm md:h-9"
      @change="sendAs = ($event.target as HTMLSelectElement).value"
    >
      <option v-if="permanentSender !== undefined" value="">
        {{ permanentSender.username }}
      </option>
      <option v-for="sender in releasedSenders" :key="sender.id" :value="sender.id">
        {{ sender.username }}
      </option>
    </select>
  </Field>
</template>
