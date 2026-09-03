<script setup lang="ts">
/**
 * The tab strip the operators' tools use to hold several views of one subject.
 *
 * The same shape a thread's tabs and the post-sort toggle already carry — a hairline baseline with
 * the active tab marked by an oak underline — rather than a filled pill: this product marks state
 * with a line, and a second convention for the same job would read as a different control.
 *
 * `count` is optional and shown only where it is a fact worth acting on. A tab whose count is
 * always there teaches nobody anything.
 */
export type ModerationTab = {
  value: string
  label: string
  /** Shown beside the label. Absent, not zero, when there is nothing to say. */
  count?: number
}

defineProps<{ tabs: ModerationTab[]; label: string }>()

const active = defineModel<string>({ required: true })
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-3"
    role="tablist"
    :aria-label="label"
  >
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="active === tab.value"
      class="-mb-px flex min-h-11 items-end border-b-2 pb-2.5 text-[13px] md:min-h-9"
      :class="
        active === tab.value
          ? 'border-oak font-medium text-ink-1'
          : 'border-transparent text-ink-5 hover:text-oak-deep'
      "
      @click="active = tab.value"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="ml-1.5 text-[12px] text-ink-6">
        {{ tab.count }}
      </span>
    </button>
  </div>
</template>
