<script setup lang="ts">
/**
 * Offizielle Forum-Threads in der Warteschlange und unter „Gesendete".
 *
 * Dieselben Regeln wie bei Rundmails, gezeigt wie dort: Freigeben nur die Administration;
 * bearbeiten und verwerfen die Administration alles, alle anderen nur das Eigene. Was jemand hier
 * überhaupt sieht, entscheidet das Backend (`visibleTo`) — die Liste zeigt, was es liefert.
 *
 * Bearbeitet werden Titel, Eröffnungsbeitrag und Termin. Absender, Unterforum und der Haken „nur
 * für die Administration" bleiben, wie sie eingereicht wurden; sie mitzuschicken hält sie fest.
 *
 * Eine Einreichung für einen Thread, der schon im Forum steht, tauscht nur den Namen am
 * Eröffnungsbeitrag. Da gibt es nichts zu bearbeiten: Titel und Text stehen fest, einen Termin hat
 * sie nicht. Sie steht mit einem Hinweis da und verlinkt den Thread, der ja schon zu lesen ist.
 */
import { computed, ref } from 'vue'
import {
  getListOfficialThreadQueueQueryKey,
  getListReleasedOfficialThreadsQueryKey,
  useApproveOfficialThread,
  useDiscardOfficialThread,
  useEditOfficialThread,
  useListOfficialThreadQueue,
  useListReleasedOfficialThreads,
} from '@/api/moderation/moderation'
import type { ListOfficialThreadQueue200Item } from '@/api/models'
import { useGetCurrentUser } from '@/api/auth/auth'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { berlinToUtc, formatBerlin, utcToBerlin } from '@/lib/format/berlinTime'
import { formatActivityTime } from '@/lib/format/formatTime'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{ mode: 'waiting' | 'released' }>()

type Entry = ListOfficialThreadQueue200Item

const { data: waitingData } = useListOfficialThreadQueue({
  query: { enabled: computed(() => props.mode === 'waiting') },
})
const { data: releasedData } = useListReleasedOfficialThreads({
  query: { enabled: computed(() => props.mode === 'released') },
})

const entries = computed<Entry[]>(() => {
  const source = props.mode === 'waiting' ? waitingData.value : releasedData.value
  return source?.status === 200 ? source.data : []
})

const { data: currentUser } = useGetCurrentUser()

const isAdministrator = computed<boolean>(
  () =>
    currentUser.value?.status === 200 && currentUser.value.data.platformRole === 'administrator',
)

/** Ohne Administration nur das Eigene — und beide Seiten brauchen eine Kennung. */
function mayChange(entry: Entry): boolean {
  if (isAdministrator.value) {
    return true
  }
  const ownId = currentUser.value?.status === 200 ? currentUser.value.data.id : undefined
  return ownId !== undefined && entry.writtenBy !== null && entry.writtenBy === ownId
}

const error = ref<string | undefined>(undefined)

async function refresh() {
  await queryClient.invalidateQueries({ queryKey: getListOfficialThreadQueueQueryKey() })
  await queryClient.invalidateQueries({ queryKey: getListReleasedOfficialThreadsQueryKey() })
}

const { mutateAsync: approveThread, isPending: isApproving } = useApproveOfficialThread()
const { mutateAsync: discardThread, isPending: isDiscarding } = useDiscardOfficialThread()
const { mutateAsync: editThread, isPending: isSaving } = useEditOfficialThread()

async function approve(entry: Entry) {
  error.value = undefined
  try {
    await approveThread({ publicationId: entry.publicationId })
  } catch (failure) {
    error.value = failureMessage(failure, 'Die Freigabe ging nicht durch.')
    return
  }
  await refresh()
}

async function discard(entry: Entry) {
  error.value = undefined
  try {
    await discardThread({ publicationId: entry.publicationId })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das Verwerfen ging nicht durch.')
    return
  }
  await refresh()
}

// ── Bearbeiten, am Eintrag ────────────────────────────────────────────────────────────────────

const editing = ref<string | undefined>(undefined)
const draftTitle = ref('')
const draftText = ref('')
const draftScheduled = ref('')

function startEditing(entry: Entry) {
  editing.value = entry.publicationId
  draftTitle.value = entry.title
  draftText.value = entry.text
  draftScheduled.value = entry.scheduledFor === null ? '' : utcToBerlin(entry.scheduledFor)
}

/** Bei der Administration folgt keine zweite Freigabe: Speichern ist freigeben. */
const saveLabel = computed<string>(() => {
  if (!isAdministrator.value) {
    return 'Speichern — wartet dann wieder auf Freigabe'
  }
  return draftScheduled.value === '' ? 'Speichern und veröffentlichen' : 'Speichern und freigeben'
})

