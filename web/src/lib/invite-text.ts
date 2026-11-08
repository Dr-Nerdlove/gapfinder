/**
 * The "So geht's" message the admin sends to a new person together with their invite link (phase 9e).
 * Written for WhatsApp, where `*text*` is bold. WhatsApp indents a numbered step only up to the next line break, so
 * each step stays on one line; the link comes last in step 1 so it stands on its own. The days come from
 * `INVITE_VALID_DAYS`, so the text cannot drift from what the server does.
 */
export function inviteMessage(link: string, validDays: number): string {
  return [
    "Hello there! 👋 Hier deine persönliche Einladung zum *Lückenfüller*. Das ist eine kleine App, die herausfindet, wann wir alle im Freundeskreis gleichzeitig Zeit haben. So müssen wir nicht mehr ewig im Chat hin und her schreiben.",
    "",
    "*So geht's:*",
    `1. Öffne deinen Einladungslink und leg ein Passwort fest. Der Link funktioniert ${validDays} Tage lang und nur einmal: ${link}`,
    "2. Verknüpfe dann deinen Kalender (Google, Apple oder Outlook). Die App zeigt dir Schritt für Schritt wie das geht. Du kannst bei Bedarf auch mehrere Kalender verknüpfen. *Deine Termine bleiben dabei immer privat:* Alle anderen sehen nur „frei“ oder „belegt“, nie, was genau du vorhast.",
    "3. Das war's dann auch schon. Ab jetzt findet die App die gemeinsamen Lücken. Abstimmen können Gäste übrigens auch ohne ein eigenes Konto.",
    "",
    "Auch noch gut zu wissen: Nachts von 1 bis 7 Uhr schläft der Server. In der Zeit funktioniert die App nur eingeschränkt.",
  ].join("\n");
}
