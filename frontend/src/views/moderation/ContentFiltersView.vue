<script setup lang="ts">
/**
 * The two lists that decide what the community may print, and who may join it at all.
 *
 * Together on one page because they are the same kind of decision — a standing rule the whole
 * platform is measured against, administrator territory rather than moderator — and because two
 * tiles for two small lists made the moderation overview longer than the work it describes.
 */
import { computed, ref } from 'vue'
import { useListBlockedEmailDomains, useListBlockedWords } from '@/api/moderation/moderation'
import ModerationPage from '@/components/moderation/ModerationPage.vue'
import ModerationTabs from '@/components/moderation/ModerationTabs.vue'
import type { ModerationTab } from '@/components/moderation/ModerationTabs.vue'
import BlockedEmailDomainsPanel from '@/components/moderation/BlockedEmailDomainsPanel.vue'
import BlockedWordsPanel from '@/components/moderation/BlockedWordsPanel.vue'

const tab = ref<string>('words')

const { data: wordsData } = useListBlockedWords()
const { data: domainsData } = useListBlockedEmailDomains()

const tabs = computed<ModerationTab[]>(() => [
  {
    value: 'words',
    label: 'Wort-Blacklist',
    count: wordsData.value?.status === 200 ? wordsData.value.data.length : undefined,
  },
  {
    value: 'domains',
    label: 'E-Mail-Domains',
    count: domainsData.value?.status === 200 ? domainsData.value.data.length : undefined,
  },
])
</script>

<template>
  <ModerationPage
    title="Wörter und Domains"
    description="Was in der Community nicht geschrieben steht, und mit welchen Anbietern sich niemand anmelden kann. Beides ändert Regeln für alle — deshalb nur für die Administration."
  >
    <ModerationTabs v-model="tab" :tabs="tabs" label="Listen" />

    <div class="mt-5">
      <BlockedWordsPanel v-if="tab === 'words'" />
      <BlockedEmailDomainsPanel v-else />
    </div>
  </ModerationPage>
</template>
