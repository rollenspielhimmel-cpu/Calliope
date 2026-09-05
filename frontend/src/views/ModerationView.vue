<script setup lang="ts">
/**
 * One way in to everything the operators do, grouped by what the work is rather than by which
 * feature shipped when. Sections rather than one long grid: the list is already nine things and
 * would otherwise be read as a wall.
 *
 * The abuse reports are a link, not a copy — that queue has its own page and its own lifecycle,
 * and duplicating it here would give two places to work the same reports from. They sit first and
 * carry the one alert surface in the product: an unanswered report is the only thing here that is
 * somebody waiting. The design system forbids colour-as-status everywhere a member can see, and
 * this is behind the role gate — the boundary is written down in its readme.
 *
 * Tiles an account may not use are absent rather than disabled: a moderator has no way to act on
 * the administrator-only ones, so offering them would only be a refusal waiting to happen. The
 * API and the route guards refuse independently.
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { useGetCurrentUser } from '@/api/auth/auth'
import { useListReports } from '@/api/reports/reports'
import { useListBroadcastQueue } from '@/api/moderation/moderation'
import { GetCurrentUser200PlatformRole } from '@/api/models'
import type { ListReportsBody } from '@/api/models'
import { formatCount } from '@/lib/format/formatNumber'
import {
  Eye,
  FileText,
  Flag,
  Globe,
  ListChecks,
  MailX,
  Megaphone,
  Shuffle,
  UserPlus,
  Users,
} from '@lucide/vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import type { RouteLocationRaw } from 'vue-router'

type Tile = {
  title: string
  description: string
  icon: Component
  to: RouteLocationRaw
  /** Administrator-only tiles are left out for a moderator rather than shown as refused. */
  administratorOnly?: boolean
  /**
   * How many things behind this tile are waiting for somebody. Absent — not zero — where there is
   * nothing that waits: a count that is always there stops being read, and the design rules keep
   * numbers for what is still to be done.
   *
   * Only the reports and the broadcast queue have one, and both are seen only by the people who
   * can act on them: the queue's endpoint is administrator-only, so a moderator's request answers
   * nothing and the number never appears.
   */
  waiting?: Readonly<{ value: number }>
}

type Section = { title: string; tiles: Tile[] }

const { data } = useGetCurrentUser()

/**
 * How many reports nobody has answered yet. `limit: 1` because only `totalResults` is read — the
 * queue itself is a page away, and fetching it twice to count it would be the expensive way to
 * ask a question the count already answers.
 */
const OPEN_REPORTS_BODY: ListReportsBody = { limit: 1, offset: 0, status: 'open' }

const { data: openReports } = useListReports(OPEN_REPORTS_BODY)

const openReportCount = computed<number>(() =>
  openReports.value?.status === 200 ? openReports.value.data.totalResults : 0,
)

/**
 * Wie viele Rundmails auf eine Freigabe warten.
 *
 * Aus der Warteschlange selbst, damit die Zahl nicht von dem abweichen kann, was die Seite dahinter
 * zeigt — dieselbe Regel wie bei den Missbrauchsmeldungen. Die Abfrage ist der Administration
 * vorbehalten; für die Moderation antwortet sie nicht, und die Zahl erscheint gar nicht erst.
 */
const { data: queue } = useListBroadcastQueue()

const waitingBroadcasts = computed<number>(() =>
  queue.value?.status === 200 ? queue.value.data.length : 0,
)

const isAdministrator = computed<boolean>(
  () =>
    data.value?.status === 200 &&
    data.value.data.platformRole === GetCurrentUser200PlatformRole.administrator,
)

const SECTIONS: Section[] = [
  {
    title: 'Mitglieder und Sicherheit',
    tiles: [
      {
        title: 'IP-Adressen und Sperren',
        description:
          'Übersicht aller Konten, gesperrte Adressen, und wo mehrere Konten dieselbe Adresse teilen.',
        icon: Globe,
        to: { name: 'moderationIpAddresses' },
      },
      {
        title: '3-Strikes-System & Watchlist',
        description:
          'Wer wo auf der Leiter steht, nach Stufe sortiert — und wen das Team im Auge behalten wollte.',
        icon: Eye,
        to: { name: 'moderationStrikes' },
      },
      {
        title: 'Black-List für Wörter & Domain-Sperren',
        description:
          'Wörter, die nirgends gedruckt werden, und Anbieter, mit denen sich niemand anmelden kann.',
        icon: MailX,
        to: { name: 'moderationContentFilters' },
        administratorOnly: true,
      },
      {
        title: 'Benutzergruppen',
        description: 'Wer Moderation oder Administration ist, und wer es werden soll.',
        icon: Users,
        to: { name: 'moderationRoles' },
      },
    ],
  },
  /**
   * Was zwischen Mitgliedern entsteht, nicht was gegen sie unternommen wird.
   *
   * Das Blind-Date stand unter „Mitglieder und Sicherheit", zwischen IP-Sperren und dem
   * 3-Strikes-System — als wäre es eine Maßnahme. Es ist das Gegenteil: die Stelle, an der die
   * Seite Leute zusammenbringt. Ein Bereich, in dem Sperren und Kuppeln nebeneinanderstehen, sagt
   * über beides etwas Falsches.
   *
   * Hier gehört später auch das Forum hin, dessen Struktur bis dahin auf der Forumsseite selbst
   * verwaltet wird — siehe die entfernte Kachel weiter unten.
   */
  {
    title: 'Community',
    tiles: [
      {
        title: 'Blind-Date',
        description: 'Bewerbungen zuordnen, Handlungen anbieten, und wer nicht teilnehmen darf.',
        icon: Shuffle,
        to: { name: 'moderationBlindDate' },
      },
    ],
  },
  {
    title: 'Kommunikation',
    tiles: [
      {
        title: 'Rundmail',
        description: 'Eine Nachricht an alle Mitglieder oder an eine Teilmenge von ihnen.',
        icon: Megaphone,
        to: { name: 'moderationBroadcast' },
        administratorOnly: true,
        waiting: waitingBroadcasts,
      },
      // Hier stand „Erinnerungen an unbestätigte Adressen", das auf dieselbe Seite führte wie der
      // Bereich „Einladungen" darunter. Zwei Wege auf eine Seite sind einer zu viel, und das
      // Erinnern ist ein Vorgang auf dieser Seite, kein Bereich neben ihr.
    ],
  },
  {
    title: 'Einladungen',
    tiles: [
      {
        title: 'Einladungen',
        description: 'Wer wen eingeladen hat, und wie viele davon tatsächlich angekommen sind.',
        icon: UserPlus,
        to: { name: 'moderationInvitations' },
      },
    ],
  },
  {
    title: 'Inhalte und Seiten',
    tiles: [
      {
        title: 'Eigene Seiten',
        description: 'Regelwerk, FAQ und andere feste Textseiten anlegen und bearbeiten.',
        icon: FileText,
        to: { name: 'moderationPages' },
        administratorOnly: true,
      },
      // Hier stand „Forum-Struktur", das Kategorien und Unterforen anlegte. Beim Wechsel auf das
      // Forum aus Calliope ist diese Seite entfallen — dort wird die Struktur auf der Forumsseite
      // selbst gepflegt, wo Ordner entstehen und ihre Rechte gesetzt werden. Die Kachel blieb
      // stehen und zeigte auf eine Route, die es nicht mehr gibt.
      {
        title: 'Profilfelder',
        description: 'Welche Fragen das Profil stellt, und welche Antworten zur Auswahl stehen.',
        icon: ListChecks,
        to: { name: 'moderationProfileFields' },
        administratorOnly: true,
      },
    ],
  },
]

