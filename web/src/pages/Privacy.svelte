<script lang="ts">
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import Page from "../components/Page.svelte";
  import { sessionState } from "../lib/session.svelte";
</script>

<Page title="Was mit deinem Kalender passiert" subtitle="Kurz und ehrlich erklärt">
  <Card title="Was deine Freunde sehen">
    <ul>
      <li>Nur, ob du zu einer Zeit frei oder belegt bist. Nie, was du vorhast: keine Titel, keine Orte, keine Notizen.</li>
      <li>Kann dein Kalender gerade nicht gelesen werden, sehen sie „Kalender nicht lesbar“, aber nicht, warum.</li>
    </ul>
  </Card>

  <Card title="Was der Admin in der App sieht">
    <ul>
      <li>Die Benutzernamen und wie viele Kalender gerade ein Problem haben. Keine Termine und keine Kalender-Links.</li>
    </ul>
  </Card>

  <Card title="Was du selbst siehst">
    <ul>
      <li>Auf der Seite „Kalender“ siehst du deine nächsten 4 Wochen mit den Titeln deiner Termine. Diese Vorschau bekommst nur du.</li>
    </ul>
  </Card>

  <Card title="Was gespeichert wird">
    <ul>
      <li>Nur der Link zu deinem Kalender (verschlüsselt), der Name, den du ihm gibst, und deine Einstellungen.</li>
      <li>
        Deine Termine werden nie gespeichert. Der Server liest deinen Kalender nur, wenn er ihn braucht: für deine Vorschau, für eine Suche
        und bevor ein Termin festgelegt wird. Danach behält er ihn höchstens 15 Minuten im Arbeitsspeicher und vergisst ihn dann. Termine
        landen nie in der Datenbank, in einem Protokoll oder in einer Sicherung.
      </li>
      <li>Entfernst du einen Kalender oder wird dein Konto gelöscht, ist auch der Link weg.</li>
      <li>
        Schaltest du Benachrichtigungen für ein Gerät ein, speichert der Server die Adresse dieses Geräts beim Push-Dienst deines Browsers
        und dessen Schlüssel. Das bleibt, bis du sie auf dem Gerät ausschaltest, dich dort abmeldest, der Browser das Gerät als nicht mehr
        erreichbar meldet oder dein Konto gelöscht wird.
      </li>
      <li>Deine Einstellungen für Benachrichtigungen, also welche du bekommen willst.</li>
      <li>
        Jede Benachrichtigung wird 7 Tage für dich aufbewahrt (für die spätere Android-App) und dann gelöscht.
      </li>
      <li>
        Die Nachrichten laufen verschlüsselt über den Push-Dienst deines Browsers (Google, Apple, Mozilla oder Microsoft). Dieser reicht
        sie nur weiter und kann sie nicht lesen.
      </li>
      <li>Gäste bekommen keine Benachrichtigungen, und von ihren Geräten wird nichts gespeichert.</li>
    </ul>
  </Card>

  <Card title="Ehrlich gesagt: Wo die Grenze liegt" tone="notice">
    <ul>
      <li>
        Lückenfüller läuft auf einem eigenen Server des Admins, nicht bei einer großen Firma. Damit der Server für eine Suche deinen
        Kalender lesen kann, muss er den Link entschlüsseln können. Wer diesen Server selbst verwaltet, könnte das deshalb mit Absicht und
        technischem Wissen auch selbst tun und so deinen Kalender lesen. In der App gibt es dafür keinen Weg.
      </li>
      <li>
        Der Admin kann außerdem einen Link zum Zurücksetzen deines Passworts erstellen, falls du es vergessen hast. Würde dieser Link
        missbraucht, wärst du danach auf all deinen Geräten abgemeldet. Passiert dir das, ohne dass du dein Passwort geändert hast, frag
        nach.
      </li>
      <li>
        Der Programmcode von Lückenfüller ist öffentlich auf
        <a href="https://github.com/Dr-Nerdlove/gapfinder" target="_blank" rel="noopener noreferrer">GitHub</a>. Jeder kann nachlesen, was
        die App mit deinem Kalender macht.
      </li>
    </ul>
  </Card>

  <Card title="So schützt du dich zusätzlich">
    <ul>
      <li>
        Outlook: Wähle beim Veröffentlichen „Kann nur Verfügbarkeit anzeigen“. Dann enthält schon der Link nur „belegt“ und „frei“, keine
        Titel – auch nicht für den Server. Dafür siehst du auch in deiner Vorschau keine Titel.
      </li>
      <li>Google und Apple bieten das für diesen Link leider nicht an. Verknüpfe dort nur die Kalender, die für Treffen wichtig sind.</li>
      <li>Gib den Link niemandem sonst. Wer ihn hat, kann deinen Kalender lesen.</li>
      <li>
        Willst du sicher sein, dass ein Link nirgends mehr funktioniert, entferne den Kalender in Lückenfüller und mach den Link ungültig.
        Google: „Zurücksetzen“ neben der Privatadresse. Apple: „Öffentlicher Kalender“ ausschalten. Outlook: die Veröffentlichung beenden.
      </li>
    </ul>
  </Card>

  {#if sessionState.user}
    <div><Button variant="tonal" href="#/kalender">Zu deinen Kalendern</Button></div>
  {/if}
</Page>

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding-left: 20px;
  }

  a {
    color: inherit;
    font-weight: 500;
    text-decoration: underline;
  }
</style>
