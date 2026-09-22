<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useForm } from '@tanstack/vue-form'
import { useQueryClient } from '@tanstack/vue-query'
import {
  getGetThreadQueryKey,
  getListThreadsQueryKey,
  useCreateThread,
  useUpdateThread,
} from '@/api/threads/threads'
import type { GetThread200, PostDocument } from '@/api/models'
import { TEXT_LIMIT } from '@/api/textLimit'
import { getListForumThreadsQueryKey, useCreateForumThread } from '@/api/forum/forum'
import {
  getListOfficialThreadQueueQueryKey,
  useSubmitOfficialThread,
} from '@/api/moderation/moderation'
import { useGetCurrentUser } from '@/api/auth/auth'
import { berlinToUtc, formatBerlin } from '@/lib/format/berlinTime'
import OfficialThreadFields from '@/components/thread/OfficialThreadFields.vue'
import type { OfficialDraft } from '@/components/thread/OfficialThreadFields.vue'
import { exactKeyFilter } from '@/lib/api/queryKeys'
import type { WriteScope } from '@/lib/folder/treeScope'
import { failureMessage } from '@/lib/format/failure'
import {
  firstMessage,
  focusFirstInvalid,
  parsed,
  postSchema,
  titleSchema,
} from '@/lib/validation/fieldSchemas'
import { emptyDocument } from '@/lib/document/emptyDocument'
import PostEditor from '@/components/thread/PostEditor.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import FormTextField from '@/components/common/FormTextField.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'

/**
 * One dialog for both verbs: an absent `thread` means creating. Two components would share
 * everything but the mutation, which is how the group dialogs drifted.
 */
const props = defineProps<{
  /**
   * Which tree this thread joins. A thema means the same thing in a writing group and in the
   * public forum (#32), so the copy below is written once and the scope branches around it.
   */
  scope: WriteScope
  /** Renaming, which is a group's for now: the forum's rename arrives with its moderation. */
  thread?: GetThread200
  /** Absent creates at the root of the tree, which in the forum only an operator may write to. */
  folderId?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [threadId: string] }>()

const queryClient = useQueryClient()

const renaming = computed<boolean>(() => props.thread !== undefined)

const LIMIT = props.scope.kind === 'forum' ? TEXT_LIMIT.createForumThread : TEXT_LIMIT.createThread

/**
 * Said where it is decided, not in the tree afterwards: a leaf with no folder above it is
 * clamped to `read` for members, and no setting on the row itself can lift that.
 */
const ROOT_NOTE =
  'Ohne Ordner liegt das Thema oben im Forum — Mitglieder können es dann lesen, aber nicht beantworten.'

/** Only an operator is offered the root, so the note is theirs. */
const atForumRoot = computed<boolean>(
  () => props.scope.kind === 'forum' && props.folderId === undefined,
)

const TITLE = titleSchema(LIMIT.title, 'Gib dem Thema einen Titel.')

// ── Der erste Beitrag ─────────────────────────────────────────────────────────────────────────

/**
 * **Ein Thema entsteht mit seinem ersten Beitrag**, nicht als leere Überschrift.
 *
 * Auf der Beta sind mehrere Themen ohne einen einzigen Beitrag entstanden: Den Text schrieb man
 * erst in der Ansicht dahinter, und dass das der Ort dafür ist, sah niemand. Beim offiziellen
 * Thread stand das Feld von Anfang an im Dialog — dieselbe Selbstverständlichkeit gilt hier.
 *
 * Nur im Forum: In einer Gruppe entsteht ein Thema weiter ohne Beitrag, das ist nicht dieser Umbau.
 */
const asksForFirstPost = computed<boolean>(
  () => props.scope.kind === 'forum' && !renaming.value && !goesOfficial.value,
)

const FIRST_POST = postSchema(TEXT_LIMIT.createForumPost.document, 'Schreib den ersten Beitrag.')

const firstPost = ref<PostDocument>(emptyDocument())
const firstPostText = ref<string>('')

const formError = ref<string | undefined>(undefined)
const formElement = ref<HTMLFormElement | null>(null)

// ── Offizieller Thread ────────────────────────────────────────────────────────────────────────

const { data: currentUser } = useGetCurrentUser()

