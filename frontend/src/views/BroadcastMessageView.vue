<script setup lang="ts">
/**
 * Eine Rundmail aus dem eigenen Postfach.
 *
 * **Nur für Rundmails ohne Archiv-Haken.** Steht eine im Forum, führt die Glocke direkt dorthin;
 * diese Seite schickt einen Nachzügler, der sie doch aufruft, hinterher — derselbe Text an zwei
 * Orten wäre die Doppelung, die hier niemand will, und im Forum steht außerdem, was inzwischen
 * darunter geschrieben wurde.
 *
 * Wer sie nicht bekommen hat, sieht nichts. Das entscheidet die Schnittstelle über die eigene
 * Benachrichtigung, nicht diese Seite über eine Rolle.
 */
import { computed, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useReadBroadcast } from '@/api/notifications/notifications'
import { formatBerlin } from '@/lib/format/berlinTime'
import { APP_NAME } from '@/lib/branding'

const route = useRoute()
const router = useRouter()

const broadcastId = computed(() => String(route.params.broadcastId))

const { data, isPending, isError } = useReadBroadcast(broadcastId)

const broadcast = computed(() => (data.value?.status === 200 ? data.value.data : undefined))

// Ersetzen statt schieben: Wer zurückgeht, soll im Postfach landen und nicht auf einer Seite, die
// ihn sofort wieder weiterschickt.
watchEffect(() => {
  const threadId = broadcast.value?.archiveThreadId
  if (threadId) {
    router.replace({ name: 'forumThread', params: { threadId } })
  }
})

/** Absätze, wie sie getippt wurden. Der Text kommt aus einem Textfeld, nicht aus dem Editor. */
const paragraphs = computed(() =>
  (broadcast.value?.body ?? '')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0),
)

/** Ohne gewähltes Konto trägt sie die Stimme der Plattform selbst. */
const sender = computed(() => broadcast.value?.sendAsUsername ?? APP_NAME)
</script>

<template>
  <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
    <div class="reading-column">
      <p v-if="isPending" class="text-note text-ink-5">Wird geladen …</p>

      <template v-else-if="isError || !broadcast">
        <h1 class="mb-3 text-h1 text-ink-1">Nicht gefunden</h1>
        <p class="text-body text-ink-3">
          Diese Rundmail gibt es in deinem Postfach nicht. Vielleicht war sie an jemand anderen
          gerichtet.
        </p>
      </template>

      <template v-else>
        <h1 class="text-h1 text-ink-1">{{ broadcast.subject }}</h1>

        <!-- Recessed metadata and a hairline, like a post: eine Rundmail ist ein Text von jemandem
             an jemanden und kein Systemhinweis, der einen Kasten bräuchte. -->
        <p class="mt-2 text-note text-ink-5">
          Von {{ sender
          }}<template v-if="broadcast.releasedAt">
            am {{ formatBerlin(broadcast.releasedAt) }}</template
          >
        </p>

        <hr class="my-5 border-line" />

        <div class="prose-body space-y-4 text-body text-ink-2">
          <p v-for="(paragraph, index) in paragraphs" :key="index" class="whitespace-pre-line">
            {{ paragraph }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
