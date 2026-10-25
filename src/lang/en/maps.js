// Custom maps (docs/v6/MAPS.md): the maps screens, the editor, the Map rows of the skirmish and the online lobby.
import { Lang } from "../../js/lang.js";

Lang.extend("en", {
  "home.maps": "Maps", "home.maps.i": "Make your own worlds, share them as links, play them.",
  // the list
  "map.title": "MAPS", "map.h.name": "NAME", "map.h.size": "SIZE", "map.h.bases": "BASES",
  "map.info": "A {size} map with {n} bases.", "map.row.i": "<ENTER> opens it: edit, play, share a link, delete.",
  "map.row.i.touch": "Tap it to open it: edit, play, share, delete.",
  "map.none": "No maps yet.",
  "map.new": "Make a new map", "map.new.i": "Paint your own world - rock, dirt and tunnels - and place up to 8 bases.",
  "map.link": "Open a map link", "map.link.i": "A map link someone sent you: the map goes into your maps.",
  "back.maps": "Back to the maps", "back.maps.i": "Back to the list of your maps.",
  // a new map
  "map.new.title": "NEW MAP", "map.name": "Name: ", "map.ph.name": "My map", "map.name.i": "The map's name, shown wherever it is chosen.",
  "map.size.i": "Small 512 x 256, medium 1024 x 512 (the original), large 2048 x 1024 pixels.",
  "map.from": "Start from: ", "map.from.dirt": "dirt everywhere", "map.from.random": "a random world",
  "map.from.i": "Dirt everywhere, or a world made the way the game makes its own.",
  "map.create": "Create the map", "map.create.i": "Then paint it. Your maps are kept in this browser.",
  // a map's screen
  "map.one.title": "MAP", "map.edit": "Edit", "map.edit.i": "Paint the map and place its bases.",
  "map.play": "Play in a skirmish", "map.play.i": "The skirmish lobby with this map chosen.",
  "map.need": "Place at least 2 bases to play it.",
  "map.share": "Share a link", "map.share.i1": "Puts the map on the game's server and copies a link to it:",
  "map.share.i2": "whoever opens the link gets a copy in their maps.",
  "map.sharing": "Sharing...", "map.shared": "Link copied: {link}", "map.shared.nocopy": "Link: {link}", "map.share.err": "Could not share it: {msg}",
  "map.delete": "Delete", "map.delete.i": "Removes the map from this browser.", "map.delete.sure": "Press again to delete it for good.",
  // a link
  "map.link.title": "OPEN A MAP LINK", "map.link.ph": "paste a map link", "map.link.err": "That is not a map link.",
  "map.link.i2": "<ENTER> fetches it and keeps it with your maps.", "map.link.go": "Open",
  "map.fetching": "Fetching the map...", "map.gone": "This map link doesn't work: {msg}", "map.gone.404": "the server doesn't have it",
  // the editor
  "map.t.tunnel": "Tunnel", "map.t.dirt": "Dirt", "map.t.rock": "Rock", "map.t.base": "Base",
  "map.m.tunnel": "tunnel", "map.m.dirt": "dirt", "map.m.rock": "rock",
  "map.brush": "Brush", "map.zoom": "Zoom", "map.undo": "Undo", "map.menu": "Menu",
  "map.pos": "X {x}  Y {y}", "map.bases": "Bases: {n} of 8",
  "map.keys": "SPACE: paint  ESC: menu", "map.keys.touch": "1 finger paints, 2 move",
  "map.err.max": "8 bases at most.", "map.err.edge": "Too close to the edge for a base.",
  "map.err.near": "Too close to another base.",
  // the editor's menu
  "map.menu.title": "MAP EDITOR", "map.back": "Back to the map",
  "map.ok": "{n} bases - ready to play.", "map.walled": "Walled in by rock: base {list} (the game digs a way out).",
  "map.tool": "Tool: ", "map.tool.i": "What the brush does. Keys 1-4; Tab: the next tool.", "map.tool.i.touch": "What a finger does on the map.",
  "map.brushsize": "Brush size: ", "map.brush.i": "How wide the brush paints. Keys [ and ].", "map.brush.i.touch": "How wide a finger paints.",
  "map.fill": "Fill everything with: ", "map.fill.i": "Left / Right: what with; Enter twice: the whole map.",
  "map.fill.sure": "Press again: the whole map becomes {what}.",
  "map.undo.i": "Takes back the last change (U, Ctrl+Z).",
  "map.save": "Save and back", "map.save.i": "Keeps the map and goes back to its screen.",
  // playing a map: the skirmish, the online lobby
  "lc.map": "Map: ", "lc.map.random": "random", "lc.map.i1": "A random world, or one of your own maps", "lc.map.i2": "(Maps on the main menu: make them, open links).",
  "lc.size.map": "The map decides the size.", "lc.err.bases": "This map has {n} bases: fewer tanks, or another map.",
  "os.map": "Map: ", "os.map.random": "random", "os.map.i1": "A random world, or one of your maps (Maps on the main menu):",
  "os.map.i2": "it goes to the server, every player gets the same.", "os.map.sending": "Sending the map...", "os.map.err": "Could not send the map: {msg}",
  "pg.cant.map": "The map has fewer bases than there are tanks.",
  // a way between the bases (TunnelerEngine.mapReach), map files
  "map.cut": "No way for a tank to base {list} from the others.",
  "map.cut.dig": "Rock and base walls stop tanks: dig a way (dirt or tunnel).",
  "map.cut.play": "A tank can't reach every base: dig a way in the editor.",
  "lc.err.path": "A tank can't reach every base of this map: dig a way (Maps).",
  "os.map.cut": "A tank can't reach every base of this map: choose another.",
  "pg.cant.path": "A tank can't reach every base of the map.",
  "map.file": "Open a map file", "map.file.i": "A .tmap file saved here or sent by someone else.", "map.file.err": "That file is not a map.",
  "map.tofile": "Save as a file", "map.tofile.i": "Downloads it as a .tmap file - to keep it or send it.",
  "map.saved": "Saved: {where}", "map.save.err": "The file could not be saved.",
});
