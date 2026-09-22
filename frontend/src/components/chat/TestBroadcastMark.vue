<script setup lang="ts">
/**
 * Die Markierung einer Test-Rundmail: — T E S T - R U N D M A I L —, fett.
 *
 * **Überall dieser eine Baustein** — vor dem Text im Postfach und am Faden in der Gesprächsliste —,
 * damit es überall gleich aussieht und keine Stelle eine eigene Schreibweise bekommt.
 *
 * **Gesperrt nur fürs Auge.** Im Dokument steht „Test-Rundmail", ganz gewöhnlich geschrieben;
 * Großbuchstaben und Abstand kommen aus dem Stil. Echte Leerzeichen zwischen den Buchstaben sähen
 * genauso aus, aber ein Vorleseprogramm läse dann Buchstabe für Buchstabe, und die Suche auf der
 * Seite fände das Wort nicht. Aus demselben Grund sind die Gedankenstriche für Vorleseprogramme
 * ausgeblendet: Sie sind Schmuck, und „Gedankenstrich, Test-Rundmail, Gedankenstrich" sagt nichts.
 *
 * Die Mail kann weder fett noch gesperrt; dort steht `MAIL_TEST_MARK` aus dem Backend, so nah
 * daran, wie eine Betreffzeile es zulässt.
 */
</script>

<template>
  <span class="font-bold tracking-[0.3em] uppercase"
    ><span aria-hidden="true">— </span>Test-Rundmail<span aria-hidden="true"> —</span></span
  >
</template>
