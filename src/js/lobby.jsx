"use strict";
/* global t, PLAYER_COLORS */

// React port of lobby.js - see CLAUDE.md/server.js for the seat/team model. The old
// vanilla version had to special-case "don't rebuild the own-name <input> while it has
// focus" because it rebuilt the whole seat grid's innerHTML from scratch every poll
// tick. React reconciles by element identity instead of nuking the DOM, so a controlled
// input bound to state nothing else writes to is safe across re-renders with no such
// guard needed.

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";

const sid = document.location.pathname.split("/").filter(Boolean)[0] || "";
const origin = document.location.origin;
// fallback seat-grid length before the first /status response arrives - the real length
// (which can now be less than this, see server.js's createSession maxPlayers) takes over
// as soon as status is loaded.
const MAX_SEATS = 8;
const MAX_TEAMS = 8;
const POLL_INTERVAL_MS = 2000;
const SEAT_KEY = `tunneler_seat_${sid}`;
// unlike SEAT_KEY (per-session, sessionStorage), the display name is a cross-session
// convenience - localStorage so it's remembered on the next visit/tab entirely.
const NAME_KEY = "tunneler_player_name";
// this session's own verified password, once entered (or handed off from create.jsx -
// see PENDING_PASSWORD_KEY) - sessionStorage so a reload doesn't re-prompt, but a
// different session's id gets its own key and its own gate.
const PASSWORD_KEY = `tunneler_password_${sid}`;
// one-shot handoff from create.jsx: the password the creator just typed in, for whichever
// session their submit produces - read once on mount below, then cleared regardless of
// outcome (it's meaningless for any session but the one just created).
const PENDING_PASSWORD_KEY = "tunneler_pending_password";

function loadMySeat() {
  const v = sessionStorage.getItem(SEAT_KEY);
  return v === null ? null : Number(v);
}
function saveMySeat(n) {
  sessionStorage.setItem(SEAT_KEY, String(n));
}
function clearMySeat() {
  sessionStorage.removeItem(SEAT_KEY);
}

