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
 * **Every offer is named by its title, here and everywhere else.** There was a „Handlung 1" once,
 * matched to a numbered card on the page. A number taken from a position in a list is not a name:
 * it moves when an offer expires and again when one is added, so „Handlung 2" meant a different
 * plot from one week to the next — and it made the page depend on the rail agreeing with it about
 * an order neither of them owned. The plots have titles; those are what people say out loud.
 *
 * An offer past its deadline keeps its row and loses its button. Since the server stopped listing
 * expired offers to anybody who did not apply to one, the only member who still sees such a row is
 * the applicant waiting on it — the branch stays anyway, so that „no button after the deadline" is
 * true here rather than true only because the list happens to be filtered elsewhere.
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
      :to="{ name: 'customPage', params: { slug: 'blind-date-regelwerk' } }"
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
      <!-- One button per offer, each carrying the plot's own title, so the card on the page and the
           button here name the same thing without either having to count. The button wraps rather
           than truncating: a title cut off mid-word is not a name somebody can act on. -->
      <div v-if="offers.length > 0" class="flex flex-col gap-2">
        <template v-for="offer in offers" :key="offer.id">
          <p
            v-if="applicationsHaveClosed(offer.closesAt)"
            class="text-[12px] leading-[1.45] text-ink-6"
          >
            „{{ offer.title }}“: Bewerbungsfrist abgelaufen
          </p>
          <Button
            v-else
            variant="outline"
            size="sm"
            class="h-auto justify-start py-1.5 text-left leading-[1.35] whitespace-normal"
            @click="emit('apply', offer)"
          >
            Bewerbung auf „{{ offer.title }}“
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
