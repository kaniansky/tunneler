// The map gallery and the map picker (docs/v6/MAPS.md): the Maps screen's gallery, Publish, the skirmish's and the
// online lobby's map picker.
import { Lang } from "../../js/text/lang.js";

Lang.extend("en", {
  // the map picker (MapPick)
  "pk.title": "CHOOSE A MAP", "pk.loading": "Loading...", "pk.none.mine": "No maps to play yet (Maps on the main menu).",
  "pk.none.gal": "Nothing published yet.", "pk.err.none": "This server has no map gallery.",
  "pk.err.net": "The server doesn't answer - try again.",
  "pk.random.i": "A world made the way the original game makes it.", "pk.mine.i": "Choose it to play on it.",
  "pk.gal.by": "Published by {name} - played {n} times.",
  "pk.show": "Show: ", "pk.tab.mine": "your maps", "pk.tab.gallery": "the gallery", "pk.show.i": "Your own maps, or the ones published on this server.",
  "pk.order": "Order: ", "pk.sort.new": "newest", "pk.sort.plays": "most played", "pk.order.i": "The newest first, or the most played first.",
  "pk.back.i": "Back without changing the map.", "pk.h.by": "BY", "pk.h.plays": "PLAYED",
  // the gallery on the Maps screen
  "gal.open": "Map gallery", "gal.open.i1": "Maps players published on this server:", "gal.open.i2": "look at them, play them, keep a copy.",
  "gal.title": "MAP GALLERY", "gal.one.title": "PUBLISHED MAP",
  "gal.add": "Add to my maps", "gal.add.i": "Keeps a copy with your maps: edit it, play it, share it.", "gal.added": "It is in your maps: {name}",
  "gal.play.i": "The skirmish's settings with this map (a copy goes into your maps).",
  "gal.link": "Copy a link", "gal.link.i": "A link to this map: whoever opens it gets a copy.",
  "gal.back": "Back to the gallery", "gal.back.i": "Back to the list of published maps.",
  // publishing (a map's screen)
  "gal.publish": "Publish to the gallery", "gal.publish.i1": "Puts the map in this server's gallery: every player can see it,",
  "gal.publish.i2": "play it and keep a copy. You can remove it again.",
  "gal.publishing": "Publishing...", "gal.published": "Published: the map is in the gallery.",
  "gal.remove": "Remove from the gallery", "gal.remove.i": "Takes it out of the gallery (copies players kept stay theirs).",
  "gal.remove.sure": "Press it again to remove it from the gallery.", "gal.removing": "Removing...", "gal.removed": "Removed from the gallery.",
  "gal.err.none": "This server has no map gallery (an older version).", "gal.err.session": "Log in again to publish.",
  "gal.err.taken": "Someone else published this map already.", "gal.err.full": "The gallery takes no more maps from you.",
  "gal.err.busy": "Too many at once - try again in a minute.", "gal.err.author": "Only the one who published it can remove it.",
  "gal.err.other": "That didn't work - try again later.",
});
