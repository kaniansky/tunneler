// Going to another screen (docs/DESIGN-8P.md 31): the app (app.js) shows it without loading a page - the
// address changes (history) and the route of the new path is mounted; another site's address is loaded as
// a page. Before app.js sets the handler (a test running one screen): an ordinary page load.
//   Nav.go("/games")            Nav.go(Links.game(id), true)   (true: replace the current history entry)
export const Nav = {
  handler: null,
  go(url, replace) {
    if (Nav.handler) return Nav.handler(String(url), !!replace);
    if (replace) globalThis.location.replace(url);
    else globalThis.location.href = url;
  },
};
