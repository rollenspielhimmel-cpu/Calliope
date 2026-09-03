<script setup lang="ts">
/**
 * What members said about their Blind-Dates, newest first.
 *
 * The form is voluntary and asked once, so this is thin on purpose: a handful of rows, each one
 * somebody who took a minute. **Declines are rows too**, with both answers empty — a form that most
 * people decline is telling the team something the answers cannot, and hiding those would leave
 * only the flattering half.
 *
 * With names, because the point of reading it is to be able to ask somebody about what they wrote.
 * Nothing here is a complaint about another member: the questions are about the format, the form
 * says so, and a complaint about a person arrives as a report instead.
 *
 * A short tally at the top, since two of the three answers are countable and „ist das Format gut"
 * is the question the team actually has. Not a chart: eleven answers do not need one.
 */
import { computed } from 'vue'
import { useListBlindDateFeedback } from '@/api/moderation/moderation'
import type { ListBlindDateFeedback200Item } from '@/api/models'
import { formatActivityTime } from '@/lib/format/formatTime'
import { formatCount } from '@/lib/format/formatNumber'
import { Spinner } from '@/components/ui/spinner'

const { data, isPending } = useListBlindDateFeedback()

const entries = computed<ListBlindDateFeedback200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const answered = computed(() => entries.value.filter((entry) => entry.worked !== null))
const declined = computed(() => entries.value.length - answered.value.length)

const WORKED: Record<string, string> = {
  yes: 'Ja',
  partly: 'Teils',
  no: 'Nein',
}

const AGAIN: Record<string, string> = {
  yes: 'Ja',
  maybe: 'Vielleicht',
  no: 'Nein',
}

/** How often each answer was given, in the order the form offers them. */
function tally(field: 'worked' | 'again', labels: Record<string, string>) {
  return Object.keys(labels).map((value) => ({
    label: labels[value]!,
    count: answered.value.filter((entry) => entry[field] === value).length,
  }))
}

const workedTally = computed(() => tally('worked', WORKED))
const againTally = computed(() => tally('again', AGAIN))
</script>

<template>
  <div>
    <p class="max-w-[70ch] text-note text-ink-5">
      Der freiwillige Bogen nach jedem Blind-Date. Jede Person wird genau einmal gefragt, nach dem
      zuletzt beendeten. Die Fragen gehen um das Format, nicht um die andere Person — wer sich über
      jemanden beschweren möchte, meldet, und das steht in der Meldungsliste.
    </p>

    <div v-if="isPending" class="mt-5 flex items-center gap-2 text-note text-ink-5">
      <Spinner />
      Einen Moment.
    </div>

    <template v-else>
      <p v-if="entries.length === 0" class="mt-5 max-w-[70ch] text-note text-ink-5">
        Noch hat niemand geantwortet.
      </p>

      <template v-else>
        <!-- The countable half, said in one line each rather than drawn. -->
        <section class="mt-5 border-b border-line-3 pb-4">
          <h3 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">Überblick</h3>

          <p class="mt-2 text-[12.5px] text-ink-4">
            Hat funktioniert:
            <template v-for="(entry, index) in workedTally" :key="entry.label">
              <template v-if="index > 0"> · </template>{{ entry.label }}
              {{ formatCount(entry.count) }}
            </template>
          </p>
          <p class="mt-1 text-[12.5px] text-ink-4">
            Möchte wieder:
            <template v-for="(entry, index) in againTally" :key="entry.label">
              <template v-if="index > 0"> · </template>{{ entry.label }}
              {{ formatCount(entry.count) }}
            </template>
          </p>
          <p class="mt-1 text-[12px] text-ink-6">
            {{ formatCount(answered.length) }}
            {{ answered.length === 1 ? 'Antwort' : 'Antworten' }}, {{ formatCount(declined) }} mal
            „nein danke“
          </p>
        </section>

        <ul class="flex flex-col">
          <li
            v-for="entry in entries"
            :key="entry.id"
            class="border-b border-line-2 py-3 last:border-b-0"
          >
            <div class="flex flex-wrap items-baseline gap-x-3">
              <span class="text-row text-ink-2">{{ entry.username }}</span>
              <span class="text-[12.5px] text-ink-5">{{ entry.plotTitle }}</span>
              <span class="text-[12px] text-ink-6">
                {{ formatActivityTime(entry.createdAt) }}
              </span>
            </div>

            <p v-if="entry.worked === null" class="mt-1 text-[12.5px] text-ink-6">
              Wollte nicht antworten.
            </p>

            <template v-else>
              <p class="mt-1 text-[12.5px] text-ink-4">
                Hat funktioniert: {{ WORKED[entry.worked] }} · Möchte wieder:
                {{ entry.again === null ? '—' : AGAIN[entry.again] }}
              </p>
              <!-- Line breaks kept and nothing else interpreted, as everywhere a member's own
                   text is shown back. -->
              <p
                v-if="entry.note"
                class="mt-1.5 max-w-[70ch] text-[12.5px] leading-[1.6] whitespace-pre-line text-ink-3"
              >
                {{ entry.note }}
              </p>
            </template>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
