<script setup lang="ts">
/**
 * Lays out what `lib/imprint.ts` was configured with. German whatever the interface becomes: the
 * language of a legal notice is itself legally meaningful.
 */
import { APP_NAME } from '@/lib/branding'
import { WEBSITE_OPERATOR, WEBSITE_OPERATOR_ADDRESS } from '@/lib/websiteOperator'
</script>

<template>
  <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
    <div class="reading-column prose-legal">
      <h1 class="mb-6 text-h1 text-ink-1">Impressum</h1>

      <!-- DDG, not TMG: the duty moved in 2024 and the old citation is still copied around. -->
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>{{ WEBSITE_OPERATOR.name }}</p>

      <!-- Lines, not prose broken by `<br>`, so a screen reader reads it as an address. -->
      <address v-if="WEBSITE_OPERATOR_ADDRESS">
        <span v-if="WEBSITE_OPERATOR_ADDRESS.street" class="block">{{
          WEBSITE_OPERATOR_ADDRESS.street
        }}</span>
        <span class="block">{{ WEBSITE_OPERATOR_ADDRESS.town }}</span>
      </address>

      <h2>Kontakt</h2>
      <dl>
        <div v-if="WEBSITE_OPERATOR.telephoneNumber" class="flex flex-wrap gap-x-2">
          <dt>Telefon:</dt>
          <dd>
            <!-- Without the spaces a printed number carries, or a phone dials the gaps. -->
            <a :href="`tel:${WEBSITE_OPERATOR.telephoneNumber.replace(/\s/gu, '')}`">
              {{ WEBSITE_OPERATOR.telephoneNumber }}
            </a>
          </dd>
        </div>
        <div class="flex flex-wrap gap-x-2">
          <dt>E-Mail:</dt>
          <dd>
            <a :href="`mailto:${WEBSITE_OPERATOR.emailAddress}`">
              {{ WEBSITE_OPERATOR.emailAddress }}
            </a>
          </dd>
        </div>
      </dl>
      <p v-if="WEBSITE_OPERATOR.telephoneNumber" class="text-note text-ink-5">
        Support läuft über die E-Mail-Adresse; die Telefonnummer steht hier, weil das Gesetz einen
        zweiten Weg verlangt.
      </p>

      <!-- Not upstream's, and not decoration: § 5 DDG asks more of a commercial provider than of a
           private one, and saying which this is answers that outright rather than leaving a reader
           to infer it from the absence of a company. -->
      <h2>Hinweis zur Betriebsform</h2>
      <p>
        {{ APP_NAME }} ist ein privates, nicht gewerbliches Angebot. Es werden keine Entgelte
        erhoben und es wird keine Werbung geschaltet.
      </p>

      <!-- § 36 VSBG asks for this either way: being unwilling is an answer, and silence is not. -->
      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Wir sind zur Teilnahme an einem Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle weder verpflichtet noch bereit.
      </p>

      <!-- The one section a writing platform cannot do without, since almost everything on it was
           written by somebody else. It names the report function before the address: a notice that
           gives only an address sends people to e-mail for something the site already handles. -->
      <h2>Haftung für Inhalte von Mitgliedern</h2>
      <p>
        Die Beiträge in Gruppen, im Forum und in Profilen stammen von den Mitgliedern selbst. Wir
        machen sie uns nicht zu eigen. Wenn dir ein Inhalt auffällt, der gegen Rechte oder Regeln
        verstößt, melde ihn über die Meldefunktion oder schreib an die oben genannte Adresse — wir
        sehen uns das an.
      </p>
    </div>
  </div>
</template>
