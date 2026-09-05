<script setup lang="ts">
/**
 * The frame every forum page sits in: one rail with the forum's tree, and the page beside it.
 *
 * A layout route rather than a wrapper each view repeats — the rail is the same on the tree, on a
 * thread and on a page, and three copies of it would drift apart on the day one of them gains a
 * block.
 *
 * **Written on our `AppLayout` rather than beside it.** Upstream this component carried its own
 * rail machinery — a media query, a collapse toggle, a sheet for narrow screens — because there the
 * app frame lives above `RouterView` and a layout route has to build its own. Here every view
 * wraps itself in `AppLayout`, which already has all of that and gets it right in one place. So the
 * tree goes in the slot that exists for it and the rest falls away: the forum then behaves on a
 * phone exactly like a group does, because it is the same code doing it.
 *
 * The tree is left out on the forum's own front page, which *is* the tree — `listsForumContents` on
 * the route says so, the same way a group's content listing does.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import RailBlock from '@/components/context/RailBlock.vue'
import ForumRail from '@/components/context/ForumRail.vue'

const route = useRoute()

const showsContentRail = computed<boolean>(() => route.meta.listsForumContents !== true)
</script>

<template>
  <AppLayout
    rail-label="Im Forum"
    rail-description="Die Ordner des Forums, und die Themen und Seiten darin."
  >
    <RouterView />

    <!--
      The `rail` slot, not `infoRail`, although upstream drew this tree on the left. Our left rail
      is labelled „Über die Gruppe" and — this is the deciding half — has no way in below `lg`: the
      button that opens the sheet is bound to the right rail alone. A forum tree nobody can open on
      a phone is not a tree, so it goes where the label follows `railLabel` and the sheet works.
    -->
    <template v-if="showsContentRail" #rail="{ collapsible }">
      <RailBlock label="Inhalt" :collapsible="collapsible" open-start>
        <ForumRail />
      </RailBlock>
    </template>
  </AppLayout>
</template>
