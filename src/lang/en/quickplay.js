// Quick play (docs/v6/QUICKPLAY.md): its texts, and its section on the Information page (before "The desktop app").
import { Lang } from "../../js/lang.js";
import { STRINGS_EN } from "./engine.js";
Lang.extend("en", {
  "home.quick": "Quick play", "home.quick.i1": "Straight into an online game: computer tanks fill it,",
  "home.quick.i2": "you take one over - even in the middle of a match.",
  "qp.title": "QUICK PLAY", "qp.finding": "Looking for a game...", "qp.err": "Could not find a game: {msg}",
  "qp.room": "Quick play", "qp.mode": "quick play",
  "qp.next": "Next match in {s} s", "qp.wait": "Waiting for a player",
  "qp.next.i1": "Quick play: the match starts by itself, nobody gets ready.",
  "qp.next.i2": "Computer tanks drive the seats nobody sits on.",
  "qp.go.i": "Starts the match now (else it starts by itself in {s} s).",
  "qp.sit.i1": "<ENTER> or a click: take this tank from the computer.",
  "qp.sit.i2": "Quick play: a computer drives every seat nobody sits on.",
  "qp.mine.i": "Your tank. A click on your name: stand up and watch.",
  "qp.took": "You drive the {name} tank now", "qp.again": "Try again",
});
const S = STRINGS_EN.info.sections;
S.splice(S.length - 2, 0, ["Quick play:  ", "Quick play in the list of games (Online game) puts you straight into an online game: computer tanks fill its eight seats, the matches start by themselves, and you take a computer tank over - even in the middle of a match.  When you leave, the computer drives your tank again - come back within 15 seconds and it is yours again."]);
