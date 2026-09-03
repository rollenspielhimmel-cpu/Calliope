<script setup lang="ts">
/**
 * One operator action on a piece of the platform — a member's profile, a forum thread: an icon,
 * and the word it means on hover.
 *
 * Small and quiet on purpose. Beside what an ordinary member does — „Blockieren", „Melden" — the
 * operators' own tools should not be the loudest thing on the page, and there are several of them.
 *
 * The label is the accessible name as well as the tooltip, so the control is never icon-only to
 * a screen reader. The icon itself is `aria-hidden`: it repeats what the label already says.
 */
import type { Component } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  icon: Component
  label: string
  /** Drawn as on when the thing it toggles is already true — on the watchlist, and so on. */
  active?: boolean
  disabled?: boolean
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        type="button"
        :aria-label="label"
        :aria-pressed="active"
        :disabled="disabled"
        class="flex size-11 items-center justify-center rounded-lg text-ink-5 hover:text-oak-deep disabled:opacity-50 md:size-8"
        :class="active ? 'bg-paper-3 text-oak-deep' : ''"
        @click="$emit('click')"
      >
        <component :is="icon" :size="16" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
