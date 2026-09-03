<script setup lang="ts">
import { ref, useTemplateRef, watch } from 'vue'
import { Plus } from '@lucide/vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getListChatMembershipsQueryKey, useInviteToChat } from '@/api/chats/chats'
import type { ListUsers200ResultsItem } from '@/api/models'
import { ApiError } from '@/lib/api/apiFetch'
import { listKeyPrefix } from '@/lib/api/queryKeys'
import { Alert, AlertDescription } from '@/components/ui/alert'
import UserPicker from '@/components/user/UserPicker.vue'

const props = defineProps<{ chatGroupId: string; memberIds: string[] }>()

const queryClient = useQueryClient()

const picker = useTemplateRef('picker')
const open = ref<boolean>(false)
const formError = ref<string | undefined>(undefined)

// A different conversation is a different invitation.
watch(
  () => props.chatGroupId,
  () => {
    open.value = false
    picker.value?.reset()
    formError.value = undefined
  },
)

const { mutateAsync: inviteToChat, isPending } = useInviteToChat()

async function invite(user: ListUsers200ResultsItem) {
  formError.value = undefined

  try {
    await inviteToChat({ chatId: props.chatGroupId, data: { userId: user.id } })
  } catch (error) {
    // 403 is final, so it must not read as "try again". It is deliberately the same sentence for
    // every reason the API refuses contact — a block, a ban, or a Blind-Date running between these
    // two — because a message that told them apart would say which one applies, and for the last
    // of the three that would name somebody's Blind-Date partner outright.
    //
    // The partner cannot be filtered out of the picker instead: doing so would mean telling this
    // browser who they are, which is the one thing the whole feature holds back.
    formError.value =
      error instanceof ApiError && error.status === 409
        ? `${user.username} ist schon eingeladen oder schon dabei.`
        : error instanceof ApiError && error.status === 403
          ? `Mit ${user.username} ist zurzeit kein Chat möglich.`
          : 'Die Einladung wurde nicht verschickt. Versuche es noch einmal.'
    return
  }

  picker.value?.reset()
  open.value = false
  await queryClient.invalidateQueries({
    queryKey: listKeyPrefix(getListChatMembershipsQueryKey(props.chatGroupId)),
  })
}
</script>

<template>
  <div>
    <button
      type="button"
      class="flex min-h-11 items-center gap-1.5 text-[12.5px] text-ink-5 hover:text-oak-deep md:min-h-0"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Plus :size="14" :stroke-width="1.5" aria-hidden="true" />
      Einladen
    </button>

    <div v-if="open" class="mt-2">
      <Alert v-if="formError" variant="destructive" role="alert" class="mb-2">
        <AlertDescription>{{ formError }}</AlertDescription>
      </Alert>

      <!-- No v-model: a pick here is the invitation, so nothing stays selected afterwards. -->
      <UserPicker ref="picker" :exclude-ids="memberIds" :disabled="isPending" @pick="invite" />
    </div>
  </div>
</template>
