"use strict"
// banner text is server-templated (see server.js's sendWithSessionName) - only the URL
// slug is needed here for building the player/spectator links
const sid = document.location.pathname.split("/").filter(Boolean)[0] || "";
const origin = document.location.origin;
const blue = origin + "/" + sid + "/blue";
const green = origin + "/" + sid + "/green";
const sp = origin + "/" + sid + "/spectate";

// spectate's password (if the session has one) is prompted for on the spectator page
// itself, not here - see spectator.js - so all three roles just navigate straight to
// their URL.
document.querySelector("#blue").addEventListener("click", () => document.location.href = blue);
document.querySelector("#green").addEventListener("click", () => document.location.href = green);
document.querySelector("#sp").addEventListener("click", () => document.location.href = sp);

// blue/green button labels interpolate the server-templated player name into a
// translated "Join {name}" string - applyI18n()'s blanket data-i18n textContent
// overwrite can't do this itself, so it's redone here on every langchange too.
const blueBtn = document.querySelector("#blue");
const greenBtn = document.querySelector("#green");
// taken: whether someone currently holds that role - polled from /:id/status (see
// pollOccupancy() below), false until the first poll resolves.
let blueTaken = false, greenTaken = false;
// server only ever falls back to the literal English "Blue"/"Green" (no i18n on that
// side - see server.js) when the session creator didn't set a custom name, so those two
// values are translated client-side; anything else is a custom name and stays as typed.
function displayName(name)
{
  if (name == "Blue") return t("blueDefault");
  if (name == "Green") return t("greenDefault");
  return name;
}
function updateJoinButtons()
{
  const blueName = displayName(blueBtn.dataset.name);
  const greenName = displayName(greenBtn.dataset.name);
  blueBtn.textContent = blueTaken ? t("taken", {name: blueName}) : t("join", {name: blueName});
  greenBtn.textContent = greenTaken ? t("taken", {name: greenName}) : t("join", {name: greenName});
}
updateJoinButtons();
document.addEventListener("langchange", updateJoinButtons);

// live round/score, mirrored from tunneler.js's/spectator.js's own formatScore() -
// server never runs game logic, so this is purely whatever blue's client last reported
// via GET /:id/score (see server.js) - defaults to "Round 1 - Blue: 0 | Green: 0" before
// anyone's played a frame, same placeholder tunneler.js shows while waiting. Not pulling
// in netcode.js just for its escapeHtml() (that file also drags in the whole WASM-facing
// Path/Game/Net stack lobby.js has no use for) - reimplemented locally instead.
function escapeHtml(s)
{
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const scoreEl = document.querySelector("#score");
let lastScore = {round: 1, blueScore: 0, greenScore: 0};
function renderScore()
{
  const {round, blueScore, greenScore} = lastScore;
  scoreEl.innerHTML =
    `${t("round", {n: round})} &mdash; ` +
    `<span style="color:#9fcaff">${escapeHtml(displayName(blueBtn.dataset.name))}: ${blueScore}</span>` +
    `&nbsp;&nbsp;|&nbsp;&nbsp;` +
    `<span style="color:#7CFC00">${escapeHtml(displayName(greenBtn.dataset.name))}: ${greenScore}</span>`;
}
renderScore();
document.addEventListener("langchange", renderScore);

// the button disabled attribute is what actually blocks the click (and greys it out via
// lobby.css's :disabled rule) - the server enforces the real single-occupancy rule (see
// server.js's "/:id/blue"/"/:id/green" routes and the websocket connection handler), this
// is just so the lobby doesn't invite a click that's already doomed to bounce back here.
const POLL_INTERVAL_MS = 2000;
async function pollOccupancy()
{
  try
  {
    const resp = await fetch(origin + "/" + sid + "/status");
    const status = await resp.json();
    blueTaken = status.blue;
    greenTaken = status.green;
    blueBtn.disabled = blueTaken;
    greenBtn.disabled = greenTaken;
    // allowSpectate is fixed at session creation (unlike blue/green occupancy), so this
    // never toggles back on - still simplest to just apply it on every poll tick here
    // rather than a separate one-shot fetch.
    document.querySelector("#sp").disabled = !status.allowSpectate;
    updateJoinButtons();
    lastScore = {round: status.round, blueScore: status.blueScore, greenScore: status.greenScore};
    renderScore();
  }
  catch (e)
  {
    console.log("Status poll failed", e);
  }
}
pollOccupancy();
setInterval(pollOccupancy, POLL_INTERVAL_MS);

// navigator.clipboard needs a secure context (https, or localhost) - fall back to the
// old select-and-execCommand trick over plain http so this still works there too.
async function copyText(text)
{
  if (navigator.clipboard)
    return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

const copyLinkBtn = document.querySelector("#copyLink");
copyLinkBtn.addEventListener("click", async () => {
  try
  {
    await copyText(document.location.href);
    const original = copyLinkBtn.textContent;
    copyLinkBtn.textContent = t("copied");
    setTimeout(() => { copyLinkBtn.textContent = original; }, 1500);
  }
  catch (e)
  {
    console.log("Copy failed", e);
  }
});
