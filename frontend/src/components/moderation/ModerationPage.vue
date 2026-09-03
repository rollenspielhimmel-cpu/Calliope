<script setup lang="ts">
/**
 * The frame every moderation page shares: the way back, the heading, and a sentence saying
 * what the page is for. Written once so the nine of them cannot drift apart.
 */
import { ChevronLeft } from '@lucide/vue'
import AppLayout from '@/components/layout/AppLayout.vue'

defineProps<{ title: string; description: string }>()
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <RouterLink
        :to="{ name: 'moderation' }"
        class="inline-flex items-center gap-1 text-[12.5px] text-ink-5 hover:text-oak-deep"
      >
        <ChevronLeft :size="14" :stroke-width="1.5" aria-hidden="true" />
        Moderation
      </RouterLink>

      <h1 class="mt-3 text-h1">{{ title }}</h1>
      <p class="mt-2 max-w-[60ch] text-body text-ink-4">{{ description }}</p>

      <div class="mt-6">
        <slot />
      </div>
    </div>
  </AppLayout>
</template>
