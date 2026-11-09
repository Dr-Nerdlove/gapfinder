// Texts of the small "?" help windows (`HelpHint`). `**…**` marks bold parts. Numbers that also exist as
// constants in `shared` are built from them, so the explanation cannot drift away from the behaviour.
import {
  CALENDAR_CACHE_MINUTES,
  DAYS_SEARCH_MIN_EVENT_HOURS,
  NEAR_MISS_MIN_PEOPLE,
  SEARCH_DEFAULT_WINDOW,
  SEARCH_MAX_BUFFER_MINUTES,
} from "@lueckenfueller/shared";

export type HelpTopic =
  | "calendarBusy"
  | "calendarPreview"
  | "calendarFeed"
  | "searchKind"
  | "searchBuffer"
  | "searchWindow"
  | "resultsPartial"
  | "resultsSkipped"
  | "pollAnswers"
  | "pollFix"
  | "pollShare";

export interface HelpText {
  title: string;
  paragraphs: string[];
}

/** "09:00" -> "9". */
function hourOf(clock: string): string {
  return String(Number(clock.slice(0, 2)));
}

const MIN_HOURS = `${DAYS_SEARCH_MIN_EVENT_HOURS} Stunden`;
const MAX_BUFFER = `${SEARCH_MAX_BUFFER_MINUTES / 60} Stunden`;

