// The game modes the engine itself runs (docs/DESIGN-8P.md 27): each file registers its hooks with
// TunnelerEngine.registerMode. Since 1.5 the game's modes are official mods (src/mods/, docs/MODS.md 6c) - only the
// training ground's own mode is left here (test/modes-check.js checks that nothing is left out).
import "./training.js";
