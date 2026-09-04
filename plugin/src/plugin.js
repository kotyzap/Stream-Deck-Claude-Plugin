// Claude for Stream Deck — actions for the Claude desktop app
// Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
//
// All keys except "Claude Status" fire claudedeck:// URLs handled by ~/Applications/ClaudeDeck.app
// (AppleScript applet + Swift `axpress` helper, macOS Accessibility API). macOS only.
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN = "com.4xsdev.claude";
const HELPER = join(homedir(), "Applications", "ClaudeDeck.app");
const BUNDLED_HELPER = join(process.cwd(), "resources", "ClaudeDeck.app");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

const sh = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, out) => (e ? rej(e) : res(out))));

/** First run: install the bundled ClaudeDeck.app (URL-scheme handler) if the user doesn't have it yet. */
async function ensureHelper() {
    if (existsSync(HELPER) || !existsSync(BUNDLED_HELPER)) return;
    try {
        await sh("mkdir", ["-p", join(homedir(), "Applications")]);
        await sh("ditto", [BUNDLED_HELPER, HELPER]);                 // preserves bundle + signature
        await sh("xattr", ["-dr", "com.apple.quarantine", HELPER]);  // came from a downloaded zip
        await sh(LSREGISTER, ["-f", HELPER]);
        streamDeck.logger.info(`installed ${HELPER}`);
        fire("claudedeck://inspect");                                // triggers the one-time Accessibility prompt
    } catch (e) {
        streamDeck.logger.error(`helper install failed: ${e.message}`);
    }
}

function fire(url) {
    execFile("open", [url], (err) => {
        if (err) streamDeck.logger.error(`open ${url}: ${err.message}`);
    });
}

/** Key art matching the static PNGs: colour bar, glyph, baked-in label (no Stream Deck title overlay). */
const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function labelledKey(glyph, color, title) {
    const lines = String(title).split("\n").slice(0, 2);
    const size = Math.max(...lines.map((l) => l.length)) <= 8 ? 24 : 20;
    const y0 = lines.length === 1 ? 104 : 96;
    const text = lines.map((l, i) =>
        `<text x="72" y="${y0 + i * (size + 2)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#f2f2f7" text-anchor="middle">${escXml(l)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="#1c1c1e"/><rect width="144" height="10" fill="${color}"/>
  <text x="72" y="62" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="${color}" text-anchor="middle">${escXml(glyph)}</text>${text}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Key that fires one fixed URL on press. */
class UrlAction extends SingletonAction {
    constructor(manifestId, url) {
        super();
        this.manifestId = manifestId;
        this.url = url;
    }
    onKeyDown() { fire(this.url); }
}

/** Reply — types the configured text into Claude and presses Return. */
class Reply extends SingletonAction {
    manifestId = `${PLUGIN}.reply`;
    onWillAppear(ev) { this.#paint(ev.action, ev.payload.settings); }
    onDidReceiveSettings(ev) { this.#paint(ev.action, ev.payload.settings); }
    onKeyDown(ev) {
        const text = (ev.payload.settings.text ?? "continue").trim();
        if (!text) return;
        fire(`claudedeck://type/${encodeURIComponent(text)}`);
    }
    #paint(a, s) { a.setImage(labelledKey("›", "#d97757", s.text?.trim() || "continue")); }
}

