// Shared by fake-server.mts and seed.mjs: the evening of the cinema pictures (phase 10d) and the calendars that make it
// work. Plain JavaScript so that seed.mjs can import it without tsx.

/** The people of the cinema search ("du" is Vincent). Their calendars are free on the cinema day, except Tobi's. */
export const CINEMA_PEOPLE = ["Vincent", "Anna", "Tobi", "Emil", "Berta"];

/** The first Saturday at least 8 days ahead, as "YYYY-MM-DD" (UTC date, like the poll's Saturdays). */
export function cinemaDay(now = Date.now()) {
  for (let days = 8; ; days++) {
    const d = new Date(now + days * 86400000);
    if (d.getUTCDay() === 6) return d.toISOString().slice(0, 10);
  }
}

/** The instant of a Berlin wall clock ("YYYY-MM-DD", "HH:MM"). */
export function berlinInstant(day, clock) {
  const noon = new Date(`${day}T12:00:00Z`);
  const berlinNoon = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(noon));
  return new Date(Date.parse(`${day}T${clock}:00Z`) - (berlinNoon - 12) * 3600000);
}

/** Tobi is busy from 17:00 to 18:30 on the cinema day: the 17:30 showing does not fit because of him. */
export const TOBI_BUSY = { from: "17:00", to: "18:30" };

// ---------- the film choice (phase 10d, variant B) ----------
// Made-up cinemas and a made-up cineamo for the three-step film choice. The ids and names are invented (never real
// cinemas); fake-server.mts answers the server's requests to api.cineamo.com with `cineamoAnswer`.

/** `CINEMAS` of the film choice pictures (`<id>=<name>|<screen>`). */
export const FILM_CINEMAS = "9001=Stadtkino am Markt;9002=Filmpalast Nord|IMAX;9003=Lichtspiele Altstadt;9004=Cinema Bahnhof;9005=Studio 7";

/** The films: cineamo's content id and movie id, the original language and the length (none for "Kaiser der Kartoffeln"). */
const FILMS = {
  lighthouse: { contentId: 501, movieId: 7001, original: "eng", runtime: 159 },
  train: { contentId: 502, movieId: 7002, original: "deu", runtime: 112 },
  sugar: { contentId: 503, movieId: 7003, original: "fra", runtime: 125 },
  stardust: { contentId: 504, movieId: 7004, original: "deu", runtime: 94 },
  marathon: { contentId: 505, movieId: 7005, original: "eng", runtime: 192 },
  potato: { contentId: 506, movieId: 7006, original: "deu" },
};
const ROOMS = { 9002: { 1: "IMAX", 2: "3" } };

// [clock, film, name, language, room id]. The evening: Tobi is busy until 18:30, the window ends at 23:00.
const SHOWINGS = {
  9001: [
    ["17:30", "lighthouse", "Der letzte Leuchtturm", "deu"],
    ["19:30", "lighthouse", "Der letzte Leuchtturm", "deu"],
    ["22:00", "lighthouse", "Der letzte Leuchtturm", "deu"],
    ["18:45", "train", "Nachtzug nach Lissabon Nord", "deu"],
    ["20:30", "train", "Nachtzug nach Lissabon Nord", "deu"],
    ["19:00", "sugar", "Das Geheimnis der Zuckerfabrik", "deu"],
    ["14:30", "marathon", "Der Marathon-Mörder", "eng"],
    ["15:30", "potato", "Kaiser der Kartoffeln", "deu"],
  ],
  9002: [
    ["18:15", "lighthouse", "Der letzte Leuchtturm", "deu", 2],
    ["20:00", "lighthouse", "Der letzte Leuchtturm", "eng", 1],
    ["19:15", "train", "Nachtzug nach Lissabon Nord", "deu", 2],
    ["19:30", "sugar", "Das Geheimnis der Zuckerfabrik", "fra", 1],
    ["18:45", "stardust", "Sternenstaub und Seifenblasen", "deu", 2],
    ["14:00", "marathon", "Der Marathon-Mörder", "eng", 2],
  ],
  9003: [
    ["20:00", "sugar", "Das Geheimnis der Zuckerfabrik", "deu"],
    ["19:15", "stardust", "Sternenstaub und Seifenblasen", "deu"],
    ["20:15", "train", "Nachtzug nach Lissabon Nord", "deu"],
    ["16:00", "potato", "Kaiser der Kartoffeln", "deu"],
  ],
  9004: [
    ["19:45", "lighthouse", "Der letzte Leuchtturm (2D)", "deu"],
    ["19:30", "train", "Nachtzug nach Lissabon Nord", "deu"],
    ["15:00", "marathon", "Der Marathon-Mörder", "eng"],
  ],
  9005: [
    ["19:00", "stardust", "Sternenstaub und Seifenblasen", "deu"],
    ["17:30", "potato", "Kaiser der Kartoffeln", "deu"],
  ],
};

/** What the fake cineamo answers for a request of the server (a URL on api.cineamo.com): JSON text, or null for "not found". */
export function cineamoAnswer(url) {
  const path = url.pathname;
  if (path === "/showings") {
    const cinemaId = Number(url.searchParams.get("cinemaId"));
    const date = url.searchParams.get("date") ?? "";
    const showings = (SHOWINGS[cinemaId] ?? []).map(([clock, film, name, language, room], index) => ({
      id: cinemaId * 100 + index,
      state: "scheduled",
      name,
      startDatetime: berlinInstant(date, clock).toISOString(),
      language,
      contentId: FILMS[film].contentId,
      movieId: FILMS[film].movieId,
      originalLanguage: FILMS[film].original,
      ...(room === undefined ? {} : { cinemaRoomId: room }),
    }));
    return JSON.stringify({ _embedded: { showings }, _page_count: 1 });
  }
  if (path === "/cinema-rooms") {
    const rooms = Object.entries(ROOMS[Number(url.searchParams.get("cinemaId"))] ?? {}).map(([id, name]) => ({ id: Number(id), name }));
    return JSON.stringify({ _embedded: { cinema_rooms: rooms }, _page_count: 1 });
  }
  const movie = /^\/movies\/(\d+)$/.exec(path);
  if (movie) {
    const film = Object.values(FILMS).find((f) => f.movieId === Number(movie[1]));
    return film ? JSON.stringify(film.runtime === undefined ? { id: film.movieId } : { id: film.movieId, runtime: film.runtime }) : null;
  }
  return null;
}
