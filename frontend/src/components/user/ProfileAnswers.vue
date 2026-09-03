<script setup lang="ts">
/**
 * The optional profile questions this member answered, grouped by the section they belong to.
 *
 * A question they did not answer is absent, and if they answered none the whole block is gone —
 * only their own text stays. That is the product document's rule, and it is why this renders
 * nothing at all rather than an empty heading.
 */
import { computed } from 'vue'
import { useGetProfileAnswers } from '@/api/users/users'
import type { GetProfileAnswers200Item } from '@/api/models'

const props = defineProps<{ userId: string }>()

const { data } = useGetProfileAnswers(() => props.userId)

const answers = computed<GetProfileAnswers200Item[]>(() =>
  data.value?.status === 200 ? data.value.data : [],
)

const sections = computed<{ name: string; answers: GetProfileAnswers200Item[] }[]>(() => {
  const grouped = new Map<string, GetProfileAnswers200Item[]>()

  for (const answer of answers.value) {
    grouped.set(answer.section, [...(grouped.get(answer.section) ?? []), answer])
  }

  return [...grouped.entries()].map(([name, list]) => ({ name, answers: list }))
})
</script>

<template>
  <div v-if="answers.length > 0" class="mt-8 flex flex-col gap-6">
    <section v-for="section in sections" :key="section.name">
      <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
        {{ section.name }}
      </h2>
      <dl class="mt-2 flex flex-col gap-2">
        <div v-for="answer in section.answers" :key="answer.questionId" class="text-row">
          <dt class="inline text-ink-5">{{ answer.prompt }}:</dt>
          <dd class="ml-1 inline text-ink-2">{{ answer.answer }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
