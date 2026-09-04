<script setup lang="ts">
/**
 * What this deployment actually does with what people give it.
 *
 * **Upstream's version of this page is a general template** — the standard German one, thorough on
 * rights and law and silent on the software. It never mentions an account, a group, a post, a chat
 * or a report, because a template cannot know them. This fork keeps upstream's shell, its route and
 * its configured operator and hoster, and replaces the body with an inventory of what this platform
 * really processes: sessions and their IP addresses, the fifteen-minute activity windows, the
 * password check against a third party, moderation records, and the Blind-Date.
 *
 * That is not a disagreement with upstream. A privacy policy is only worth anything if it is true
 * of the instance serving it, and this instance has a forum, status updates and a Blind-Date that
 * upstream does not. A later merge should keep this body and take improvements to the frame.
 *
 * **German whatever the interface becomes**, like the legal notice: the language of a document like
 * this is itself legally meaningful.
 *
 * Names and addresses come from the deployment's configuration rather than the text, so a second
 * instance does not publish this one's operator. Everything that is a property of the software
 * rather than of the operator is written out here, because that is what it is.
 */
import { APP_NAME } from '@/lib/branding'
import { HOSTER, HOSTER_ADDRESS } from '@/lib/hoster'
import { WEBSITE_OPERATOR, WEBSITE_OPERATOR_ADDRESS } from '@/lib/websiteOperator'

/**
 * The day the text last changed, written out rather than generated: „Stand" means when somebody
 * last checked that this describes the software, and a build date would quietly claim that on
 * every deploy.
 */
const LAST_REVIEWED = '4. September 2026'
</script>