function post(path, body) {
  return fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

function takenColors(status, excludeSeat) {
  const taken = new Set();
  if (status) status.seats.forEach((s, i) => { if (s && i !== excludeSeat) taken.add(s.color); });
  return taken;
}

// navigator.clipboard needs a secure context (https, or localhost) - fall back to the
// old select-and-execCommand trick over plain http so this still works there too.
async function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function ColorSwatches({ taken, selected, onSelect, disabled }) {
  return (
    <div className="color-swatches">
      {PLAYER_COLORS.map(([r, g, b], c) => (
        <button
          key={c}
          type="button"
          className={"color-swatch" + (c === selected ? " selected" : "")}
          style={{ background: `rgb(${r},${g},${b})` }}
          disabled={disabled || (taken.has(c) && c !== selected)}
          onClick={() => onSelect(c)}
        />
      ))}
    </div>
  );
}

// A row of numbered buttons instead of a native <select> - same interaction pattern as
// ColorSwatches above, just numbers instead of colors.
function TeamPills({ selected, onSelect, disabled }) {
  return (
    <div className="team-pills">
      {Array.from({ length: MAX_TEAMS }, (_, i) => i + 1).map((team) => (
        <button
          key={team}
          type="button"
          className={"team-pill" + (team === selected ? " selected" : "")}
          disabled={disabled}
          title={`${t("team")} ${team}`}
          onClick={() => onSelect(team)}
        >
          {team}
        </button>
      ))}
    </div>
  );
}

// Ticks its own display independent of the 2s status poll, so the number counts down
// smoothly instead of jumping every POLL_INTERVAL_MS. startsAt is the server's scheduled
// start timestamp (server.js's session.started, delayed by MATCH_START_COUNTDOWN_MS) -
// purely cosmetic, the actual redirect is driven by the poll effect below.
function Countdown({ startsAt }) {
  const [remaining, setRemaining] = useState(() => Math.ceil((startsAt - Date.now()) / 1000));
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((startsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startsAt]);
  return (
    <div className="countdown-banner">
      {t("startingIn", { n: Math.max(0, remaining) })}
    </div>
  );
}

const MAP_SIZE_LABELS = { small: "mapSizeSmall", medium: "mapSizeMedium", large: "mapSizeLarge" };

// Read-only summary of this session's creation-time rules (server.js's createSession) -
// shown regardless of the password gate below, since none of it is seat/player data,
// just the ruleset a locked-out visitor might want to see before asking for the password.
function GameOptions({ status }) {
  if (!status) return null;
  return (
    <div className="links game-options">
      <span className="game-option" title={t("mapSize")}>
        🗺️ {t("mapSize")}: {t(MAP_SIZE_LABELS[status.mapSize] || "mapSizeMedium")}
      </span>
      <span className="game-option" title={t("winScore")}>
        🎯 {t("winScore")}: {status.winScore}
      </span>
      <span className="game-option" title={t("friendlyFire")}>
        ⚔️ {t("friendlyFireLabel")}: {status.friendlyFire ? "✓" : "✗"}
      </span>
    </div>
  );
}

function SeatRow({ seat, isOwn, isEmpty, locked, onNameChange, onLeave }) {
  if (isEmpty) return <div className="seat-row empty">{t("openSeat")}</div>;

  const [r, g, b] = PLAYER_COLORS[seat.color] || [0x88, 0x88, 0x88];
  return (
    <div className={"seat-row" + (isOwn ? " own" : "")}>
      <div className="seat-swatch" style={{ background: `rgb(${r},${g},${b})` }} />
      {isOwn ? (
        <>
          <input
            className="seat-name"
            maxLength={30}
            value={seat.name}
            disabled={locked}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <ColorSwatches
            taken={seat.taken}
            selected={seat.color}
            onSelect={seat.onColorChange}
            disabled={locked || seat.ready}
          />
          <TeamPills
            selected={seat.team}
            onSelect={seat.onTeamChange}
            disabled={locked || seat.ready}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={seat.ready}
              disabled={locked}
              onChange={(e) => seat.onReadyChange(e.target.checked)}
            />
            {t("ready")}
          </label>
          <button type="button" className="seat-leave-btn" disabled={locked} onClick={onLeave}>
            {t("leave")}
          </button>
        </>
      ) : (
        <>
          <div className="seat-name">{seat.name}</div>
          <div className="seat-team">
            {t("team")} {seat.team}
          </div>
          <div className={"seat-ready " + (seat.ready ? "is-ready" : "not-ready")}>
            {seat.ready ? t("readyLabel") : t("notReadyLabel")}
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const sessionName = document.getElementById("root").dataset.sessionName;

  const [status, setStatus] = useState(null);
  const [mySeat, setMySeat] = useState(() => loadMySeat());
  const mySeatRef = useRef(mySeat);
  useEffect(() => { mySeatRef.current = mySeat; }, [mySeat]);

  const [myName, setMyName] = useState("");
  const [myColor, setMyColor] = useState(0);
  const [myTeam, setMyTeam] = useState(1);
  const [myReady, setMyReady] = useState(false);

  const [joinColor, setJoinColor] = useState(0);
  const [joinTeam, setJoinTeam] = useState(1);
  const joinNameRef = useRef(null);
  const [joinError, setJoinError] = useState(null);

  // Password gate - see PASSWORD_KEY/PENDING_PASSWORD_KEY above. verifiedPasswordRef is
  // what actually gets sent along with /join and /spectate once passwordOk is true (an
  // empty string is fine/expected for a session with no password at all).
  const [passwordOk, setPasswordOk] = useState(false);
  const [gateError, setGateError] = useState(null);
  const gatePasswordRef = useRef(null);
  const verifiedPasswordRef = useRef("");

  const [copyLabel, setCopyLabel] = useState(null);
  // 0 = no match scheduled. Non-zero mirrors server.js's session.started (a few seconds
  // in the future once every seat readies up) - see the Countdown component and the
  // redirect effect below, which fires once local wall-clock catches up to it rather
  // than waiting on the next POLL_INTERVAL_MS tick.
  const [startsAt, setStartsAt] = useState(0);

  const nameDebounce = useRef(null);

  // prefill the join form with whatever name was used last time, on this browser,
  // for any session - see NAME_KEY.
  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved && joinNameRef.current) joinNameRef.current.value = saved;
  }, []);

  // mySeat can come back from sessionStorage (loadMySeat()) on a fresh page load/refresh,
  // but myName/myColor/myTeam/myReady only ever get set locally by doJoin()/the seat
  // controls' own handlers - a refresh restores the SEAT but not what's actually claimed
  // on it, so the own-seat row rendered blank/default until this runs once to pull the
  // real values back out of the first status response. Guarded by hydratedSeatRef so it
  // fires exactly once per mount - after that, local state is the source of truth again
  // (same as before), otherwise this would fight optimistic edits every poll.
  const hydratedSeatRef = useRef(false);
  useEffect(() => {
    if (hydratedSeatRef.current || mySeat == null || !status) return;
    const seat = status.seats[mySeat];
    if (!seat) return;
    setMyName(seat.name);
    setMyColor(seat.color);
    setMyTeam(seat.team);
    setMyReady(seat.ready);
    hydratedSeatRef.current = true;
  }, [mySeat, status]);

  // Try to skip the password gate below using whichever candidate we have: a pending
  // handoff from create.jsx (this browser IS the creator, just typed it seconds ago) takes
  // priority over a previously-verified password for this same session id (a returning
  // visit/reload). Either way it's still verified against the server rather than trusted
  // outright - the pending one in particular could be stale if "creating" actually just
  // joined an already-existing same-slug session with a different password (see
  // createSession() in server.js).
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_PASSWORD_KEY);
    sessionStorage.removeItem(PENDING_PASSWORD_KEY);
    const candidate = pending || sessionStorage.getItem(PASSWORD_KEY) || "";
    if (!candidate) return;
    post(`/${sid}/verify-password`, { password: candidate }).then((res) => {
      if (!res.ok) return;
      sessionStorage.setItem(PASSWORD_KEY, candidate);
      verifiedPasswordRef.current = candidate;
      setPasswordOk(true);
    }).catch(() => {});
  }, []);

  async function submitGatePassword() {
    const password = gatePasswordRef.current.value;
    const res = await post(`/${sid}/verify-password`, { password });
    if (!res.ok) {
      setGateError(t("wrongPassword"));
      return;
    }
    sessionStorage.setItem(PASSWORD_KEY, password);
    verifiedPasswordRef.current = password;
    setGateError(null);
    setPasswordOk(true);
  }

  useEffect(() => {
    async function pollStatus() {
      // keep our own claimed seat's lastSeen fresh so server.js's /:id/status sweep
      // doesn't mistake this still-open tab for an abandoned one - piggybacked on the
      // same cadence as the status poll itself, no separate timer. Fire-and-forget: a
      // dropped heartbeat just means the seat goes stale a poll cycle later, not an error.
      if (mySeatRef.current != null) {
        post(`/${sid}/seat/${mySeatRef.current}/heartbeat`, {}).catch(() => {});
      }
      try {
        const resp = await fetch(`${origin}/${sid}/status`);
        const s = await resp.json();

        setStartsAt(s.startsAt || 0);

        // someone/something else cleared our seat (e.g. left from another tab) - fall
        // back to the join form rather than keep pretending we still hold it.
        if (mySeatRef.current != null && !s.seats[mySeatRef.current]) {
          setMySeat(null);
          clearMySeat();
        }

        setStatus(s);
      } catch (e) {
        console.log("Status poll failed", e);
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Fires the instant the countdown reaches zero rather than waiting out the rest of the
  // 2s status poll interval.
  useEffect(() => {
    if (!startsAt) return;
    const id = setInterval(() => {
      if (Date.now() < startsAt) return;
      clearInterval(id);
      document.location.href =
        mySeatRef.current != null
          ? `${origin}/${sid}/seat/${mySeatRef.current}`
          : spectateUrl();
    }, 200);
    return () => clearInterval(id);
  }, [startsAt]);

  // keep the join form's color selection off whatever's currently taken, same as the
  // old renderJoinSwatches().
  useEffect(() => {
    if (mySeat != null || !status) return;
    const taken = takenColors(status, -1);
    if (taken.has(joinColor)) {
      const free = [...Array(MAX_SEATS).keys()].find((c) => !taken.has(c)) ?? 0;
      setJoinColor(free);
    }
  }, [status, mySeat, joinColor]);

  async function doJoin() {
    const name = joinNameRef.current.value.trim() || t("player");
    localStorage.setItem(NAME_KEY, name);
    const res = await post(`/${sid}/join`, {
      name,
      color: joinColor,
      team: joinTeam,
      password: verifiedPasswordRef.current,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setJoinError(res.status === 403 ? t("wrongPassword") : body.error || "join failed");
      return;
    }
    setJoinError(null);
    const { seat } = await res.json();
    setMyName(name);
    setMyColor(joinColor);
    setMyTeam(joinTeam);
    setMyReady(false);
    setMySeat(seat);
    saveMySeat(seat);
  }

  function onNameChange(seat, value) {
    setMyName(value);
    clearTimeout(nameDebounce.current);
    const name = value.trim() || myName;
    nameDebounce.current = setTimeout(() => {
      localStorage.setItem(NAME_KEY, name);
      post(`/${sid}/seat/${seat}/update`, { name, color: myColor, team: myTeam });
    }, 400);
  }
  function updateColor(seat, color) {
    setMyColor(color);
    post(`/${sid}/seat/${seat}/update`, { name: myName, color, team: myTeam });
  }
  function updateTeam(seat, team) {
    setMyTeam(team);
    post(`/${sid}/seat/${seat}/update`, { name: myName, color: myColor, team });
  }
  function toggleReady(seat, ready) {
    setMyReady(ready);
    post(`/${sid}/seat/${seat}/ready`, { ready });
  }
  // Wait for the server to actually drop the seat before flipping back to the join
  // form - otherwise the next status poll (up to POLL_INTERVAL_MS away) can still show
  // this seat's now-freed color as taken, blocking the player from picking it right back.
  // Optimistically clearing the seat in local `status` (rather than waiting out a fresh
  // poll) is what makes the color available immediately.
  async function doLeave(seat) {
    await post(`/${sid}/seat/${seat}/leave`, {});
    setStatus((s) => (s ? { ...s, seats: s.seats.map((v, i) => (i === seat ? null : v)) } : s));
    setMySeat(null);
    clearMySeat();
  }

  // Entering this lobby already required the password (see the gate below) whenever one
  // is set, so spectating from here never needs to ask again - just carry the already-
  // verified password along.
  function spectateUrl() {
    const password = verifiedPasswordRef.current;
    return `${origin}/${sid}/spectate${password ? `?password=${encodeURIComponent(password)}` : ""}`;
  }
  function onSpectate() {
    document.location.href = spectateUrl();
  }

  async function onCopyLink() {
    try {
      await copyText(document.location.href);
      setCopyLabel(t("copied"));
      setTimeout(() => setCopyLabel(null), 1500);
    } catch (e) {
      console.log("Copy failed", e);
    }
  }

  const occupied = status ? status.seats.filter(Boolean) : [];
  const startHintHidden =
    occupied.length >= 2 &&
    occupied.every((s) => s.ready) &&
    new Set(occupied.map((s) => s.team)).size >= 2;
  // status starts null (still loading) - don't flash the gate (or the real lobby) before
  // we actually know whether this session has a password at all.
  const needsGate = status != null && status.hasPassword && !passwordOk;

  return (
    <>
      <div className="banner">
        <a className="new-game-btn" href="/">
          {t("home")}
        </a>
        <div className="left-text" id="sessionName">
          {sessionName} - <span>{t("lobbySuffix")}</span>
        </div>
        <button className="copy-link-btn" type="button" onClick={onCopyLink}>
          {copyLabel || t("copyLink")}
        </button>
      </div>

      <GameOptions status={status} />

      {needsGate ? (
        <div className="links password-gate">
          <p className="section-title">{t("enterPassword")}</p>
          <div className="form-row">
            <input
              ref={gatePasswordRef}
              type="password"
              maxLength={100}
              className="field"
              placeholder={t("passwordPlaceholder")}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && submitGatePassword()}
            />
            <button type="button" className="btn btn-blue" onClick={submitGatePassword}>
              {t("unlock")}
            </button>
          </div>
          {gateError && <p className="hint join-error">{gateError}</p>}
        </div>
      ) : (
        <>
          {startsAt > 0 && <Countdown startsAt={startsAt} />}

          <div className="links join-form" hidden={mySeat != null || startsAt > 0}>
            <input
              ref={joinNameRef}
              type="text"
              maxLength={30}
              className="field"
              placeholder={t("yourName")}
              autoComplete="off"
            />
            <ColorSwatches taken={takenColors(status, -1)} selected={joinColor} onSelect={setJoinColor} />
            <span className="team-label">{t("team")}</span>
            <TeamPills selected={joinTeam} onSelect={setJoinTeam} />
            <button type="button" className="btn btn-blue" onClick={doJoin}>
              {t("joinGame")}
            </button>
            {joinError && <p className="hint join-error">{joinError}</p>}
          </div>

          <div className="links">
            <div className="seat-grid">
              {Array.from({ length: status ? status.seats.length : MAX_SEATS }, (_, i) => {
                const isOwn = i === mySeat;
                const raw = isOwn
                  ? { name: myName, color: myColor, team: myTeam, ready: myReady }
                  : status?.seats[i];
                if (!raw) return <SeatRow key={i} isEmpty />;
                const seat = isOwn
                  ? {
                      ...raw,
                      taken: takenColors(status, mySeat),
                      onColorChange: (c) => updateColor(i, c),
                      onTeamChange: (tm) => updateTeam(i, tm),
                      onReadyChange: (rdy) => toggleReady(i, rdy),
                    }
                  : raw;
                return (
                  <SeatRow
                    key={i}
                    seat={seat}
                    isOwn={isOwn}
                    locked={startsAt > 0}
                    onNameChange={(v) => onNameChange(i, v)}
                    onLeave={() => doLeave(i)}
                  />
                );
              })}
            </div>
            <p className="hint" hidden={startHintHidden}>
              {t("readyHint")}
            </p>
          </div>

          <div className="links">
            <button
              className="btn btn-spectate"
              type="button"
              disabled={status ? !status.allowSpectate : true}
              onClick={onSpectate}
            >
              {t("spectateBtn")}
            </button>
          </div>
        </>
      )}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
