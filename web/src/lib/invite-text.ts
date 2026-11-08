/**
 * The "So geht's" message the admin sends to a new person together with their invite link (phase 9e).
 * Written for WhatsApp, where `*text*` is bold. The days come from `INVITE_VALID_DAYS`, so the text cannot drift
 * from what the server does.
 */
export function inviteMessage(link: string, validDays: number): string {
  return [
    "Hello there! 👋 Hier deine persönliche Einladung zum Lückenfüller. Das ist eine kleine App, die herausfindet, wann wir alle im Freundeskreis gleichzeitig Zeit haben. So müssen wir das nicht mehr umständlich durchs Hin-und-her-Chatten herausfinden.",
    "",
    "*So geht's:*",
    `1. Öffne deinen Einladungslink und leg ein Passwort fest: ${link}`,
    `Der Link gilt ${validDays} Tage und funktioniert nur einmal.`,
    "2. Verknüpfe einmal deinen Kalender (Google, Apple oder Outlook). Die App zeigt dir Schritt für Schritt, wie du in deinem Kalender einen Link kopierst. Du kannst bei Bedarf auch mehrere Kalender verknüpfen.",
    "3. Das war's dann auch schon. Ab jetzt findet die App die gemeinsamen Lücken. Abstimmen können Gäste übrigens auch ohne ein eigenes Konto.",
    "",
    "*Ein Hinweis zum Datenschutz:* Deine Termine bleiben immer privat: Alle anderen sehen nur „frei“ oder „belegt“, nie, was genau du vorhast.",
    "",
    "Auch noch gut zu wissen: Nachts von 1 bis 7 Uhr schläft der Server. In der Zeit funktioniert die App nur eingeschränkt.",
  ].join("\n");
}
