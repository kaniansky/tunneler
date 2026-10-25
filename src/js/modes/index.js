// Every game mode (docs/DESIGN-8P.md 27): each file registers its hooks with TunnelerEngine.registerMode.
// A new mode: its file and a line here (test/modes-check.js checks that nothing is left out).
import "./ctf.js";
import "./deathmatch.js";
import "./gold.js";
import "./hill.js";
import "./infection.js";
import "./shrink.js";
import "./siege.js";
import "./survival.js";