/** Shortcut — sends one of Claude.app's own accelerators (Claude is activated first). */
const SHORTCUTS = {
    "new-chat":     { title: "New\nchat",    combo: "cmd+n" },
    "new-session":  { title: "New\nsession", combo: "cmd+shift+o" },
    "search":       { title: "Search",       combo: "cmd+shift+k" },
    "palette":      { title: "Palette",      combo: "cmd+k" },
    "sidebar":      { title: "Sidebar",      combo: "cmd+b" },
    "prev-session": { title: "Prev\nsession", combo: "cmd+shift+[" },
    "next-session": { title: "Next\nsession", combo: "cmd+shift+]" },
    "side-chat":    { title: "Side\nchat",   combo: "cmd+;" },
};
class Shortcut extends SingletonAction {
    manifestId = `${PLUGIN}.shortcut`;
    onWillAppear(ev) { this.#paint(ev.action, ev.payload.settings); }
    onDidReceiveSettings(ev) { this.#paint(ev.action, ev.payload.settings); }
    onKeyDown(ev) {
        const sc = SHORTCUTS[ev.payload.settings.shortcut] ?? SHORTCUTS["new-chat"];
        fire(`claudedeck://hotkey/${encodeURIComponent(sc.combo)}`);
    }
    #paint(a, s) { a.setImage(labelledKey("⌘", "#8e8e93", (SHORTCUTS[s.shortcut] ?? SHORTCUTS["new-chat"]).title)); }
}

// ---------------------------------------------------------------- Claude Status
const STATUS_URL = "https://status.claude.com/api/v2/status.json";
const COMPONENTS_URL = "https://status.claude.com/api/v2/components.json";
const PAGE_URL = "https://status.claude.com";
const POLL_MS = 60_000;
const LEVELS = {
    none:        { color: "#34c759", label: "OK" },
    minor:       { color: "#ffd60a", label: "Minor" },
    major:       { color: "#ff9f0a", label: "Major" },
    critical:    { color: "#ff453a", label: "Critical" },
    maintenance: { color: "#0a84ff", label: "Maint." },
    unknown:     { color: "#8e8e93", label: "?" },
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function keySvg(level, subtitle) {
    const { color, label } = LEVELS[level] ?? LEVELS.unknown;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="#1c1c1e"/>
  <rect width="144" height="10" fill="${color}"/>
  <circle cx="72" cy="52" r="22" fill="${color}"/>
  <text x="72" y="98" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#f2f2f7" text-anchor="middle">${esc(label)}</text>
  <text x="72" y="124" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#a1a1a6" text-anchor="middle">${esc(subtitle)}</text>
</svg>`;
}
async function fetchJson(url) {
    const res = await fetch(url, { headers: { "User-Agent": "ClaudeDeck/1.0 (Stream Deck)" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
}
async function readStatus() {
    const status = await fetchJson(STATUS_URL);
    let subtitle = "Claude";
    try {
        const { components } = await fetchJson(COMPONENTS_URL);
        const bad = components.filter((c) => c.status !== "operational" && !c.group);
        if (bad.length === 1) subtitle = bad[0].name.replace(/\s*\(.*\)/, "");
        else if (bad.length > 1) subtitle = `${bad.length} components`;
    } catch { /* keep generic subtitle */ }
    return { level: status.status?.indicator ?? "unknown", subtitle };
}
class ClaudeStatus extends SingletonAction {
    manifestId = `${PLUGIN}.status`;
    #timer = null;
    #last = { level: "unknown", subtitle: "loading…" };
    onWillAppear(ev) {
        this.#paint(ev.action);
        if (!this.#timer) { this.#poll(); this.#timer = setInterval(() => this.#poll(), POLL_MS); }
    }
    onWillDisappear() {
        if ([...this.actions].length <= 1 && this.#timer) { clearInterval(this.#timer); this.#timer = null; }
    }
    onKeyDown() { streamDeck.system.openUrl(PAGE_URL); this.#poll(); }
    async #poll() {
        try { this.#last = await readStatus(); }
        catch (e) { streamDeck.logger.warn(`status poll failed: ${e.message}`); this.#last = { level: "unknown", subtitle: "offline" }; }
        for (const a of this.actions) this.#paint(a);
    }
    #paint(a) {
        a.setImage(`data:image/svg+xml;base64,${Buffer.from(keySvg(this.#last.level, this.#last.subtitle)).toString("base64")}`);
    }
}

// ---------------------------------------------------------------- register
for (const [id, url] of Object.entries({
    "allow-once":    "claudedeck://allow-once",
    "allow-session": "claudedeck://allow-session",
    "always-allow":  "claudedeck://always-allow",
    "deny":          "claudedeck://deny",
    "stop":          "claudedeck://stop",
    "activate":      "claudedeck://activate",
    "inspect":       "claudedeck://inspect",
})) streamDeck.actions.registerAction(new UrlAction(`${PLUGIN}.${id}`, url));
/** Ko-fi — opens the support page. */
class Kofi extends SingletonAction {
    manifestId = `${PLUGIN}.kofi`;
    onKeyDown() { streamDeck.system.openUrl("https://ko-fi.com/K3K6RR4LY"); }
}

streamDeck.actions.registerAction(new Kofi());
streamDeck.actions.registerAction(new Reply());
streamDeck.actions.registerAction(new Shortcut());
streamDeck.actions.registerAction(new ClaudeStatus());
streamDeck.connect();
ensureHelper();