async function save(entry: Entry) {
  error.value = undefined
  try {
    await editThread({
      publicationId: entry.publicationId,
      data: {
        title: draftTitle.value.trim(),
        text: draftText.value.trim(),
        folderId: entry.folderId,
        sendAsUserId: entry.sendAsUserId,
        scheduledFor: draftScheduled.value === '' ? null : berlinToUtc(draftScheduled.value),
        administrationOnly: entry.administrationOnly ?? false,
      },
    })
  } catch (failure) {
    error.value = failureMessage(failure, 'Das Speichern ging nicht durch.')
    return
  }
  editing.value = undefined
  await refresh()
}

function statusSentence(entry: Entry): string {
  if (entry.status === 'awaiting_approval') {
    return 'Wartet auf Freigabe'
  }
  if (entry.status === 'approved') {
    return entry.scheduledFor === null
      ? 'Freigegeben'
      : `Freigegeben · erscheint am ${formatBerlin(entry.scheduledFor)}`
  }
  return entry.releasedAt === null ? '' : `Erschienen ${formatActivityTime(entry.releasedAt)}`
}
</script>

<template>
  <section class="mt-8">
    <h2 class="font-serif text-h2 text-ink-1">Offizielle Threads</h2>

    <p v-if="entries.length === 0" class="mt-2 text-note text-ink-5">
      {{
        mode === 'waiting'
          ? 'Kein offizieller Thread wartet.'
          : 'Noch kein offizieller Thread erschienen.'
      }}
    </p>

    <ul v-else class="mt-3 flex flex-col">
      <li v-for="entry in entries" :key="entry.publicationId" class="border-b border-line-2 py-4">
        <template v-if="editing === entry.publicationId">
          <div class="flex max-w-[640px] flex-col gap-3">
            <Field>
              <FieldLabel :for="`official-title-${entry.publicationId}`">Titel</FieldLabel>
              <Input :id="`official-title-${entry.publicationId}`" v-model="draftTitle" />
            </Field>
            <Field>
              <FieldLabel :for="`official-text-${entry.publicationId}`"
                >Eröffnungsbeitrag</FieldLabel
              >
              <Textarea :id="`official-text-${entry.publicationId}`" v-model="draftText" rows="8" />
            </Field>
            <Field>
              <FieldLabel :for="`official-scheduled-${entry.publicationId}`"
                >Erscheint am <span class="text-ink-5">(optional)</span></FieldLabel
              >
              <Input
                :id="`official-scheduled-${entry.publicationId}`"
                v-model="draftScheduled"
                type="datetime-local"
                class="max-w-[260px]"
              />
            </Field>
            <div class="flex flex-wrap gap-2">
              <Button size="sm" :disabled="isSaving" @click="save(entry)">{{ saveLabel }}</Button>
              <Button variant="outline" size="sm" :disabled="isSaving" @click="editing = undefined">
                Abbrechen
              </Button>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="text-row text-ink-2">
            <RouterLink
              v-if="mode === 'released' || entry.forExistingThread"
              :to="{ name: 'forumThread', params: { threadId: entry.threadId } }"
              class="underline-offset-[5px] hover:underline"
              >{{ entry.title }}</RouterLink
            >
            <template v-else>{{ entry.title }}</template>
          </p>
          <p v-if="entry.forExistingThread" class="mt-0.5 text-[12px] text-ink-5">
            Steht schon im Forum · tauscht nur den Namen am Eröffnungsbeitrag
          </p>
          <p v-if="entry.administrationOnly" class="mt-0.5 text-[12px] text-ink-5">
            Nur für die Administration sichtbar
          </p>
          <p class="mt-1 max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-4">
            {{ entry.text }}
          </p>
          <p class="mt-2 text-[12px] text-ink-6">
            In {{ entry.folderTitle ?? 'der obersten Ebene' }} · Als
            {{ entry.sendAsUsername ?? 'Admin' }} · Von
            {{ entry.writtenByUsername ?? 'einem gelöschten Konto' }},
            {{ formatActivityTime(entry.writtenAt) }}
          </p>
          <p class="mt-1 text-[12px] text-ink-4">{{ statusSentence(entry) }}</p>

          <div v-if="mode === 'waiting'" class="mt-3 flex flex-wrap gap-2">
            <Button
              v-if="isAdministrator && entry.status === 'awaiting_approval'"
              size="sm"
              :disabled="isApproving || isDiscarding"
              @click="approve(entry)"
            >
              {{
                entry.forExistingThread
                  ? 'Freigeben und Namen tauschen'
                  : entry.scheduledFor === null
                    ? 'Freigeben und veröffentlichen'
                    : 'Freigeben'
              }}
            </Button>
            <Button
              v-if="mayChange(entry) && !entry.forExistingThread"
              variant="outline"
              size="sm"
              :disabled="isApproving || isDiscarding"
              @click="startEditing(entry)"
            >
              Bearbeiten
            </Button>
            <Button
              v-if="mayChange(entry)"
              variant="ghost"
              size="sm"
              :disabled="isApproving || isDiscarding"
              @click="discard(entry)"
            >
              Verwerfen
            </Button>
          </div>
        </template>
      </li>
    </ul>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </section>
</template>
