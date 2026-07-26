"use strict"

// spectatePassword is meaningless once spectating is disabled entirely (server.js
// checks allowSpectate before ever looking at the password - see the "/:id/spectate"
// route and the websocket connection handler) - disabling the field here is purely
// visual, matching that server-side reality rather than driving it.
const allowSpectate = document.querySelector("#allowSpectate");
const spectatePassword = document.querySelector("#spectatePassword");
function updateSpectatePasswordState()
{
  spectatePassword.disabled = !allowSpectate.checked;
}
allowSpectate.addEventListener("change", updateSpectatePasswordState);
updateSpectatePasswordState();
