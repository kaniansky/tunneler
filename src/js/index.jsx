"use strict";
/* global t, setLang, currentLang, SUPPORTED_LANGS, LANG_LABELS */

// React port of the old index.js - see CLAUDE.md for the page's role. i18n.js (loaded
// as a plain <script> before this bundle) still owns translations/currentLang/setLang -
// this file just reads those globals directly, same as the old vanilla page did.

import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

const GAMES_POLL_INTERVAL_MS = 3000;
const MAP_SIZE_LABELS = { small: "mapSizeSmall", medium: "mapSizeMedium", large: "mapSizeLarge" };

// Forces a re-render on language switch - only index.html ever exposes a language
// switcher (see i18n.js's injectLangSwitcher()-turned-<LangSelect/> below), so this is
// the only page that needs it.
function useLangChange() {
  const [, bump] = useState(0);
  useEffect(() => {
    const handler = () => bump((n) => n + 1);
    document.addEventListener("langchange", handler);
    return () => document.removeEventListener("langchange", handler);
  }, []);
}

function LangSelect() {
  return (
    <select
      className="lang-select"
      defaultValue={currentLang}
      onChange={(e) => setLang(e.target.value)}
    >
      {SUPPORTED_LANGS.map((lang) => (
        <option key={lang} value={lang}>
          {LANG_LABELS[lang] || lang}
        </option>
      ))}
    </select>
  );
}

function GamesTable() {
  const [games, setGames] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function pollGames() {
      try {
        const resp = await fetch(document.location.origin + "/games");
        const data = await resp.json();
        if (!cancelled) setGames(data);
      } catch (e) {
        console.log("Games poll failed", e);
      }
    }
    pollGames();
    const id = setInterval(pollGames, GAMES_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <table id="gamesTable" hidden={games.length == 0}>
        <thead>
          <tr>
            <th>{t("gameName")}</th>
            <th>{t("mapSize")}</th>
            <th>{t("gamePlayers")}</th>
            <th>{t("gameScore")}</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const teams = Object.keys(g.teamScores || {}).sort((a, b) => a - b);
            const scoreText = teams.length
              ? teams.map((team) => `${t("team")} ${team}: ${g.teamScores[team]}`).join(" : ")
              : t("round", { n: g.round });
            return (
              <tr key={g.id}>
                <td>
                  <a href={document.location.origin + "/" + g.id + "/"}>
                    {g.hasPassword && <span title={t("passwordPlaceholder")}>🔒 </span>}
                    {g.name}
                  </a>
                </td>
                <td>{t(MAP_SIZE_LABELS[g.mapSize] || "mapSizeMedium")}</td>
                <td>
                  {g.players}/{g.maxPlayers}
                </td>
                <td className="score">{scoreText}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p id="noGamesMsg" hidden={games.length > 0}>
        {t("noGamesListed")}
      </p>
    </>
  );
}

function App() {
  useLangChange();
  const origin = document.location.origin;

  return (
    <>
      <div className="banner">
        <div className="left-text">{t("appTitle")}</div>
        <LangSelect />
      </div>
      <div className="links local-splitscreen-row">
        <p>
          <span>{t("localSplitScreen")}</span>{" "}
          <button
            className="btn btn-blue"
            type="button"
            onClick={() => (document.location.href = origin + "/play")}
          >
            {t("play")}
          </button>
        </p>
      </div>
      <div className="links">
        <p>
          <span>{t("singleplayerVsAi")}</span>{" "}
          {["easy", "medium", "hard"].map((difficulty) => (
            <button
              key={difficulty}
              className={"btn btn-" + difficulty}
              type="button"
              onClick={() => (document.location.href = origin + "/ai/" + difficulty)}
            >
              {t(difficulty)}
            </button>
          ))}
        </p>
      </div>
      <div className="links">
        <div className="form-row">
          <p>{t("networkGamesList")}</p>
          <button
            className="btn btn-blue"
            type="button"
            onClick={() => (document.location.href = "/new")}
          >
            {t("newNetworkGame")}
          </button>
        </div>
        <GamesTable />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
