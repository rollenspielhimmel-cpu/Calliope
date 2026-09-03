<script setup lang="ts">
/**
 * The Blind-Date page's rail: the rules, and the way in.
 *
 * **Always open**, unlike a group's context rail, because this *is* how somebody takes part. A
 * control that folded it away would fold away the point of the page — so `AppLayout` is told
 * `railAlwaysOpen` and offers no collapse. Below `lg` it becomes the same sheet every rail does;
 * there is no room for one on a phone either way.
 *
 * The applying lives here rather than beside each plot, so there is one way in rather than one per
 * offer plus a proactive one somewhere else.
 *
 * Offers whose deadline has passed keep their place in the numbering and lose their button. They
 * are still on the page, so „Handlung 2" has to mean the same plot here as it does there — which
 * it would not if the closed ones were filtered out and the rest renumbered.
 */
import type { ListBlindDateOffers200Item } from '@/api/models'
import { applicationsHaveClosed } from '@/lib/blindDate/offerDeadline'
import { BookText } from '@lucide/vue'
import { Button } from '@/components/ui/button'

defineProps<{
  offers: ListBlindDateOffers200Item[]
  /** False while this member may not apply; the rail then explains rather than offering. */
  mayApply: boolean
  /** Said once, here, when there is a reason they cannot. */
  refusal?: string
}>()

const emit = defineEmits<{ apply: [offer: ListBlindDateOffers200Item]; applyFreely: [] }>()
</script>

<template>
  <div class="flex flex-col gap-5">
    <RouterLink
      :to="{ name: 'page', params: { slug: 'blind-date-regelwerk' } }"
      class="flex items-center gap-2 text-[13px] text-oak-deep underline-offset-[5px] hover:underline"
    >
      <BookText :size="15" :stroke-width="1.5" aria-hidden="true" />
      Regelwerk
    </RouterLink>

    <div v-if="!mayApply">
      <p class="text-[12.5px] leading-[1.5] text-ink-5">
        {{ refusal ?? 'Eine Bewerbung ist gerade nicht möglich.' }}
      </p>
    </div>

    <template v-else>
      <!-- One button per offer, numbered the way the page numbers them, so „Handlung 1" on the
           page and „Bewerbung auf Handlung 1" here are plainly the same thing. -->
      <div v-if="offers.length > 0" class="flex flex-col gap-2">
        <template v-for="(offer, index) in offers" :key="offer.id">
          <p
            v-if="applicationsHaveClosed(offer.closesAt)"
            class="text-[12px] leading-[1.45] text-ink-6"
          >
            Handlung {{ index + 1 }}: Bewerbungsfrist abgelaufen
          </p>
          <Button
            v-else
            variant="outline"
            size="sm"
            class="justify-start text-left"
            @click="emit('apply', offer)"
          >
            Bewerbung auf Handlung {{ index + 1 }}
          </Button>
        </template>
      </div>

      <div class="border-t border-line-3 pt-4">
        <Button variant="ghost" size="sm" class="justify-start" @click="emit('applyFreely')">
          Eigene Handlung vorschlagen
        </Button>
        <p class="mt-1 text-[12px] leading-[1.45] text-ink-6">
          Eine beliebige offizielle RSH-Handlung, die gerade nicht ausgeschrieben ist.
        </p>
      </div>
    </template>
  </div>
</template>
