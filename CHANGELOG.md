# Changelog

All notable changes to TUNNELER ONLINE. Versions follow [semantic versioning](https://semver.org/);
every push to `main` is released (see CONTRIBUTING.md).

## 1.2.0

### Game
- **After death** setting (vs computer and online rooms): what you see once your tank is destroyed,
  until the round ends - a black **DESTROYED** screen, your wreck (default), or **watch others**: the
  tank that destroyed you (following the chain if it is destroyed too, else another tank still alive).
  Sounds then fade from the tank you watch.
- **Round time limit** setting (off / 2 / 3 / 5 / 10 minutes; vs computer, split screen, online
  rooms): when the time is up, the side that hit enemy tanks the most wins the round (the other tanks
  blow up); a tie - nobody wins. The last 30 seconds count down next to the instrument panel.
- Vs computer: you can take any color (unset your slot, then pick "you" in another one).
- A teammate's base repairs your shield too, at half the speed of your own.
- Player colors: magenta replaced by **yellow** (with a gray gun).
- After a match the menu offers **Rematch** (same settings) instead of "Start game".
- Fire keys: BLUE fires with Left Shift / Space, GREEN with Enter / Right Shift - no Ctrl any more
  (Ctrl+W closed the browser tab).
- Computer tanks no longer drive into the map edge for a long time.
- Small map end screen: the base markers are drawn at the right size.

### Sound
- **Settings** screen on the homepage: language and **sound style** - muted, original (the PC
  speaker), realistic or cartoony (new synthesized effects). Changing it plays a sample; the choice
  is remembered. The M key (mute) is gone.
- **Show ping** (Settings): your connection's round-trip time (ms) as a small number on the game's top
  border, at the left, in online games.

### Menus and lobby
- Your tank is marked on the round title and the statistics; the game's settings are listed on the
  round title (at the bottom), on the statistics page and in the lobby.
- Lobby room page: players on the left, all settings in a Settings box on the right. Pre-game lobby:
  a SETTINGS column next to the players, no host column, a chat input as wide as its row.
- Settings read as "key: value" (map size: small, friendly fire: on, view limit: team, ...);
  "visible" is now called **view limit**.
- Online create form: friendly fire can always be set (the teams may still change in the lobby).
- Two-column layout for "Create an online game" and "Vs computer"; clicking a slot's who / team
  column cycles it (right click goes back); number keys 1-8 (also on the numeric keypad) set a
  slot's team.
- Instructions only on the main menu.
- Esc goes back everywhere: menus, the pre-game lobby (unready first), the connection screen, the
  game menu after a match. Online, Esc twice leaves the game for the room page (the first one asks,
  across the game: "Press <ESC> again to leave the game").
- After death "black screen" keeps the view's frame and instrument panel; only the view goes black.
- The status line under the game only appears when it has something to say (a spectator's view
  keys, a lost connection).

### Everything from the unreleased 1.1.0
- Names, room names and chat in any script (Unicode, wide characters included) on every screen.
- Player names instead of color names everywhere; name (and team) labels on every view when more
  than one is shown.
- Rooms nobody plays in for 10 minutes are closed.
- docker-compose.yml.

### Server
- Readable start-up errors for a port that needs root, is in use or is invalid.