export const HELP_TEXTS: Record<HelpTopic, HelpText> = {
  calendarBusy: {
    title: "Wann ein Termin zählt",
    paragraphs: [
      "Hier legst du fest, ob dieser Kalender bei der Suche mitzählt: **Stunden** für die Suche nach freien Stunden, **Ganze Tage** für die Suche nach freien Tagen am Stück.",
      `Termine, die im Kalender als „frei“ eingetragen sind, zählen nie. Abgesagte Termine zählen nie, Termine „mit Vorbehalt“ schon. Bei „Ganze Tage“ zählen nur Termine ab ${MIN_HOURS} – also Urlaub, Reisen oder ganztägige Termine, aber kein Zahnarzttermin.`,
      "Beispiel: Einen Kalender mit Schulferien oder Feiertagen schaltest du ganz aus, einen Schichtkalender nur bei „Ganze Tage“.",
    ],
  },
  calendarPreview: {
    title: "Deine Vorschau",
    paragraphs: [
      "So sieht Lückenfüller deine Termine. Die Titel siehst nur du; andere erfahren nie, was du vorhast, nur dass du keine Zeit hast. „zählt nicht“ heißt: Der Termin ist im Kalender als „frei“ eingetragen.",
      `Neue Termine erscheinen hier erst nach bis zu ${CALENDAR_CACHE_MINUTES} Minuten, weil Lückenfüller den Kalender so lange zwischenspeichert. Manche Anbieter brauchen zusätzlich etwas länger.`,
    ],
  },
  calendarFeed: {
    title: "Feste Termine automatisch im Kalender",
    paragraphs: [
      "Diesen Kalender abonnierst du einmal in deiner Kalender-App. Danach erscheinen dort alle festgelegten Termine deiner Abstimmungen von selbst (außer denen, zu denen du „Nein“ gesagt hast).",
      "Google Kalender aktualisiert abonnierte Kalender nur alle paar Stunden – ein neuer Termin kann dort also etwas später auftauchen.",
      "Gib den Link nicht weiter: Wer ihn hat, sieht deine festgelegten Termine. Mit „Neuer Link“ machst du den alten ungültig.",
    ],
  },
  searchKind: {
    title: "Stunden oder ganze Tage?",
    paragraphs: [
      "**Stunden** findet freie Zeiten an einzelnen Tagen, z. B. 3 Stunden für ein Abendessen an einem Freitag oder Samstag.",
      `**Ganze Tage** findet mehrere freie Tage am Stück, z. B. ein Wochenende für einen Ausflug. Ein Tag gilt als frei, wenn niemand an diesem Tag einen Termin von ${MIN_HOURS} oder länger hat.`,
    ],
  },
  searchBuffer: {
    title: "Puffer",
    paragraphs: [
      `So viel Zeit bleibt vor und nach jedem Termin frei, etwa für den Weg. Bei 30 Minuten Puffer schlägt Lückenfüller nach einem Termin bis 18 Uhr erst ab 18:30 Uhr etwas vor. Möglich sind bis zu ${MAX_BUFFER}.`,
    ],
  },
  searchWindow: {
    title: "Zeitfenster",
    paragraphs: [
      `Nur in dieser Tageszeit wird gesucht (ohne Angabe ${hourOf(SEARCH_DEFAULT_WINDOW.start)} bis ${hourOf(SEARCH_DEFAULT_WINDOW.end)} Uhr). Das Fenster darf über Mitternacht gehen: „20 bis 2 Uhr“ sucht bis 2 Uhr am nächsten Morgen.`,
    ],
  },
  resultsPartial: {
    title: "Fast alle",
    paragraphs: [
      `Zeiten, an denen nur wenige keine Zeit haben – und wer. Nützlich, wenn es für alle keinen gemeinsamen Termin gibt. Das gibt es ab ${NEAR_MISS_MIN_PEOPLE} Personen; fehlen darf höchstens ein Fünftel der Leute (mindestens eine Person).`,
    ],
  },
  resultsSkipped: {
    title: "Warum fehlt jemand?",
    paragraphs: [
      "Diese Personen wurden bei der Suche ausgelassen: Sie haben noch keinen Kalender verknüpft, oder einer ihrer Kalender konnte gerade nicht ganz gelesen werden. Lückenfüller zählt sie dann lieber nicht mit, statt sie fälschlich als „frei“ anzuzeigen. Frag sie am besten selbst.",
    ],
  },
  pollAnswers: {
    title: "So wird gezählt",
    paragraphs: [
      "Hervorgehoben ist der Termin mit den meisten „Ja“; bei Gleichstand der mit den wenigsten „Nein“. „Vielleicht“ macht einen Termin nicht zum Sieger, wird aber angezeigt – und wer „Vielleicht“ sagt, bekommt den Termin trotzdem, wenn er festgelegt wird.",
    ],
  },
  pollFix: {
    title: "Termin festlegen",
    paragraphs: [
      "Vorher prüft Lückenfüller die Kalender noch einmal und warnt dich, falls inzwischen jemand keine Zeit mehr hat. Du kannst trotzdem festlegen.",
      "Danach kann niemand mehr abstimmen. Wer „Ja“ oder „Vielleicht“ gesagt oder noch nicht abgestimmt hat, bekommt eine Benachrichtigung, und der Termin erscheint im Lückenfüller-Kalender. Du kannst ihn später ändern oder die Festlegung aufheben.",
    ],
  },
  pollShare: {
    title: "Wer mit dem Link abstimmen kann",
    paragraphs: [
      "Jeder, der den Link hat, kann abstimmen – auch ohne Konto. Gäste geben dafür nur einen Namen ein und können ihre Stimme später nur auf demselben Gerät ändern.",
      "Ist der Link in falsche Hände geraten, erzeugst du einen neuen; der alte funktioniert dann nicht mehr.",
    ],
  },
};

export interface HelpSegment {
  text: string;
  strong: boolean;
}

/** Splits `**bold**` markers into segments; an unmatched `**` stays literal text. */
export function helpSegments(paragraph: string): HelpSegment[] {
  const segments: HelpSegment[] = [];
  let rest = paragraph;
  while (rest.length > 0) {
    const open = rest.indexOf("**");
    const close = open === -1 ? -1 : rest.indexOf("**", open + 2);
    if (open === -1 || close === -1) {
      segments.push({ text: rest, strong: false });
      break;
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), strong: false });
    if (close > open + 2) segments.push({ text: rest.slice(open + 2, close), strong: true });
    rest = rest.slice(close + 2);
  }
  return segments;
}

/**
 * A title cut before its last word (`head` keeps the space), so the "?" button can stay on the line of that word:
 * "Mein Lückenfüller-Kalender" -> { head: "Mein ", last: "Lückenfüller-Kalender" }.
 */
export function splitLastWord(title: string): { head: string; last: string } {
  const trimmed = title.trimEnd();
  const cut = trimmed.lastIndexOf(" ") + 1;
  return { head: trimmed.slice(0, cut), last: trimmed.slice(cut) };
}
