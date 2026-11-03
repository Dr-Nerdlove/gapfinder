<script lang="ts">
  import Chip from "../Chip.svelte";

  type Provider = "google" | "apple" | "outlook" | "other";

  const PROVIDERS: { id: Provider; label: string }[] = [
    { id: "google", label: "Google" },
    { id: "apple", label: "Apple (iCloud)" },
    { id: "outlook", label: "Outlook" },
    { id: "other", label: "Anderer" },
  ];

  let provider = $state<Provider | null>(null);
</script>

<div class="guide">
  <h3>1. Welchen Kalender benutzt du?</h3>
  <div class="chips" role="group" aria-label="Kalender-Anbieter">
    {#each PROVIDERS as p (p.id)}
      <Chip label={p.label} selected={provider === p.id} onclick={() => (provider = p.id)} />
    {/each}
  </div>
  <p class="note">
    Nicht sicher? Auf dem iPhone ist es meistens Apple (iCloud), auf Android-Handys meistens Google. Hast du eine Adresse mit @outlook.com,
    @hotmail.com oder @live.com oder nutzt du Outlook bei der Arbeit, ist es Outlook.
  </p>

  {#if provider}
    <h3>2. Link kopieren</h3>
    <div class="steps">
      {#if provider === "google"}
        <p>Das geht nicht in der Google-Kalender-App, aber im Browser – am Computer oder am Handy.</p>
        <h4>Am Computer</h4>
        <ol>
          <li>Öffne calendar.google.com im Browser und melde dich an.</li>
          <li>Klicke oben rechts auf das Zahnrad und dann auf „Einstellungen“.</li>
          <li>Klicke links unter „Einstellungen für meine Kalender“ auf deinen Kalender (meistens steht dort dein Name).</li>
          <li>Klicke darunter auf „Kalender integrieren“.</li>
          <li>Ganz unten steht „Privatadresse im iCal-Format“. Kopiere sie mit dem Kopier-Symbol daneben.</li>
        </ol>
        <h4>Am Handy</h4>
        <ol>
          <li>Öffne den Browser (zum Beispiel Chrome oder Safari), nicht die Kalender-App, und gehe auf calendar.google.com.</li>
          <li>
            Siehst du kein Zahnrad, schalte die Computer-Ansicht ein: in Chrome über das Menü ⋮ und „Desktopwebsite“, in Safari über „aA“
            und „Desktop-Website anfordern“.
          </li>
          <li>Mach weiter wie am Computer ab Schritt 2. Die Seite ist klein, du kannst sie mit zwei Fingern vergrößern.</li>
        </ol>
        <p class="note">Hast du mehrere Kalender, zum Beispiel Privat und Arbeit? Dann wiederhole das für jeden, der zählen soll.</p>
        <p class="note">
          Fehlt die „Privatadresse im iCal-Format“, hat dein Arbeitgeber oder deine Schule sie abgeschaltet. Mit diesem Kalender geht es
          dann leider nicht.
        </p>
      {:else if provider === "apple"}
        <p>Das geht nur mit iCloud-Kalendern. Kalender, die „Auf meinem iPhone“ liegen, lassen sich nicht verknüpfen.</p>
        <h4>Am iPhone oder iPad</h4>
        <ol>
          <li>Öffne die App „Kalender“.</li>
          <li>Tippe unten auf „Kalender“.</li>
          <li>Tippe neben deinem Kalender auf das kleine ⓘ.</li>
          <li>Schalte „Öffentlicher Kalender“ ein.</li>
          <li>Tippe auf „Link teilen …“ und dann auf „Kopieren“.</li>
        </ol>
        <h4>Am Mac</h4>
        <ol>
          <li>Öffne die App „Kalender“.</li>
          <li>Klicke links in der Liste mit der rechten Maustaste auf deinen Kalender und wähle „Kalender teilen …“.</li>
          <li>Setze das Häkchen bei „Öffentlicher Kalender“.</li>
          <li>Kopiere die Adresse, die darunter erscheint (sie beginnt mit „webcal://“).</li>
        </ol>
        <p class="note">
          „Öffentlich“ klingt schlimmer, als es ist: Der Kalender taucht nirgends auf. Lesen kann ihn nur, wer den Link kennt. Gib ihn deshalb
          niemandem sonst.
        </p>
      {:else if provider === "outlook"}
        <p>Das geht im Browser mit Outlook im Web, nicht in der Outlook-App.</p>
        <h4>Am Computer</h4>
        <ol>
          <li>Öffne outlook.com (privat) oder outlook.office.com (Arbeit) im Browser und melde dich an.</li>
          <li>Klicke oben rechts auf das Zahnrad (Einstellungen).</li>
          <li>Wähle „Kalender“ und dann „Freigegebene Kalender“.</li>
          <li>Wähle unter „Kalender veröffentlichen“ deinen Kalender und dann „Kann nur Verfügbarkeit anzeigen“.</li>
          <li>Klicke auf „Veröffentlichen“.</li>
          <li>Es erscheinen zwei Links. Klicke auf den ICS-Link und wähle „Link kopieren“.</li>
        </ol>
        <h4>Am Handy</h4>
        <ol>
          <li>Öffne Outlook im Browser, nicht in der App.</li>
          <li>
            Schalte die Computer-Ansicht ein: in Chrome über das Menü ⋮ und „Desktopwebsite“, in Safari über „aA“ und „Desktop-Website
            anfordern“.
          </li>
          <li>Mach weiter wie am Computer ab Schritt 2.</li>
        </ol>
        <p class="note">
          Mit „Kann nur Verfügbarkeit anzeigen“ verrät der Link nur, wann du belegt bist, keine Titel. Möchtest du in deiner Vorschau die
          Titel sehen, wähle stattdessen „Kann alle Details anzeigen“.
        </p>
        <p class="note">Bei Arbeitskonten kann die Firma das Veröffentlichen abgeschaltet haben.</p>
      {:else}
        <p>
          Viele Kalender bieten einen Link zum Abonnieren an. Er heißt oft „ICS“, „iCal“ oder „webcal“ und steht in den Einstellungen deines
          Kalenders. Der Link beginnt mit „https://“ oder „webcal://“.
        </p>
        <p class="note">Samsung-Kalender zeigt meistens die Termine deines Google-Kontos. Dann wähle oben „Google“.</p>
      {/if}
      {#if provider !== "apple"}
        <p class="note">Gib den Link niemandem sonst. Wer ihn hat, kann deinen Kalender lesen.</p>
      {/if}
    </div>
  {/if}

  <h3>3. Link hier einfügen</h3>
</div>

<style>
  .guide {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  h3 {
    margin: 8px 0 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  h4 {
    margin: 8px 0 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--md-sys-color-on-surface);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  ol {
    margin: 0;
    padding-left: 24px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .note {
    font-size: 0.875rem;
  }
</style>
