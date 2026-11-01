// Command line tool for the owner, run inside the container:
//   docker compose exec api node server/dist/cli.js admin-link "Vorname Nachname"
import { runCli } from "./cli-commands.js";
import { ConfigError, loadConfig } from "./config.js";
import { openDatabase } from "./db.js";

try {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  let code: number;
  try {
    code = runCli(process.argv.slice(2), {
      db,
      config,
      now: () => new Date(),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    db.close();
  }
  process.exitCode = code;
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
}