<template>
  <div class="flex-1 overflow-auto px-gutter py-5 pb-8 md:px-10">
    <div class="reading-column prose-legal">
      <h1 class="mb-6 text-h1 text-ink-1">Datenschutzerklärung</h1>

      <p>
        Diese Erklärung beschreibt, welche Daten {{ APP_NAME }} verarbeitet, warum, und wie lange.
      </p>

      <h2>1. Verantwortlich</h2>
      <p>{{ WEBSITE_OPERATOR.name }}</p>
      <address v-if="WEBSITE_OPERATOR_ADDRESS">
        <span v-if="WEBSITE_OPERATOR_ADDRESS.street" class="block">{{
          WEBSITE_OPERATOR_ADDRESS.street
        }}</span>
        <span class="block">{{ WEBSITE_OPERATOR_ADDRESS.town }}</span>
      </address>
      <p>
        E-Mail:
        <a :href="`mailto:${WEBSITE_OPERATOR.emailAddress}`">
          {{ WEBSITE_OPERATOR.emailAddress }}
        </a>
      </p>
      <p>
        Eine Datenschutzbeauftragte oder einen Datenschutzbeauftragten gibt es nicht; dazu sind wir
        nicht verpflichtet.
      </p>

      <h2>2. Wo die Daten liegen</h2>
      <p>
        Die Plattform läuft auf einem Server von {{ HOSTER.name
        }}<template v-if="HOSTER_ADDRESS">
          , {{ HOSTER_ADDRESS.street ? `${HOSTER_ADDRESS.street}, ` : ''
          }}{{ HOSTER_ADDRESS.town }} </template
        >. Mit dem Anbieter besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
      </p>

      <h2>3. Wenn du ein Konto anlegst</h2>
      <p>
        Gespeichert werden: Benutzername, E-Mail-Adresse und dein Passwort — letzteres nur als
        kryptografischer Hash, aus dem es sich nicht zurückrechnen lässt. Dazu der Zeitpunkt der
        Registrierung und, sobald du sie bestätigst, der Zeitpunkt der Bestätigung.
      </p>
      <p>
        Freiwillig sind alle Profilangaben: Über mich, bevorzugte Schreibweise, Beitragslänge,
        Schreibhäufigkeit, Erwartungen an Mitschreibende, NO-GOs und Lieblingsgenres. Du kannst sie
        jederzeit ändern oder leer lassen.
      </p>
      <p>
        Zweck: die Bereitstellung des Kontos. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO — ohne
        diese Daten gibt es kein Konto.
      </p>

      <h2>4. Passwortprüfung über einen Dritten</h2>
      <p>
        Wenn du ein Passwort setzt, prüfen wir, ob es in bekannten Datenlecks vorkommt. Dafür wird
        der Dienst „Have I Been Pwned" (haveibeenpwned.com) angefragt.
      </p>
      <p>
        Dein Passwort verlässt den Server dabei nicht. Es wird gehasht, und nur die ersten fünf
        Zeichen dieses Hashs werden übermittelt; der Abgleich findet bei uns statt. Der Dienst kann
        daraus nicht erkennen, um welches Passwort es geht, und erfährt nicht, wer du bist.
      </p>
      <p>Zweck: Schutz deines Kontos. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO.</p>

      <h2>5. Wenn du angemeldet bist</h2>
      <p>
        Zu jeder Sitzung speichern wir deine IP-Adresse, die Kennung deines Browsers (User-Agent)
        und wann die Sitzung begann. Eine Sitzung läuft nach 24 Stunden ohne Verlängerung ab und
        wird dann gelöscht.
      </p>
      <p>
        Außerdem halten wir fest, in welchen 15-Minuten-Fenstern du online warst. Daraus ergibt
        sich, wie aktiv jemand ist — das brauchen wir unter anderem für die Teilnahmebedingung beim
        Blind-Date. Diese Einträge werden nach 32 Tagen automatisch gelöscht.
      </p>
      <p>
        Zweck: Betrieb, Sicherheit und Missbrauchserkennung. Rechtsgrundlage: Art. 6 Abs. 1 lit. f
        DSGVO.
      </p>

      <h2>6. Was du schreibst</h2>
      <p>
        Beiträge in Gruppen und im Forum, Nachrichten in Chats, Storyideen, Statusmeldungen,
        Kommentare und hochgeladene Bilder speichern wir, solange die Plattform besteht oder bis du
        sie löschst. Wer sie sehen kann, hängt von der jeweiligen Sichtbarkeit ab — bei Gruppen
        entscheidet ihr das selbst.
      </p>
      <p>Zweck: der Sinn der Plattform. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>

      <h2>7. Moderation</h2>
      <p>
        Wenn du etwas meldest, speichern wir die Meldung mit deinem Namen, dem gemeldeten Inhalt und
        deiner Begründung. Ergreift das Team Maßnahmen — Verwarnung, Sperre, Ausschluss vom
        Blind-Date — wird auch das mit Grund und Zeitpunkt festgehalten.
      </p>
      <p>
        Für die Moderation können IP-Adressen von Konten eingesehen und verglichen werden, um
        Mehrfachkonten und Umgehungen von Sperren zu erkennen.
      </p>
      <p>
        Zum Blind-Date führt das Team außerdem eine Übersicht: wie viele Blind-Dates ein Mitglied
        bis zur Enthüllung geführt hat, wie viele vorzeitig endeten, und wer sie beendet hat. Sie
        hilft, ein Muster von ein paar Runden zu unterscheiden, die einfach nicht gepasst haben —
        ein Blind-Date endet aus allerlei gewöhnlichen Gründen. Diese Übersicht sieht nur das Team.
        Auf deinem eigenen Profil steht lediglich, wie viele du abgeschlossen hast; andere
        Mitglieder sehen auch das nicht.
      </p>
      <p>
        Zweck: ein Umgang miteinander, der für alle tragbar ist. Rechtsgrundlage: Art. 6 Abs. 1 lit.
        f DSGVO.
      </p>

      <h2>8. E-Mails</h2>
      <p>
        Wir schreiben dir bei der Registrierung, beim Zurücksetzen des Passworts, bei Änderung der
        E-Mail-Adresse und bei Ankündigungen des Teams.
      </p>
      <p>
        Solange die Plattform ohne echten Mail-Anbieter läuft, werden diese Nachrichten nicht
        zugestellt, sondern in einem Postfach auf dem eigenen Server gesammelt, auf das nur das Team
        zugreifen kann.
      </p>

      <h2>9. Blind-Date</h2>
      <p>
        Beim Blind-Date schreiben zwei Menschen zunächst anonym miteinander. Innerhalb der Gruppe
        siehst du nicht, wer die andere Person ist, sondern nur „Blind-Date-Partner 1" oder „2".
        Auch Benachrichtigungen nennen keine Namen.
      </p>
      <p>
        Wer mit wem schreibt, ist auf dem Server gespeichert und für die Moderation einsehbar — sie
        muss handeln können, wenn etwas schiefgeht. Öffentlich wird es erst, wenn ihr euch beide
        dafür entscheidet.
      </p>
      <p>
        Nach dem Ende fragen wir freiwillig nach einer kurzen Rückmeldung. Die Antworten sieht nur
        das Team, nie die andere Person.
      </p>

      <h2>10. Cookies</h2>
      <p>
        Wir setzen ein einziges Cookie: die Sitzungskennung, die dich angemeldet hält. Es ist
        technisch notwendig, läuft nach 24 Stunden ab und wird nicht für Werbung oder Statistik
        verwendet. Es gibt kein Tracking, keine Analysedienste und keine eingebundenen Inhalte
        Dritter.
      </p>

      <h2>11. Sicherungskopien</h2>
      <p>
        Vom Datenbestand werden täglich Sicherungen erstellt und 14 Tage aufbewahrt. Löschst du dein
        Konto, kann es bis zu 14 Tage dauern, bis auch die Sicherungen es nicht mehr enthalten.
      </p>

      <h2>12. Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17),
        Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch
        (Art. 21 DSGVO).
      </p>
      <p>
        Schreib dafür an
        <a :href="`mailto:${WEBSITE_OPERATOR.emailAddress}`">
          {{ WEBSITE_OPERATOR.emailAddress }} </a
        >. Wir melden uns.
      </p>
      <p>
        Außerdem kannst du dich bei einer Aufsichtsbehörde beschweren. Zuständig ist die Behörde
        deines Wohnorts oder die des Verantwortlichen.
      </p>

      <h2>13. Änderungen</h2>
      <p>
        Ändert sich, wie die Plattform mit Daten umgeht, ändern wir diese Seite. Bei wesentlichen
        Änderungen sagen wir vorher Bescheid.
      </p>

      <p>Stand: {{ LAST_REVIEWED }}</p>
    </div>
  </div>
</template>
