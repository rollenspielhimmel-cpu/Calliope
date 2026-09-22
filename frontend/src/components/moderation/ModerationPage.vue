<script setup lang="ts">
/**
 * The frame every moderation page shares: the way back, the heading, and a sentence saying
 * what the page is for. Written once so the nine of them cannot drift apart.
 */
import { computed } from 'vue'
import { ChevronLeft } from '@lucide/vue'
import { useGetCurrentUser } from '@/api/auth/auth'
import AppLayout from '@/components/layout/AppLayout.vue'

defineProps<{ title: string; description: string }>()

const { data: currentUser } = useGetCurrentUser()

/**
 * Der Weg zurück führt in die Übersicht der Moderation, und die gibt es nur für das Team. Wer ohne
 * Teamrolle hier ist — mit einem persönlich vergebenen Absender auf der Rundmail-Seite —, bekäme
 * einen Link, der ihn nach Hause umleitet.
 */
const hasTeamRole = computed<boolean>(
  () => currentUser.value?.status === 200 && currentUser.value.data.platformRole !== null,
)
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <RouterLink
        v-if="hasTeamRole"
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
