<script setup lang="ts">
/**
 * Narrowing one thread, or letting it go again.
 *
 * „Wie das Abteil" is `null`, not a fifth level: a thread either carries a setting of its own or
 * follows the sub-forum it sits in. Naming it that way is what keeps somebody from reading the
 * inherited value as a choice they made.
 *
 * The choices stop at this account's own reach, which is the rule the API applies too — nobody may
 * hide a thread from themselves, because they could then not bring it back. Offering the option
 * and letting the request fail would be telling somebody they may do something and then refusing.
 */
import { computed, ref, watch } from 'vue'
import { getGetForumThreadQueryKey, useSetForumThreadVisibility } from '@/api/forum/forum'
import { useGetCurrentUser } from '@/api/auth/auth'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { FORUM_VISIBILITY_LABELS, reachableVisibilities } from '@/lib/format/forumVisibility'
import type { ForumVisibility } from '@/lib/format/forumVisibility'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

/** The one value that is not a visibility, because `null` cannot be a `SelectItem`'s value. */
const INHERIT = 'inherit'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  threadId: string
  title: string
  /** The thread's own setting, or null where it follows its sub-forum. */
  visibility: ForumVisibility | null
  /** What the thread is actually read at: the stricter of its own and its sub-forum's. */
  effectiveVisibility: ForumVisibility
}>()

const { data: currentUserData } = useGetCurrentUser()

const choices = computed<Array<{ value: string; label: string }>>(() => [
  {
    value: INHERIT,
    label: `Wie das Abteil (${FORUM_VISIBILITY_LABELS[props.effectiveVisibility]})`,
  },
  ...reachableVisibilities(
    currentUserData.value?.status === 200 ? currentUserData.value.data.platformRole : null,
  ).map((visibility) => ({ value: visibility, label: FORUM_VISIBILITY_LABELS[visibility] })),
])

const chosen = ref<string>(INHERIT)
const error = ref<string | undefined>(undefined)

watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    chosen.value = props.visibility ?? INHERIT
    error.value = undefined
  },
  { immediate: true },
)

const { mutateAsync: setVisibility, isPending } = useSetForumThreadVisibility()

async function confirm() {
  error.value = undefined

  try {
    await setVisibility({
      threadId: props.threadId,
      data: { visibility: chosen.value === INHERIT ? null : (chosen.value as ForumVisibility) },
    })
  } catch (failure) {
    error.value = failureMessage(
      failure,
      'Die Sichtbarkeit konnte nicht gespeichert werden. Versuche es noch einmal.',
    )
    return
  }

  await queryClient.invalidateQueries({
    queryKey: getGetForumThreadQueryKey(props.threadId),
  })
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>Wer liest „{{ props.title }}“?</DialogTitle>
        <DialogDescription>
          Es gilt immer die engere der beiden Einstellungen — die des Themas und die des Abteils.
          Ein Thema lässt sich also verstecken, aber nicht weiter öffnen als sein Abteil.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-note text-ink-4">
        <Alert v-if="error" variant="destructive" role="alert">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <FieldGroup>
          <Field>
            <FieldLabel for="threadVisibility">Sichtbar für</FieldLabel>
            <Select
              :model-value="chosen"
              @update:model-value="(value) => (chosen = String(value ?? INHERIT))"
            >
              <SelectTrigger id="threadVisibility" class="w-full text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="choice in choices" :key="choice.value" :value="choice.value">
                  {{ choice.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          Abbrechen
        </Button>
        <Button type="button" :disabled="isPending" @click="confirm">
          <Spinner v-if="isPending" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