const sections = computed<Section[]>(() =>
  SECTIONS.map((section) => ({
    title: section.title,
    tiles: section.tiles.filter((tile) => !tile.administratorOnly || isAdministrator.value),
  })).filter((section) => section.tiles.length > 0),
)
</script>

<template>
  <AppLayout>
    <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
      <h1 class="text-h1">Moderation</h1>
      <p class="mt-2 max-w-[60ch] text-body text-ink-4">
        Die Werkzeuge des Teams. Nur für Moderation und Administration sichtbar.
      </p>

      <!-- First on the page, and the only thing here that changes colour. The count is the
           queue's own `totalResults` for open reports, so it cannot drift from what the page
           behind it shows. At zero it is an ordinary card: a box that is always red is a box
           nobody sees. -->
      <RouterLink
        :to="{ name: 'moderationReports' }"
        class="mt-6 flex items-start gap-3.5 rounded-lg border p-4 shadow-card transition-colors"
        :class="
          openReportCount > 0
            ? 'border-line-alert bg-surface-alert hover:border-destructive'
            : 'border-line-3 bg-paper-0 hover:border-line-5'
        "
      >
        <span
          class="flex size-9 flex-none items-center justify-center rounded-lg"
          :class="openReportCount > 0 ? 'bg-destructive text-paper-0' : 'bg-paper-3 text-oak-deep'"
        >
          <Flag :size="17" :stroke-width="1.5" aria-hidden="true" />
        </span>

        <div class="min-w-0 flex-1">
          <p class="text-h2 text-ink-1">
            Missbrauchsmeldungen
            <!-- The number is the point, so it is said as a number and not as a dot. -->
            <span
              v-if="openReportCount > 0"
              class="ml-2 align-middle font-medium text-destructive text-row"
            >
              {{ formatCount(openReportCount) }} offen
            </span>
          </p>
          <p class="mt-1 max-w-[70ch] text-[12px] leading-[1.45] text-ink-5">
            <template v-if="openReportCount > 0">
              Gemeldete Inhalte warten auf Bearbeitung. Prüfen, übernehmen und mit Begründung
              schließen.
            </template>
            <template v-else>
              Nichts Offenes. Die Warteschlange zeigt auch, was bereits geschlossen wurde.
            </template>
          </p>
        </div>
      </RouterLink>

      <section v-for="section in sections" :key="section.title" class="mt-8">
        <h2 class="font-mono text-[11px] tracking-wide text-ink-label uppercase">
          {{ section.title }}
        </h2>

        <div class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <RouterLink
            v-for="tile in section.tiles"
            :key="tile.title"
            :to="tile.to"
            class="rounded-lg border border-line-3 bg-paper-0 p-3.5 shadow-card transition-colors hover:border-line-5"
          >
            <span
              class="flex size-8 items-center justify-center rounded-lg bg-paper-3 text-oak-deep"
            >
              <component :is="tile.icon" :size="16" :stroke-width="1.5" aria-hidden="true" />
            </span>
            <p class="mt-2 flex items-baseline gap-2 text-row font-medium text-ink-2">
              {{ tile.title }}
              <!-- Nur wenn wirklich etwas wartet. Bei null ist die Kachel eine gewöhnliche: Ein
                   Zeichen, das immer da ist, wird nicht mehr gelesen. -->
              <span
                v-if="tile.waiting !== undefined && tile.waiting.value > 0"
                class="rounded-full bg-surface-alert px-1.5 py-px text-[11px] font-normal text-destructive"
              >
                {{ formatCount(tile.waiting.value) }} offen
              </span>
            </p>
            <p class="mt-1 text-[12px] leading-[1.45] text-ink-5">{{ tile.description }}</p>
          </RouterLink>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
