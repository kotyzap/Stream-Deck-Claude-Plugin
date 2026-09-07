// Claude usage — burn-rate chart on the deck, in three forms.
// Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
//
//  IdleOverlay  after IDLE_MS with no key pressed, EVERY Deck for Claude key repaints itself as
//               the chart; the next press restores the normal art and is swallowed, so waking the
//               deck can never fire Allow/Deny by accident. A screensaver we own outright.
//  Stats key    a single "Claude Usage" key — all three limits condensed onto one tile.
//  Row mode     several "Claude Usage" keys on one row — that row becomes a 0-100% scale and each
//               key paints its slice of one big bar.
//
// A deck ROW maps to one limit: row 1 session, row 2 weekly, row 3 the scoped/model cap. Rows past
// the number of limits stay blank; on a 2-row Mini only the first two limits fit.
//
// Data: GET https://api.anthropic.com/api/oauth/usage with the OAuth access token Claude Code
// keeps in the login keychain ("Claude Code-credentials"). Read-only, never leaves the Mac.
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { execFile } from "node:child_process";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

const KEY = 144;              // key art is 144×144
const GAP = 42;               // logical pixels of bezel between two keys (≈0.3 of a key)
const PITCH = KEY + GAP;
const AVAIL = KEY - 24;       // a text run must fit inside one key or the bezel slices it

const MS_ACTIVE = 45_000;      // something is moving → keep it fresh (the endpoint 429s if pushed)
const MS_IDLE = 120_000;       // nothing has changed recently
const MS_DORMANT = 300_000;    // Claude.app isn't even running
const MS_THROTTLED = 600_000;  // the endpoint pushed back (429) — stay away for a while
const ACTIVE_FOR = 5 * 60_000; // stay in fast mode this long after the last change
const IDLE_MS = 30_000;        // no key pressed for this long → the deck becomes the chart

const sh = (cmd, args) =>
    new Promise((res, rej) => execFile(cmd, args, { timeout: 8000 }, (e, out) => (e ? rej(e) : res(out))));

