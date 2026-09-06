<script setup lang="ts">
/**
 * Ein Gespräch, wie das Team es liest.
 *
 * **Ein Bauteil für zwei Orte, und das ist der Preis des zweiten.** Der Verlauf steht im Postfach
 * der Administration und unter „Gesendete" bei der Rundmail, die ihn ausgelöst hat. Zwei Fassungen
 * desselben driften auseinander, sobald jemand nur eine anfasst — die Trennung zwischen dem Namen
 * nach außen und dem Menschen dahinter wäre dann an einer Stelle sichtbar und an der anderen nicht.
 *
 * **Was hier steht, entscheidet der Server.** `fromTeam` und `writtenByUsername` kommen fertig; die
 * Ansicht rechnet nichts aus, was mit Zuständigkeit oder Maske zu tun hat.
 */
import { formatActivityTime } from '@/lib/format/formatTime'

/** Dieselbe Form in beiden Schnittstellen — Postfach und Rundmail-Antworten. */
export type TeamMessage = {
  id: string
  text: string
  createdAt: string
  username: string | null
  fromTeam: boolean
  isAnnouncement: boolean
  writtenByUsername: string | null
}

defineProps<{ messages: TeamMessage[] }>()
</script>

<template>
  <ul class="flex flex-col gap-2 border-l-2 border-line-4 pl-3">
    <li v-for="message in messages" :key="message.id">
      <!-- **Die Rundmail heißt Rundmail, nicht „Team".**
           Stand sie wie eine Antwort der Administration da, las sich der Verlauf verkehrt herum:
           eine Antwort, die vor der Frage steht, und der obendrein der Verfasser fehlt. Genau so
           ist es beim Durchklicken gelesen worden — und der Schluss war folgerichtig, die Anzeige
           war es nicht.

           Der Verfasser steht nur bei den Antworten der Administration. Bei der Rundmail ist er
           leer, weil er auf der Veröffentlichung steht und unter „Gesendete" gezeigt wird; bei
           einer Nachricht des Mitglieds ist der Name selbst schon die Wahrheit. -->
      <p class="text-[12px] text-ink-6">
        <template v-if="message.isAnnouncement">Rundmail</template>
        <template v-else-if="message.fromTeam">Team</template>
        <template v-else>{{ message.username ?? 'Gelöschtes Konto' }}</template>
        · {{ formatActivityTime(message.createdAt) }}
        <template v-if="message.writtenByUsername">
          · geschrieben von {{ message.writtenByUsername }}
        </template>
      </p>
      <p class="max-w-[70ch] text-[12.5px] whitespace-pre-line text-ink-3">
        {{ message.text }}
      </p>
    </li>
  </ul>
</template>
