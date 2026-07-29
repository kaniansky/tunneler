"use strict";
/* global t */

// React port of create.html's (previously JS-less) session-creation form. Still a real
// <form action="/create" method="POST"> full-page submit - server.js's /create route is
// unchanged, this only changes how the markup is built. maxPlayers/winScore are steppers
// rather than a native <select>/number input (see server.js's createSession for the
// clamping - 2-8 seats, 1-20 win score) - their live value is mirrored into a hidden
// input since the actual submit is a plain form POST, not a fetch this component controls.

import { createRoot } from "react-dom/client";
import { useState } from "react";

// Handed off to the resulting session's lobby.jsx (same key, read once and consumed on
// mount there) so the creator - who just typed this password in - never has to re-enter
// it; everyone else who only has the link still hits lobby.jsx's password gate normally.
// A real fetch()-based submit could just carry the password in its own response, but
// this form's whole point is a plain full-page POST (see comment below), so the only
// channel from "the create page" to "the freshly-created lobby page" is storage.
const PENDING_PASSWORD_KEY = "tunneler_pending_password";

function Stepper({ name, value, min, max, onChange }) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

function MapSizePills() {
  return (
    <div className="pill-group">
      {[
        ["small", "mapSizeSmall"],
        ["medium", "mapSizeMedium"],
        ["large", "mapSizeLarge"],
      ].map(([value, label]) => (
        <label className="pill" key={value}>
          <input type="radio" name="mapSize" value={value} defaultChecked={value === "medium"} />
          <span>{t(label)}</span>
        </label>
      ))}
    </div>
  );
}

function App() {
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [winScore, setWinScore] = useState(3);

  return (
    <>
      <div className="banner">
        <a className="new-game-btn" href="/">
          {t("home")}
        </a>
        <div className="left-text">{t("newNetworkGame")}</div>
      </div>
      <form
        id="startForm"
        action="/create"
        method="POST"
        autoComplete="off"
        onSubmit={(e) => {
          const password = e.target.elements.password.value;
          if (password) sessionStorage.setItem(PENDING_PASSWORD_KEY, password);
          else sessionStorage.removeItem(PENDING_PASSWORD_KEY);
        }}
      >
        <div className="links form-section">
          <p className="section-title">{t("sessionName")}</p>
          <div className="form-row">
            <input
              id="sessionName"
              name="name"
              type="text"
              className="field"
              maxLength={100}
              placeholder={t("sessionNamePlaceholder")}
              autoFocus
              autoComplete="off"
            />
          </div>
        </div>

        <div className="links form-section">
          <p className="section-title">{t("visibilitySection")}</p>
          <div className="form-row">
            <label className="checkbox-row">
              <input type="checkbox" name="listed" defaultChecked /> <span>{t("listPublicly")}</span>
            </label>
          </div>
          <div className="form-row">
            <label className="checkbox-row">
              <input type="checkbox" name="allowSpectate" defaultChecked />{" "}
              <span>{t("allowSpectate")}</span>
            </label>
          </div>
          <div className="form-row">
            <input
              name="password"
              type="password"
              className="field"
              maxLength={100}
              placeholder={t("passwordPlaceholder")}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="links form-section">
          <p className="section-title">{t("matchRulesSection")}</p>
          <div className="form-row">
            <label className="checkbox-row">
              <input type="checkbox" name="friendlyFire" /> <span>{t("friendlyFire")}</span>
            </label>
          </div>
          <div className="form-row">
            <p className="field-label">{t("mapSize")}</p>
            <MapSizePills />
          </div>
          <div className="form-row">
            <p className="field-label">{t("maxPlayers")}</p>
            <Stepper name="maxPlayers" value={maxPlayers} min={2} max={8} onChange={setMaxPlayers} />
          </div>
          <div className="form-row">
            <p className="field-label">{t("winScore")}</p>
            <Stepper name="winScore" value={winScore} min={1} max={20} onChange={setWinScore} />
          </div>
        </div>

        <p className="hint more-hint">{t("moreSettingsHint")}</p>

        <div className="submit-row">
          <button type="submit">{t("create")}</button>
        </div>
      </form>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
