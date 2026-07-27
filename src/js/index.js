"use strict"

// the form is a real POST to /create - server.js slugifies the name (or picks a random
// one if left blank), creates the session (if it doesn't already exist) and redirects to
// /<id>/. Nothing left to do here.

const play = document.location.origin + "/play";
document.querySelector("#play").textContent = t("play");
document.querySelector("#play").addEventListener("click", () => document.location.href = play);

for (const difficulty of ["easy", "medium", "hard"])
{
  const url = document.location.origin + "/ai/" + difficulty;
  document.querySelector("#ai" + difficulty[0].toUpperCase() + difficulty.slice(1))
    .addEventListener("click", () => document.location.href = url);
}

document.querySelector("#newNetworkGameBtn").addEventListener("click", () => document.location.href = "/new");

// Public games list: polls /games (server.js), which only reports sessions created with
// the "list publicly" checkbox checked (default: on). Score comes from tunneler.js's
// reportScore(), not from the server itself - see server.js's "/:id/score" route.
const gamesTable = document.querySelector("#gamesTable");
const gamesTableBody = document.querySelector("#gamesTableBody");
const noGamesMsg = document.querySelector("#noGamesMsg");

// cached so a language switch (langchange) can redraw with the last-fetched list
// instead of waiting for the next poll.
let lastGames = [];
function renderGames(games)
{
  lastGames = games;
  gamesTable.hidden = games.length == 0;
  noGamesMsg.hidden = games.length > 0;
  gamesTableBody.innerHTML = "";
  for (const g of games)
  {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = document.location.origin + "/" + g.id + "/";
    link.textContent = g.name;
    nameCell.appendChild(link);
    const playersCell = document.createElement("td");
    playersCell.textContent = `${g.players}/${g.maxPlayers}`;
    const scoreCell = document.createElement("td");
    scoreCell.classList.add('score');
    const teams = Object.keys(g.teamScores || {}).sort((a, b) => a - b);
    scoreCell.textContent = teams.length
      ? teams.map((team) => `${t("team")} ${team}: ${g.teamScores[team]}`).join(" : ")
      : t("round", {n: g.round});
    row.append(nameCell, playersCell, scoreCell);
    gamesTableBody.appendChild(row);
  }
}
document.addEventListener("langchange", () => renderGames(lastGames));

const GAMES_POLL_INTERVAL_MS = 3000;
async function pollGames()
{
  try
  {
    const resp = await fetch(document.location.origin + "/games");
    renderGames(await resp.json());
  }
  catch (e)
  {
    console.log("Games poll failed", e);
  }
}
pollGames();
setInterval(pollGames, GAMES_POLL_INTERVAL_MS);