/** Nur im Forum, nur beim Anlegen, und nur für wen vorbereiten darf. */
const offersOfficial = computed<boolean>(
  () =>
    props.scope.kind === 'forum' &&
    !renaming.value &&
    currentUser.value?.status === 200 &&
    currentUser.value.data.mayPreparePublications,
)

const isAdministrator = computed<boolean>(
  () =>
    currentUser.value?.status === 200 && currentUser.value.data.platformRole === 'administrator',
)

function emptyDraft(): OfficialDraft {
  return { enabled: false, text: '', sendAs: '', scheduledFor: '', administrationOnly: false }
}

const official = ref<OfficialDraft>(emptyDraft())
const goesOfficial = computed<boolean>(() => offersOfficial.value && official.value.enabled)

/**
 * Was nach dem Einreichen geschah, als Satz — aus der Antwort, nicht aus der eigenen Rolle.
 * Solange er dasteht, ersetzt er das Formular.
 */
const officialOutcome = ref<string | undefined>(undefined)

/** Der Knopf sagt, was geschieht: Bei der Administration folgt keine zweite Freigabe mehr. */
const submitLabel = computed<string>(() => {
  if (renaming.value) {
    return 'Änderungen speichern'
  }
  if (!goesOfficial.value) {
    return 'Thema anlegen'
  }
  if (!isAdministrator.value) {
    return 'Zur Freigabe einreichen'
  }
  return official.value.scheduledFor === '' ? 'Jetzt veröffentlichen' : 'Freigeben'
})

const { mutateAsync: submitOfficialThread, isPending: isSubmittingOfficial } =
  useSubmitOfficialThread()

async function submitOfficial(title: string) {
  const text = official.value.text.trim()
  if (text === '') {
    formError.value = 'Schreib den Eröffnungsbeitrag. Er wird mit dem Titel zusammen freigegeben.'
    return
  }

  let answer
  try {
    answer = await submitOfficialThread({
      data: {
        title,
        text,
        folderId: props.folderId ?? null,
        sendAsUserId: official.value.sendAs === '' ? null : official.value.sendAs,
        scheduledFor:
          official.value.scheduledFor === '' ? null : berlinToUtc(official.value.scheduledFor),
        administrationOnly: official.value.administrationOnly,
      },
    })
  } catch (error) {
    formError.value = failureMessage(
      error,
      'Der Thread konnte nicht eingereicht werden. Versuche es noch einmal.',
    )
    return
  }

  await queryClient.invalidateQueries({ queryKey: getListOfficialThreadQueueQueryKey() })

  if (answer.status !== 201) {
    return
  }

  // Erschienen: wie ein gewöhnliches Thema — die Liste neu, und der Aufrufer öffnet ihn.
  if (answer.data.status === 'released') {
    await queryClient.invalidateQueries(exactKeyFilter(getListForumThreadsQueryKey()))
    open.value = false
    emit('created', answer.data.threadId)
    return
  }

  officialOutcome.value =
    answer.data.status === 'approved'
      ? `Freigegeben. Er erscheint am ${formatBerlin(answer.data.scheduledFor ?? '')} von selbst — bis dahin steht er in der Warteschlange.`
      : 'Eingereicht. Er steht in der Warteschlange und erscheint, sobald die Administration ihn freigibt.'
}

const { mutateAsync: createThread, isPending: isCreatingInGroup } = useCreateThread()
const { mutateAsync: createForumThread, isPending: isCreatingInForum } = useCreateForumThread()
const isCreating = computed<boolean>(() => isCreatingInGroup.value || isCreatingInForum.value)
const { mutateAsync: updateThread, isPending: isRenaming } = useUpdateThread()
const isPending = computed<boolean>(
  () => isCreating.value || isRenaming.value || isSubmittingOfficial.value,
)

