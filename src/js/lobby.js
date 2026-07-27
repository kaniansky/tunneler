"use strict"

// banner text is server-templated (see server.js's sendWithSessionName) - only the URL
// slug is needed here for building the seat/spectate URLs and status polling.
const sid = document.location.pathname.split("/").filter(Boolean)[0] || "";
const origin = document.location.origin;
const MAX_SEATS = 8;
const MAX_TEAMS = 8;

// Not pulling in netcode.js just for its escapeHtml() (that file also drags in the whole
// engine-facing Path/Game/Net stack lobby.js has no use for) - reimplemented locally,
// same as before this rewrite.
function escapeHtml(s)
{
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// This client's own claimed seat persists across a reload (sessionStorage, scoped to
// this browser tab/session and this specific game id) - matches the existing app-wide
// trust model (a link/stored id is what "owns" a seat, no login system anywhere).
const SEAT_KEY = `tunneler_seat_${sid}`;
function loadMySeat()
{
  const v = sessionStorage.getItem(SEAT_KEY);
  return v === null ? null : Number(v);
}
function saveMySeat(n) { sessionStorage.setItem(SEAT_KEY, String(n)); }
function clearMySeat() { sessionStorage.removeItem(SEAT_KEY); }

let mySeat = loadMySeat();
// Local, optimistic state for the seat this client owns - only ever written by this
// client's own actions (join/update/ready), never overwritten by a status poll, so
// typing in the name field doesn't fight with the 2s poll cycle re-rendering the row
// out from under it. Other seats' rows are pure reflections of the server's status.
let myName = "", myColor = 0, myTeam = 1, myReady = false;

function post(path, body)
{
  return fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

function takenColors(status, excludeSeat)
{
  const taken = new Set();
  status.seats.forEach((s, i) => { if (s && i !== excludeSeat) taken.add(s.color); });
  return taken;
}

function renderSwatches(container, taken, selected, onSelect)
{
  container.innerHTML = "";
  for (let c = 0; c < PLAYER_COLORS.length; c++)
  {
    const [r, g, b] = PLAYER_COLORS[c];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch" + (c === selected ? " selected" : "");
    btn.style.background = `rgb(${r},${g},${b})`;
    btn.disabled = taken.has(c) && c !== selected;
    btn.addEventListener("click", () => onSelect(c));
    container.appendChild(btn);
  }
}

const joinForm = document.querySelector("#joinForm");
const joinName = document.querySelector("#joinName");
const joinColors = document.querySelector("#joinColors");
const joinTeam = document.querySelector("#joinTeam");
const joinBtn = document.querySelector("#joinBtn");
const seatGrid = document.querySelector("#seatGrid");
const startHint = document.querySelector("#startHint");
const spBtn = document.querySelector("#sp");

for (let team = 1; team <= MAX_TEAMS; team++)
{
  const opt = document.createElement("option");
  opt.value = team;
  opt.textContent = `${t("team")} ${team}`;
  joinTeam.appendChild(opt);
}

let joinSelectedColor = 0;

function renderJoinSwatches(status)
{
  const taken = takenColors(status, -1);
  if (taken.has(joinSelectedColor))
    joinSelectedColor = [...Array(MAX_SEATS).keys()].find((c) => !taken.has(c)) ?? 0;
  renderSwatches(joinColors, taken, joinSelectedColor, (c) => {
    joinSelectedColor = c;
    renderJoinSwatches(status);
  });
}

async function doJoin()
{
  const name = joinName.value.trim() || t("player");
  const res = await post(`/${sid}/join`, { name, color: joinSelectedColor, team: Number(joinTeam.value) });
  if (!res.ok) { console.log("Join failed", await res.text().catch(()=>"")); return; }
  const { seat } = await res.json();
  mySeat = seat;
  myName = name; myColor = joinSelectedColor; myTeam = Number(joinTeam.value); myReady = false;
  saveMySeat(seat);
  await pollStatus();
}
joinBtn.addEventListener("click", doJoin);

// name edits are debounced (no need to hit the server on every keystroke); color/team/
// ready changes POST immediately, they're discrete choices not free text.
let nameDebounce = null;
function scheduleNameUpdate(e)
{
  if (mySeat == null) return;
  myName = e.target.value.trim() || myName;
  clearTimeout(nameDebounce);
  nameDebounce = setTimeout(() => post(`/${sid}/seat/${mySeat}/update`, { name: myName, color: myColor, team: myTeam }), 400);
}

function updateColor(c)
{
  myColor = c;
  post(`/${sid}/seat/${mySeat}/update`, { name: myName, color: myColor, team: myTeam });
  renderSeatGrid(lastStatus);
}
function updateTeam(team)
{
  myTeam = team;
  post(`/${sid}/seat/${mySeat}/update`, { name: myName, color: myColor, team: myTeam });
}
function toggleReady(ready)
{
  myReady = ready;
  post(`/${sid}/seat/${mySeat}/ready`, { ready });
}
function doLeave()
{
  post(`/${sid}/seat/${mySeat}/leave`, {});
  mySeat = null;
  clearMySeat();
  pollStatus();
}

function renderSeatGrid(status)
{
  if (!status) return;
  // Rebuilds every row from scratch, including the own seat's live name <input> - if
  // that input specifically currently has focus, skip this cycle entirely rather than
  // yank the cursor position out from under an in-progress edit; the next poll (within
  // POLL_INTERVAL_MS) picks up whatever changed in the meantime. Deliberately narrower
  // than "anything in seatGrid has focus" - a color swatch/team <select>/ready checkbox
  // click also moves focus into seatGrid, but those DO want their immediate post-click
  // renderSeatGrid() call (updateColor() etc.) to actually take effect, unlike the name
  // field's free-text typing.
  if (document.activeElement && document.activeElement.id === "ownNameInput")
    return;
  seatGrid.innerHTML = "";
  for (let i = 0; i < MAX_SEATS; i++)
  {
    const row = document.createElement("div");
    const seat = i === mySeat ? { name: myName, color: myColor, team: myTeam, ready: myReady } : status.seats[i];

    if (!seat)
    {
      row.className = "seat-row empty";
      row.textContent = t("openSeat");
      seatGrid.appendChild(row);
      continue;
    }

    row.className = "seat-row" + (i === mySeat ? " own" : "");
    const [r, g, b] = PLAYER_COLORS[seat.color] || [0x88, 0x88, 0x88];

    const swatch = document.createElement("div");
    swatch.className = "seat-swatch";
    swatch.style.background = `rgb(${r},${g},${b})`;
    row.appendChild(swatch);

    if (i === mySeat)
    {
      const nameInput = document.createElement("input");
      nameInput.id = "ownNameInput";
      nameInput.className = "seat-name";
      nameInput.maxLength = 30;
      nameInput.value = myName;
      nameInput.addEventListener("input", scheduleNameUpdate);
      row.appendChild(nameInput);

      const swatches = document.createElement("div");
      swatches.className = "color-swatches";
      renderSwatches(swatches, takenColors(status, mySeat), myColor, updateColor);
      row.appendChild(swatches);

      const teamSel = document.createElement("select");
      for (let team = 1; team <= MAX_TEAMS; team++)
      {
        const opt = document.createElement("option");
        opt.value = team;
        opt.textContent = `${t("team")} ${team}`;
        opt.selected = team === myTeam;
        teamSel.appendChild(opt);
      }
      teamSel.addEventListener("change", () => updateTeam(Number(teamSel.value)));
      row.appendChild(teamSel);

      const readyLabel = document.createElement("label");
      readyLabel.className = "checkbox-row";
      const readyCheck = document.createElement("input");
      readyCheck.type = "checkbox";
      readyCheck.checked = myReady;
      readyCheck.addEventListener("change", () => toggleReady(readyCheck.checked));
      readyLabel.appendChild(readyCheck);
      readyLabel.appendChild(document.createTextNode(t("ready")));
      row.appendChild(readyLabel);

      const leaveBtn = document.createElement("button");
      leaveBtn.type = "button";
      leaveBtn.className = "seat-leave-btn";
      leaveBtn.textContent = t("leave");
      leaveBtn.addEventListener("click", doLeave);
      row.appendChild(leaveBtn);
    }
    else
    {
      const nameEl = document.createElement("div");
      nameEl.className = "seat-name";
      nameEl.textContent = escapeHtml(seat.name);
      row.appendChild(nameEl);

      const teamEl = document.createElement("div");
      teamEl.className = "seat-team";
      teamEl.textContent = `${t("team")} ${seat.team}`;
      row.appendChild(teamEl);

      const readyEl = document.createElement("div");
      readyEl.className = "seat-ready " + (seat.ready ? "is-ready" : "not-ready");
      readyEl.textContent = seat.ready ? t("readyLabel") : t("notReadyLabel");
      row.appendChild(readyEl);
    }

    seatGrid.appendChild(row);
  }
}

function renderScore(status)
{
  const scoreEl = document.querySelector("#score");
  const teams = Object.keys(status.teamScores || {}).sort((a, b) => a - b);
  const parts = teams.map((team) =>
    `<span>${escapeHtml(t("team"))} ${escapeHtml(team)}: ${status.teamScores[team]}</span>`);
  scoreEl.innerHTML = `${t("round", {n: status.round})}` + (parts.length ? " &mdash; " + parts.join("&nbsp;&nbsp;|&nbsp;&nbsp;") : "");
}

let lastStatus = null;
const POLL_INTERVAL_MS = 2000;
async function pollStatus()
{
  try
  {
    const resp = await fetch(`${origin}/${sid}/status`);
    const status = await resp.json();
    lastStatus = status;

    if (status.started)
    {
      document.location.href = mySeat != null
        ? `${origin}/${sid}/seat/${mySeat}`
        : `${origin}/${sid}/spectate`;
      return;
    }

    // someone/something else cleared our seat (e.g. left from another tab) - fall back
    // to the join form rather than keep pretending we still hold it.
    if (mySeat != null && !status.seats[mySeat])
    {
      mySeat = null;
      clearMySeat();
    }

    joinForm.hidden = mySeat != null;
    if (mySeat == null)
      renderJoinSwatches(status);

    spBtn.disabled = !status.allowSpectate;
    startHint.hidden = status.seats.filter(Boolean).length >= 2 &&
      status.seats.filter(Boolean).every((s) => s.ready) &&
      new Set(status.seats.filter(Boolean).map((s) => s.team)).size >= 2;

    renderSeatGrid(status);
    renderScore(status);
  }
  catch (e)
  {
    console.log("Status poll failed", e);
  }
}
pollStatus();
setInterval(pollStatus, POLL_INTERVAL_MS);

spBtn.addEventListener("click", () => document.location.href = `${origin}/${sid}/spectate`);

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
