<script setup lang="ts">
/**
 * Everyone with at least one strike, filed under the rung they have reached.
 *
 * **Sections rather than one flat list**, because the flat list answered no question anybody
 * actually has. What moderation opens this page for is "who is at the end of the ladder" — and in
 * a list sorted by date that means reading every row and counting.
 *
 * The sections come from two numbers the API returns, not from a token it invents: which rung a
 * member is on is `warnings` and `suspensions` counted, and what that rung is *called* is German
 * and belongs here, like every other label in this project. „(aktuell gesperrt)" is a third fact —
 * whether the suspension is still running — because a served suspension is history, not a state.
 *
 * A member with a clean record is absent, which is the API's decision and the right one: a whole
 * membership under this heading would read as an accusation of everybody.
 */
import { computed } from 'vue'
import { useListStrikeLadder } from '@/api/moderation/moderation'
import type { ListStrikeLadder200Item } from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListStrikeLadder()

const standings = computed<ListStrikeLadder200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

type Section = { title: string; hint?: string; members: ListStrikeLadder200Item[] }

/**
 * The ladder from the platform rules, read from the bottom up: two warnings, then the strikes.
 * A member is filed under the *highest* rung they have reached — somebody on their second strike
 * also has two warnings behind them, and listing them twice would double the page.
 */
const sections = computed<Section[]>(() => {
  const banned = standings.value.filter((one) => one.bannedAt !== null)
  const onLadder = standings.value.filter((one) => one.bannedAt === null)

  const bySuspensions = (count: number) => onLadder.filter((one) => one.suspensions === count)

  const rungs: Section[] = [
    {
      title: 'Gesperrtes Konto',
      hint: 'Dauerhaft gesperrt. Die Leiter ist hier zu Ende.',
      members: banned,
    },
    {
      title: '3. Strike und weiter',
      hint: 'Die Leiter ist durchlaufen. Was danach kommt, ist eine eigene Entscheidung.',
      members: onLadder.filter((one) => one.suspensions >= 3),
    },
    { title: '2. Strike', members: bySuspensions(2) },
    { title: '1. Strike', members: bySuspensions(1) },
    {
      title: '2. Verwarnung',
      hint: 'Beim nächsten Vorfall schlägt das System eine Sperre vor.',
      members: onLadder.filter((one) => one.suspensions === 0 && one.warnings >= 2),
    },
    {
      title: '1. Verwarnung',
      members: onLadder.filter((one) => one.suspensions === 0 && one.warnings === 1),
    },
  ]

  // An empty rung is left out rather than shown as a heading over nothing: the sections that are
  // there are the ones somebody has to look at.
  return rungs.filter((section) => section.members.length > 0)
})

const total = computed<number>(() => standings.value.length)
</script>

<template>
  <div>
    <div v-if="isPending" class="flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <p v-else-if="total === 0" class="text-note text-ink-5">
      Niemand hat eine Verwarnung oder einen Strike. Vergeben wird beides auf dem jeweiligen Profil.
    </p>

    <template v-else>
      <p class="max-w-[70ch] text-note text-ink-5">
        Zwei Verwarnungen, dann 24, 48 und 72 Stunden. Jede und jeder steht unter der höchsten
        Stufe, die erreicht wurde. Vergeben wird auf dem jeweiligen Profil, wo die Vorgeschichte
        sichtbar ist.
      </p>

      <section v-for="section in sections" :key="section.title" class="mt-7">
        <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          {{ section.title }}
          <span class="ml-1 normal-case">({{ section.members.length }})</span>
        </h3>
        <p v-if="section.hint" class="mt-1 max-w-[70ch] text-[12px] text-ink-6">
          {{ section.hint }}
        </p>

        <ul class="mt-2.5 flex flex-col">
          <li
            v-for="member in section.members"
            :key="member.id"
            class="border-t border-line-3 py-3 first:border-t-0 first:pt-0"
          >
            <div class="flex flex-wrap items-baseline gap-x-2.5">
              <RouterLink
                :to="{ name: 'member', params: { userId: member.id } }"
                class="text-row text-oak-deep hover:underline"
              >
                {{ member.username }}
              </RouterLink>

              <!-- Said only while it is true. A served suspension is history, and marking it as
                   current would have moderation act on something already over. -->
              <span v-if="member.suspendedUntil" class="text-[12.5px] text-destructive">
                aktuell gesperrt bis {{ formatActivityTime(member.suspendedUntil) }}
              </span>
            </div>

            <p class="mt-1 text-[12px] text-ink-6">
              {{ member.warnings }}
              {{ member.warnings === 1 ? 'Verwarnung' : 'Verwarnungen' }} ·
              {{ member.suspensions }}
              {{ member.suspensions === 1 ? 'Strike' : 'Strikes' }} · zuletzt
              {{ formatActivityTime(member.lastStrikeAt) }}
            </p>

            <p v-if="member.suspensionReason" class="mt-1 text-[12.5px] text-ink-4">
              {{ member.suspensionReason }}
            </p>

            <!-- The reason the two lists share a page: whoever is reading the ladder wants to
                 know that somebody was already being watched, without changing tabs to find out. -->
            <p v-if="member.watchlistNote" class="mt-1 text-[12.5px] text-ink-5">
              Auf der Beobachtungsliste: {{ member.watchlistNote }}
            </p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
