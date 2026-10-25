// English texts of running reliably (docs/v6/RELIABILITY.md): the server restarting, a game gone with it, no
// network, a desync being repaired, a screen that failed to load or crashed.
import { Lang } from "../../js/lang.js";
Lang.extend("en", {
  "rel.restart": "The server is restarting...",
  "rel.restart2": "Your game goes on as soon as it is back.",
  "rel.gone": "The server was restarted and this game is gone.",
  "rel.gone2": "Create a new game or join one from the list.",
  "rel.offline": "No network connection - waiting for it...",
  "rel.rebuild": "The game went out of step - rebuilding it...",
  "rel.load": "Loading failed - check the connection.",
  "rel.load2": "Click, tap or press a key to try again.",
  "rel.crash": "Something went wrong - the error was reported.",
  "rel.crash2": "Click, tap or press a key for the main menu.",
});