// ---------------------------------------------------------------- data
async function accessToken() {
    const raw = await sh("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    const tok = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (!tok) throw new Error("no accessToken in keychain item");
    return tok;
}

/** The API returns many named buckets; `limits[]` is the same list the Claude app's popup renders. */
async function readUsage() {
    const res = await fetch(USAGE_URL, {
        headers: {
            authorization: `Bearer ${await accessToken()}`,
            "anthropic-beta": "oauth-2025-04-20",
            "user-agent": "ClaudeDeck/1.0 (Stream Deck)",
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) throw new Error("auth");
    if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        const err = new Error("throttled");
        err.retryMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : MS_THROTTLED;
        throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return (Array.isArray(body?.limits) ? body.limits : []).map((l) => ({
        kind: l.kind ?? "",
        group: l.group ?? "",
        label: barLabel(l),
        sub: barSub(l),
        percent: Math.max(0, Math.min(100, Math.round(l.percent ?? 0))),
        severity: l.severity ?? "normal",
        resetsAt: Number.isFinite(Date.parse(l.resets_at)) ? Date.parse(l.resets_at) : null,
        locked: Boolean(l.locked_reason),
    }));
}

function barLabel(l) {
    const model = l.scope?.model?.display_name;
    if (model) return model.toUpperCase();
    if (l.scope?.surface) return String(l.scope.surface).toUpperCase();
    return l.kind === "session" ? "SESSION" : l.kind === "weekly_all" ? "WEEKLY" : String(l.kind ?? "").toUpperCase();
}

function barSub(l) {
    if (l.kind === "session") return "5-hour window";
    if (l.kind === "weekly_all") return "all models";
    return l.scope ? "weekly cap" : "";
}

async function claudeRunning() {
    try { await sh("/usr/bin/pgrep", ["-x", "Claude"]); return true; } catch { return false; }
}

// ---------------------------------------------------------------- projection
// The API reports only how much is spent, never a forecast — the Claude app derives its
// "~85% left at reset" marker locally, and so do we, from the average pace over the window
// so far: rate = percent / elapsed, extrapolated across the time still to run.
//
// Do NOT reintroduce a short-window "recent rate" here. It was tried and removed: a one-hour
// sample extrapolated across a 41-hour remaining window swings wildly — an idle hour reads as
// "flat" (hiding the marker under the fill) and a busy hour reads as "you run out today".
// The plain average reproduces the desktop app's own three numbers exactly; verified 2026-09-07.
const WINDOW_HOURS = { session: 5, weekly: 24 * 7 };   // keyed on `group` — the live API sends
                                                       // group "session" once and "weekly" twice

/**
 * Where the bar SHOULD be right now, and where it is heading.
 *
 * `marker` is the on-pace line: the fraction of the window already elapsed. That is what the
 * desktop app's vertical tick actually shows — NOT the forecast. Bar left of the tick = under
 * pace, right of it = burning faster than the window allows.
 *
 * `note` is the forecast, from the average pace so far (rate = percent / elapsed) extrapolated
 * over the time still to run. The two agree by construction: projected >= 100% exactly when the
 * bar is past the pace line, so a "limit in ..." note always coincides with an over-pace bar.
 *
 * @returns {marker, note, overPace} or null when the window is unknown or already over.
 */
function project(bar) {
    const windowHours = WINDOW_HOURS[bar.group];
    if (!windowHours || bar.resetsAt == null) return null;
    const hoursLeft = (bar.resetsAt - Date.now()) / 3600e3;
    if (hoursLeft <= 0) return null;
    const elapsed = windowHours - hoursLeft;
    if (elapsed <= 0.05) return null;

    const pace = Math.max(0, Math.min(100, (elapsed / windowHours) * 100));
    const rate = bar.percent / elapsed;
    const projected = bar.percent + rate * hoursLeft;
    const note = projected < 100
        ? `~${Math.round(100 - projected)}% left`
        : `limit ${shortSpan(rate > 0 ? (100 - bar.percent) / rate : 0)}`;
    return { marker: pace, note, overPace: projected >= 100 };
}

function shortSpan(hours) {
    const m = Math.max(0, Math.round(hours * 60));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m % 60}m`;
    return `${m}m`;
}

// ---------------------------------------------------------------- rendering
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function barColor(bar) {
    if (bar.locked || bar.severity === "critical" || bar.percent >= 95) return "#ff453a";
    if (bar.projection?.overPace) return "#ff453a";   // ahead of what the window allows
    if (bar.percent >= 80 || bar.severity === "warning") return "#ff9f0a";
    if (bar.percent >= 60) return "#ffd60a";
    return "#34c759";
}

function countdown(ms) {
    if (ms == null) return "";
    const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return `in ${d}d ${h}h`;
    if (h) return `in ${h}h ${m}m`;
    return `in ${m}m`;
}

/** Largest font size <= base at which `text` still fits inside a single key. */
function fit(text, base) {
    if (!text) return base;
    return Math.max(11, Math.min(base, Math.floor(AVAIL / (0.6 * text.length))));
}

/**
 * One key's slice of one row-wide bar.
 * @param bar    {label, sub, percent, severity, resetsAt, locked} — null renders an empty tile
 * @param index  0-based position of this key within its row
 * @param span   number of keys in the row
 * @param note   replaces the bar when there is no data ("offline", "sign in"…)
 */
function keySvg(bar, index, span, note) {
    const W = span * KEY + (span - 1) * GAP;   // logical width of the whole row
    const dx = index * PITCH;                   // this key's window into it
    const body = note ? noticeBody(W, note) : bar ? barBody(W, span, bar) : "";
    // Every image the plugin sets must be fully opaque: Stream Deck leaves whatever was on the key
    // showing through transparent pixels, so a rounded tile alone leaves the old art at the edges.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY}" height="${KEY}" viewBox="0 0 ${KEY} ${KEY}">
<rect width="${KEY}" height="${KEY}" fill="#000"/>
<g transform="translate(${-dx},0)">
<rect x="0" y="0" width="${W}" height="${KEY}" rx="18" fill="#1c1c1e"/>
${body}
</g></svg>`;
}

function barBody(W, span, bar) {
    const c = barColor(bar);
    const w = Math.max(bar.percent > 0 ? 24 : 0, (W * bar.percent) / 100);
    const pct = `${bar.percent}%`;
    const reset = countdown(bar.resetsAt);
    const note = bar.projection?.note ?? "";
    let out = `
<text x="12" y="42" font-family="Helvetica, Arial, sans-serif" font-size="${fit(bar.label, 25)}" font-weight="700" fill="#f2f2f7">${esc(bar.label)}</text>
<text x="${W - 12}" y="42" font-family="Helvetica, Arial, sans-serif" font-size="${fit(note, 22)}" font-weight="700" fill="#a1a1a6" text-anchor="end">${esc(note)}</text>
<rect x="0" y="56" width="${W}" height="48" rx="24" fill="#3a3a3c"/>
<rect x="0" y="56" width="${w}" height="48" rx="24" fill="${c}"/>`;
    // The on-pace line. A hairline vanishes once the deck downscales 144->72, so it is 8px wide
    // with an overhang above and below the track; dark where it crosses the fill, light on the
    // empty track, so it reads either side of the bar tip.
    if (bar.projection) {
        const mx = Math.max(4, Math.min(W - 4, (W * bar.projection.marker) / 100));
        out += `<rect x="${mx - 4}" y="50" width="8" height="60" rx="4" fill="${mx <= w ? "#1c1c1e" : "#f2f2f7"}" fill-opacity="0.92"/>`;
    }
    // The percentage rides the tip of the fill. Each key clips its own window, so text straddling
    // a bezel gap would be sliced in half — snap it into one key: just after the tip, else inside
    // the fill, else the start of the next key, else pinned inside the last key.
    const tw = 18 * pct.length;
    const k = Math.min(Math.floor(w / PITCH), span - 1);
    const ws = k * PITCH, we = ws + KEY;
    let x, tc;
    if (w + 14 >= ws + 8 && w + 14 + tw <= we - 8) { x = w + 14; tc = c; }
    else if (w - 14 - tw >= ws + 8 && w - 14 <= we - 8) { x = w - 14 - tw; tc = "#1c1c1e"; }
    else if ((k + 1) * PITCH + tw + 8 <= Math.min(W, (k + 1) * PITCH + KEY)) { x = (k + 1) * PITCH + 8; tc = c; }
    else { x = we - 8 - tw; tc = x < w ? "#1c1c1e" : c; }
    out += `<text x="${x}" y="92" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${tc}">${pct}</text>`;
    if (bar.sub) {
        out += `<text x="12" y="132" font-family="Helvetica, Arial, sans-serif" font-size="${fit(bar.sub, 20)}" font-weight="600" fill="#636366">${esc(bar.sub)}</text>`;
    }
    if (reset) {
        out += `<text x="${W - 12}" y="132" font-family="Helvetica, Arial, sans-serif" font-size="${fit(reset, 20)}" font-weight="600" fill="#636366" text-anchor="end">${esc(reset)}</text>`;
    }
    return out;
}

/** All three limits on one key — the "Stats" tile, for when you don't want to give up a row. */
function statsSvg(bars, note) {
    let body = "";
    if (note || !bars?.length) {
        body = `<text x="72" y="80" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="#8e8e93" text-anchor="middle">${esc(note ?? "no data")}</text>`;
    } else {
        bars.slice(0, 3).forEach((bar, i) => {
            const top = 12 + i * 44;
            const c = barColor(bar);
            const short = bar.label.length > 7 ? bar.label.slice(0, 7) : bar.label;
            const pct = `${bar.percent}%`;
            const w = Math.max(bar.percent > 0 ? 8 : 0, (128 * bar.percent) / 100);
            body += `
<text x="8" y="${top + 13}" font-family="Helvetica, Arial, sans-serif" font-size="${fit(short, 16)}" font-weight="700" fill="#f2f2f7">${esc(short)}</text>
<text x="136" y="${top + 13}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="${c}" text-anchor="end">${pct}</text>
<rect x="8" y="${top + 19}" width="128" height="13" rx="6.5" fill="#3a3a3c"/>
<rect x="8" y="${top + 19}" width="${w}" height="13" rx="6.5" fill="${c}"/>`;
            if (bar.projection) {
                const mx = 8 + Math.max(2, Math.min(126, (128 * bar.projection.marker) / 100));
                body += `<rect x="${mx - 2}" y="${top + 16}" width="4" height="19" rx="2" fill="${mx <= 8 + w ? "#1c1c1e" : "#f2f2f7"}" fill-opacity="0.92"/>`;
            }
        });
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="#000"/>
<rect width="144" height="144" rx="18" fill="#1c1c1e"/>${body}</svg>`;
}

function noticeBody(W, note) {
    return `<text x="${KEY / 2}" y="${KEY / 2 + 9}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="600" fill="#8e8e93" text-anchor="middle">${esc(note)}</text>`;
}

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/**
 * setImage returns a promise that rejects if the action's context died (profile switch, key
 * removed) while a poll was in flight. Unhandled, that takes the whole plugin down with it.
 */
function paint(action, svg) {
    try { action.setImage(dataUri(svg))?.catch?.(() => {}); }
    catch { /* context already gone */ }
}

// ---------------------------------------------------------------- shared poller
/**
 * One poller behind every view. Subscribers come and go (keys placed/removed, overlay armed);
 * polling runs only while at least one is listening, and backs off hard when Claude is closed.
 */
class UsageMonitor {
    #subs = new Set();
    #timer = null;
    #polling = false;         // a poll in flight; refresh() must not start a second one
    #activeUntil = 0;
    bars = null;
    note = "loading…";

    subscribe(fn) {
        this.#subs.add(fn);
        if (this.#subs.size === 1) this.#schedule(0);
        return () => {
            this.#subs.delete(fn);
            if (this.#subs.size === 0) { clearTimeout(this.#timer); this.#timer = null; }
        };
    }

    /** Bring the next poll forward — used when something is about to become visible. */
    refresh() { if (this.#subs.size && !this.#polling) this.#schedule(0); }

    #schedule(ms) {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(async () => {
            this.#polling = true;
            let next;
            try { next = await this.#poll(); } finally { this.#polling = false; }
            if (this.#subs.size) this.#schedule(next);
        }, ms);
    }

    /** @returns the delay until the next poll. */
    async #poll() {
        try {
            const bars = await readUsage();
            if (!this.bars || bars.some((b, i) => b.percent !== this.bars[i]?.percent)) {
                this.#activeUntil = Date.now() + ACTIVE_FOR;
            }
            for (const bar of bars) bar.projection = project(bar);
            this.bars = bars;
            this.note = bars.length ? null : "no limits";
        } catch (e) {
            streamDeck.logger.warn(`usage poll failed: ${e.message}`);
            if (e.message === "auth") { this.bars = null; this.note = "sign in"; }
            else if (this.bars) { /* keep the last good chart — a blip is not worth blanking it */ }
            else this.note = e.message === "throttled" ? "easy…" : "offline";
            if (e.message === "throttled") {
                for (const fn of this.#subs) { try { fn(); } catch { /* keep going */ } }
                return e.retryMs ?? MS_THROTTLED;
            }
        }
        for (const fn of this.#subs) { try { fn(); } catch { /* a bad painter must not stop the rest */ } }
        if (Date.now() < this.#activeUntil) return MS_ACTIVE;
        return (await claudeRunning()) ? MS_IDLE : MS_DORMANT;
    }
}

export const monitor = new UsageMonitor();

/** Deck row N (top-down) shows limit N; each key paints its slice of that row's bar. */
function paintStrips(slots, bars, note) {
    const decks = new Map();
    for (const slot of slots) {
        (decks.get(slot.device) ?? decks.set(slot.device, []).get(slot.device)).push(slot);
    }
    for (const inDeck of decks.values()) {
        const rows = [...new Set(inDeck.map((s) => s.row))].sort((a, b) => a - b);
        for (const [rowIndex, row] of rows.entries()) {
            const inRow = inDeck.filter((s) => s.row === row).sort((a, b) => a.column - b.column);
            const first = inRow[0].column;
            const span = inRow[inRow.length - 1].column - first + 1;   // gaps in the row stay blank
            const bar = bars?.[rowIndex] ?? null;
            const rowNote = note && rowIndex === 0 ? note : note ? " " : null;   // say it once
            for (const slot of inRow) {
                paint(slot.action, keySvg(bar, slot.column - first, span, rowNote));
            }
        }
    }
}

// ---------------------------------------------------------------- idle overlay
/**
 * The fake screensaver. Every Deck for Claude key registers here with a callback that restores
 * its normal art; after IDLE_MS of no presses they all become the usage chart instead.
 */
export class IdleOverlay {
    #slots = new Map();       // action.id → { action, device, row, column, restore }
    #timer = null;
    #unsub = null;
    #on = false;

    /** True while the chart owns the deck — other painters must stand down. */
    get isOn() { return this.#on; }

    /** Summon the chart now, without waiting for IDLE_MS. */
    show() { this.#show(); }

    register(action, coordinates, restore) {
        if (!coordinates) return;
        this.#slots.set(action.id, {
            action, restore,
            device: action.device?.id ?? "?",
            row: coordinates.row, column: coordinates.column,
        });
        if (this.#on) { this.#paint(); return; }   // late arrival joins the chart in progress
        this.#arm();
    }

    unregister(actionId) {
        this.#slots.delete(actionId);
        if (this.#slots.size === 0) {
            clearTimeout(this.#timer); this.#timer = null;
            this.#unsub?.(); this.#unsub = null;
            this.#on = false;
        } else if (this.#on) {
            this.#paint();   // the row lost a key; redraw so the remaining slices line up again
        }
    }

    /**
     * Called at the top of every key press.
     * @returns true when the press only woke the deck and must NOT run the action.
     */
    wake() {
        const wasOn = this.#on;
        if (wasOn) {
            this.#on = false;
            this.#unsub?.(); this.#unsub = null;   // stop polling until the deck goes quiet again
            for (const slot of this.#slots.values()) { try { slot.restore(); } catch { /* keep going */ } }
        }
        this.#arm();
        return wasOn;
    }

    #arm() {
        clearTimeout(this.#timer);
        if (this.#slots.size) this.#timer = setTimeout(() => this.#show(), IDLE_MS);
    }

    #show() {
        if (!this.#slots.size || this.#on) return;
        this.#on = true;
        // subscribe only now: while the user is working the deck we have no reason to poll at all
        this.#unsub ??= monitor.subscribe(() => { if (this.#on) this.#paint(); });
        monitor.refresh();
        this.#paint();
    }

    #paint() { paintStrips([...this.#slots.values()], monitor.bars, monitor.note); }
}

// ---------------------------------------------------------------- "Claude Usage" action
export class ClaudeUsage extends SingletonAction {
    manifestId;
    #slots = new Map();
    #unsub = null;
    #overlay;

    constructor(manifestId, overlay) { super(); this.manifestId = manifestId; this.#overlay = overlay; }

    onWillAppear(ev) {
        const c = ev.payload.coordinates;
        if (ev.payload.isInMultiAction || !c) return;
        this.#slots.set(ev.action.id, {
            action: ev.action, device: ev.action.device?.id ?? "?", row: c.row, column: c.column,
        });
        // also joins the overlay, so an idle deck paints one chart across these keys too
        this.#overlay?.register(ev.action, c, () => this.paint());
        if (!this.#unsub) this.#unsub = monitor.subscribe(() => this.paint());
        this.paint();
        monitor.refresh();
    }

    onWillDisappear(ev) {
        this.#slots.delete(ev.action.id);
        this.#overlay?.unregister(ev.action.id);
        if (this.#slots.size === 0) { this.#unsub?.(); this.#unsub = null; }
        else this.paint();
    }

    /**
     * Toggle. If the chart is up, this press dismisses it like any other key; if not, it summons
     * it immediately rather than waiting out the idle timer.
     */
    onKeyDown() {
        if (this.#overlay?.wake()) return;   // was showing -> that press put the keys back
        this.#overlay?.show();
    }

    /** Alone on its row it is a compact Stats tile; with neighbours it becomes a slice of the bar. */
    paint() {
        if (this.#overlay?.isOn) return;   // the overlay owns every key right now

        const solo = [], strip = [];
        for (const slot of this.#slots.values()) {
            const others = [...this.#slots.values()].filter(
                (o) => o.device === slot.device && o.row === slot.row && o !== slot);
            (others.length ? strip : solo).push(slot);
        }
        for (const slot of solo) paint(slot.action, statsSvg(monitor.bars, monitor.note));
        paintStrips(strip, monitor.bars, monitor.note);
    }
}