const form = useForm({
  defaultValues: { title: '' },
  onSubmitInvalid: () => focusFirstInvalid(formElement.value),
  onSubmit: async ({ value }) => {
    formError.value = undefined
    const title = parsed(TITLE, value.title)

    if (props.thread !== undefined && props.scope.kind === 'group') {
      const { groupId } = props.scope
      try {
        await updateThread({ groupId, threadId: props.thread.id, data: { title } })
      } catch (error) {
        formError.value = failureMessage(
          error,
          'Das Thema konnte nicht umbenannt werden. Versuche es noch einmal.',
        )
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getGetThreadQueryKey(groupId, props.thread.id),
        }),
        queryClient.invalidateQueries(exactKeyFilter(getListThreadsQueryKey(groupId))),
      ])
      open.value = false
      return
    }

    if (goesOfficial.value) {
      await submitOfficial(title)
      return
    }

    if (asksForFirstPost.value) {
      formError.value = firstMessage(FIRST_POST.safeParse(firstPostText.value))
      if (formError.value !== undefined) {
        return
      }
    }

    const data = {
      title,
      folderId: props.folderId,
      ...(asksForFirstPost.value ? { document: firstPost.value } : {}),
    }

    let created
    try {
      created =
        props.scope.kind === 'forum'
          ? await createForumThread({ data })
          : await createThread({ groupId: props.scope.groupId, data })
    } catch (error) {
      formError.value = failureMessage(
        error,
        'Das Thema konnte nicht angelegt werden. Versuche es noch einmal.',
      )
      return
    }

    await queryClient.invalidateQueries(
      props.scope.kind === 'forum'
        ? exactKeyFilter(getListForumThreadsQueryKey())
        : exactKeyFilter(getListThreadsQueryKey(props.scope.groupId)),
    )
    open.value = false

    // Where to go afterwards belongs to the caller: the group opens the new thread, and a
    // rename leaves the reader where they were.
    if (created.status === 201) {
      emit('created', created.data.id)
    }
  },
})

// Opening fills the field from the thread being renamed; closing clears it either way.
watch(open, (isOpen) => {
  formError.value = undefined
  official.value = emptyDraft()
  officialOutcome.value = undefined
  firstPost.value = emptyDocument()
  firstPostText.value = ''
  form.reset({ title: isOpen ? (props.thread?.title ?? '') : '' })
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-dialog-form">
      <DialogHeader>
        <DialogTitle>{{ renaming ? 'Thema umbenennen' : 'Thema anlegen' }}</DialogTitle>
        <DialogDescription>
          Viele Beiträge, einer nach dem anderen — zum Erzählen, Planen und Besprechen. Jeder
          Beitrag gehört dem, der ihn geschrieben hat. Für einen Text, den ihr gemeinsam pflegt,
          nimm eine Seite.
        </DialogDescription>
      </DialogHeader>

      <!-- A quiet note rather than an Alert: it is context for the whole dialog, not a failure,
           and only an operator can open this at the root, so it is addressed to them. -->
      <p v-if="atForumRoot" class="text-note text-ink-5">{{ ROOT_NOTE }}</p>

      <!-- Nach dem Einreichen eines offiziellen Threads: was geschah, statt des Formulars. -->
      <template v-if="officialOutcome">
        <p class="text-row text-ink-2" role="status">{{ officialOutcome }}</p>
        <DialogFooter>
          <Button type="button" @click="open = false">Schließen</Button>
        </DialogFooter>
      </template>

      <form
        v-else
        ref="formElement"
        class="flex flex-col gap-5"
        novalidate
        @submit.prevent="form.handleSubmit()"
      >
        <Alert v-if="formError" variant="destructive" role="alert">
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <FieldGroup>
          <form.Field name="title" :validators="{ onSubmit: TITLE }">
            <template v-slot="{ field }">
              <FormTextField
                id="thread-title"
                :field="field"
                label="Titel"
                :maxlength="LIMIT.title.maxLength"
                placeholder="z. B. Plot oder Steckbriefe"
                required
              />
            </template>
          </form.Field>
        </FieldGroup>

        <!-- Der erste Beitrag steht hier, wo das Thema entsteht. Geht es als offizieller Thread
             online, schreibt man ihn stattdessen in dessen eigenem Feld. -->
        <Field v-if="asksForFirstPost">
          <FieldLabel>Erster Beitrag</FieldLabel>
          <PostEditor
            v-model:document="firstPost"
            v-model:text="firstPostText"
            :disabled="isPending"
            framed
          />
        </Field>

        <OfficialThreadFields v-if="offersOfficial" v-model="official" />

        <DialogFooter>
          <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
            Abbrechen
          </Button>
          <Button type="submit" :disabled="isPending">
            <Spinner v-if="isPending" />
            {{ submitLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
