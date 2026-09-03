<script setup lang="ts">
/**
 * Impressum and Datenschutzerklärung, reachable from wherever somebody is.
 *
 * German law asks that both be **easy to recognise, immediately reachable and always available**,
 * and the second of those is what this component is for: the two pages exist as ordinary custom
 * pages and are readable without an account, but a page nobody can find is a page that is not
 * there.
 *
 * Deliberately the quietest thing on the screen — one hairline, metadata ink, no heading. It is a
 * legal necessity rather than something anybody came here to read, and this platform's whole
 * argument is that the writing surface should not compete with its own chrome.
 *
 * Rendered in two places, because the app has two shells: inside `AppLayout` for everything
 * behind the top bar, and on the sign-in and registration pages, which are their own centred
 * layout and are where a visitor without an account actually lands.
 *
 * The third link is the source code, and it is here for a different reason than the other two: the
 * AGPL's network clause says whoever uses a modified instance is owed the source of what they are
 * using. A repository that exists somewhere satisfies nothing — the offer has to reach the page.
 */
import { SOURCE_URL } from '@/lib/branding'
</script>

<template>
  <footer
    class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line-2 px-gutter py-2 text-[11.5px] text-ink-6"
  >
    <RouterLink
      :to="{ name: 'page', params: { slug: 'impressum' } }"
      class="underline-offset-[4px] hover:text-ink-4 hover:underline"
    >
      Impressum
    </RouterLink>
    <RouterLink
      :to="{ name: 'page', params: { slug: 'datenschutz' } }"
      class="underline-offset-[4px] hover:text-ink-4 hover:underline"
    >
      Datenschutz
    </RouterLink>

    <!-- A new tab, because leaving for the repository is not leaving the page somebody was
         reading. `noopener` because a link that opens a tab should not hand it a way back. -->
    <a
      :href="SOURCE_URL"
      target="_blank"
      rel="noopener noreferrer"
      class="underline-offset-[4px] hover:text-ink-4 hover:underline"
    >
      Quellcode
    </a>
  </footer>
</template>
