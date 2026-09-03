<script setup lang="ts">
/**
 * The reveal, where the two people it concerns actually are: in their group.
 *
 * **Both, or neither.** Each says yes for themselves, and either can take it back while the other
 * has not answered — so the panel has three things to say, and only three: you have not decided,
 * you have and are waiting, or the other is waiting on you.
 *
 * The last of those is the one that matters most and the easiest to get wrong. „Die andere Person
 * möchte" is not a nudge and must not read as one: it is a fact somebody is entitled to know
 * before they answer, and the wording stays flat on purpose.
 *
 * It says out loud that revealing does **not** publish the group, because that is the fear that
 * would otherwise stop people — and it happens to be true.
 *
 * Before fifty posts in the RPG thread the button is there but shut, and the panel says how many
 * are still missing rather than only greying out. A disabled control with no reason attached is
 * read as a fault in the page; a number is read as a rule, and this one is easy to agree with.
 *
 * **And the way out.** Either of them may end it alone, unlike revealing — staying is not something
 * either of them owes, and a way out that needed the other person to agree would depend on the very
 * person one might be trying to get away from. It asks once before it does it, because it cannot be
 * undone; it is a plain control rather than a destructive-looking one, because leaving is an
 * ordinary thing to do and nothing is destroyed by it.
 */
import { computed, ref } from 'vue'
import {
  getGetOwnBlindDateQueryKey,
  getGetPendingBlindDateFeedbackQueryKey,
  useAgreeToBlindDateReveal,
  useEndOwnBlindDate,
  useGetOwnBlindDate,
  useWithdrawBlindDateRevealConsent,
} from '@/api/blind-date/blind-date'
import { getGetGroupQueryKey } from '@/api/groups/groups'
import { queryClient } from '@/lib/api/queryClient'
import { failureMessage } from '@/lib/format/failure'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const props = defineProps<{ groupId: string }>()

const { data } = useGetOwnBlindDate()

/** Only for *this* group: somebody may have a Blind-Date elsewhere and be reading a normal one. */
const blindDate = computed(() =>
  data.value?.status === 200 && data.value.data.writingGroupId === props.groupId
    ? data.value.data
    : undefined,
)

/** How many posts are still missing, or zero once the two may ask. */
const postsMissing = computed<number>(() =>
  blindDate.value === undefined
    ? 0
    : Math.max(0, blindDate.value.postsBeforeReveal - blindDate.value.rpgPosts),
)

const error = ref<string | undefined>(undefined)

const { mutateAsync: agree, isPending: isAgreeing } = useAgreeToBlindDateReveal()
const { mutateAsync: takeBack, isPending: isWithdrawing } = useWithdrawBlindDateRevealConsent()

async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetOwnBlindDateQueryKey() }),
    // The group itself, because the second yes changes how every name in it is read.
    queryClient.invalidateQueries({ queryKey: getGetGroupQueryKey(props.groupId) }),
  ])
}

async function sayYes() {
  error.value = undefined

  try {
    await agree()
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  await refresh()
}

const { mutateAsync: endIt, isPending: isEnding } = useEndOwnBlindDate()

/** Asked once, because it cannot be taken back. */
const confirmingEnd = ref<boolean>(false)

async function endBlindDate() {
  error.value = undefined

  try {
    await endIt()
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  confirmingEnd.value = false
  await refresh()
  // The three questions follow immediately, so the page that asks them has to know.
  await queryClient.invalidateQueries({
    queryKey: getGetPendingBlindDateFeedbackQueryKey(),
  })
}

async function sayNotYet() {
  error.value = undefined

  try {
    await takeBack()
  } catch (failure) {
    error.value = failureMessage(failure)
    return
  }

  await refresh()
}
</script>

<template>
  <section v-if="blindDate" class="rounded-lg border border-line-3 bg-paper-0 p-4 shadow-card">
    <p class="text-h2 text-ink-1">Blind-Date</p>

    <p class="mt-1.5 max-w-[65ch] text-note text-ink-4">
      <template v-if="blindDate.iAgreed">
        Du möchtest euch zu erkennen geben. Sobald die andere Person das auch möchte, seht ihr
        beide, mit wem ihr schreibt.
      </template>
      <template v-else-if="blindDate.otherAgreed">
        Die andere Person möchte sich zu erkennen geben. Es passiert erst, wenn du es auch möchtest.
      </template>
      <template v-else>
        Ihr schreibt anonym. Wenn ihr beide wollt, gebt ihr euch zu erkennen — vorher passiert
        nichts.
      </template>
    </p>

    <!-- Said as a number, not as a greyed-out button on its own: a disabled control with no
         reason attached reads as a fault in the page. Counted on the RPG-Thread alone, which is
         the sentence that keeps somebody from trying to talk their way there. -->
    <p v-if="!blindDate.mayReveal" class="mt-2 max-w-[65ch] text-note text-ink-4">
      Noch {{ postsMissing }} {{ postsMissing === 1 ? 'Beitrag' : 'Beiträge' }} im RPG-Thread, bis
      ihr euch zu erkennen geben könnt. Die anderen Threads zählen dafür nicht.
    </p>

    <!-- The fear that would otherwise stop people, answered before it is asked. -->
    <p class="mt-2 max-w-[65ch] text-[12.5px] leading-[1.5] text-ink-5">
      Danach steht bei allen Beiträgen euer richtiger Name — auch bei den bisherigen. Die Gruppe
      bleibt privat: ob ihr das Geschriebene öffentlich macht, entscheidet ihr selbst und getrennt
      davon.
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-3">
      <Button
        v-if="!blindDate.iAgreed"
        :disabled="isAgreeing || !blindDate.mayReveal"
        @click="sayYes"
      >
        <Spinner v-if="isAgreeing" />
        Ich möchte mich zu erkennen geben
      </Button>

      <Button v-else variant="ghost" size="sm" :disabled="isWithdrawing" @click="sayNotYet">
        Doch noch nicht
      </Button>

      <Button
        v-if="!confirmingEnd"
        variant="ghost"
        size="sm"
        class="ml-auto"
        @click="confirmingEnd = true"
      >
        Blind-Date beenden
      </Button>
    </div>

    <!-- What it means, before it happens rather than after. The reassuring half is not decoration:
         „beenden" beside a story two people wrote reads as „löschen" unless it says otherwise. -->
    <div v-if="confirmingEnd" class="mt-3 border-t border-line-3 pt-3">
      <p class="max-w-[65ch] text-note text-ink-4">
        Das Blind-Date endet für euch beide, und du kannst dich danach wieder für ein neues
        bewerben. Die Gruppe und alles, was ihr geschrieben habt, bleiben erhalten — gelöscht wird
        nichts, und niemand wird enthüllt. Die andere Person erfährt, dass es beendet wurde, mehr
        nicht.
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" :disabled="isEnding" @click="endBlindDate">
          <Spinner v-if="isEnding" />
          Ja, beenden
        </Button>
        <Button variant="ghost" size="sm" :disabled="isEnding" @click="confirmingEnd = false">
          Abbrechen
        </Button>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-[12.5px] text-destructive" role="alert">{{ error }}</p>
  </section>
</template>
