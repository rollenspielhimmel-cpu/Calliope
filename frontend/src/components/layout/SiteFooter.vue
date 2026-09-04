<script setup lang="ts">
/**
 * The two pages the law wants reachable from everywhere, plus this fork's source.
 *
 * **Rendered on every page here**, not only the signed-out ones: German law asks that a legal
 * notice and a privacy policy be easy to recognise, immediately reachable and always available,
 * and this fork does not carry them in the account menu the way upstream does. It is deliberately
 * the quietest thing on the screen — one hairline, metadata ink, no heading.
 *
 * **No wordmark, unlike upstream.** There it identifies the site on pages that have no top bar;
 * here every shell already shows one — `TopBar` with a session, and a large one in the middle of
 * the sign-in, registration and password pages. A second would say the same thing twice, which
 * this design system rules out. Restoring it on a later merge would reintroduce that.
 *
 * **The third link is this fork's own**, and it is here for a different reason than the other two:
 * the AGPL's network clause says whoever *uses* a modified instance over the network is owed the
 * source of the version they are using. A repository that exists somewhere satisfies nothing on
 * its own — the offer has to reach the page. Upstream has no need of it, being the original.
 */
import { RouterLink } from 'vue-router'
import { SOURCE_URL } from '@/lib/branding'

const LINKS = [
  { name: 'imprint', label: 'Impressum' },
  { name: 'privacyPolicy', label: 'Datenschutzerklärung' },
] as const
</script>

<template>
  <footer
    class="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-3 px-gutter py-3 md:px-10"
  >
    <nav aria-label="Rechtliches">
      <ul class="flex flex-wrap gap-x-5 gap-y-1">
        <li v-for="link in LINKS" :key="link.name">
          <RouterLink
            :to="{ name: link.name }"
            class="text-note text-ink-5 underline-offset-2 hover:text-oak-deep hover:underline"
          >
            {{ link.label }}
          </RouterLink>
        </li>
        <!-- A new tab, because leaving for the repository is not leaving the page somebody was
             reading. `noopener`, because a link that opens a tab should not hand it a way back. -->
        <li>
          <a
            :href="SOURCE_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="text-note text-ink-5 underline-offset-2 hover:text-oak-deep hover:underline"
          >
            Quellcode
          </a>
        </li>
      </ul>
    </nav>
  </footer>
</template>
