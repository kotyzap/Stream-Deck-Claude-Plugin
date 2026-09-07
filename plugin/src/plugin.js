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
import { ClaudeUsage, IdleOverlay } from "./usage.js";

const PLUGIN = "com.4xsdev.claude";
const HELPER = join(homedir(), "Applications", "ClaudeDeck.app");
const BUNDLED_HELPER = join(process.cwd(), "resources", "ClaudeDeck.app");
const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** The fake screensaver: every key below registers with it and yields the deck when idle. */
const overlay = new IdleOverlay();

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

function fire(url, action) {
    execFile("open", [url], (err) => {
        if (!err) return;
        streamDeck.logger.error(`open ${url}: ${err.message}`);
        action?.showAlert();   // ClaudeDeck.app missing or URL scheme not registered
    });
}

/** Key art matching the static PNGs: colour bar, glyph, baked-in label (no Stream Deck title overlay). */
const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function labelledKey(glyph, color, title) {
    const lines = String(title).split("\n").slice(0, 2);
    const size = Math.max(...lines.map((l) => l.length)) <= 8 ? 25 : 21;
    const y0 = lines.length === 1 ? 104 : 96;
    const text = lines.map((l, i) =>
        `<text x="72" y="${y0 + i * (size + 2)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="700" fill="#f2f2f7" text-anchor="middle">${escXml(l)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="#000"/><rect width="144" height="144" rx="18" fill="#1c1c1e"/><rect width="144" height="10" fill="${color}"/>
  <text x="72" y="62" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="${color}" text-anchor="middle">${escXml(glyph)}</text>${text}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Key that fires one fixed URL on press. */
class UrlAction extends SingletonAction {
    constructor(manifestId, url) {
        super();
        this.manifestId = manifestId;
        this.url = url;
        // Restore by explicit path rather than setImage()'s revert-to-manifest, so the repaint
        // is unambiguous — these PNGs are fully opaque, unlike the SVG tiles.
        this.art = `imgs/actions/${manifestId.slice(PLUGIN.length + 1)}/key.png`;
    }
    onWillAppear(ev) {
        overlay.register(ev.action, ev.payload.coordinates,
            () => { try { ev.action.setImage(this.art)?.catch?.(() => {}); } catch { /* gone */ } });
    }
    onWillDisappear(ev) { overlay.unregister(ev.action.id); }
    onKeyDown(ev) {
        if (overlay.wake()) return;   // the press only woke the deck — never fire on a wake tap
        fire(this.url, ev.action);
    }
}

/** Reply — types the configured text into Claude and presses Return. */
class Reply extends SingletonAction {
    manifestId = `${PLUGIN}.reply`;
    #settings = new Map();   // action.id → latest settings, so the overlay restores the current label
    onWillAppear(ev) {
        this.#settings.set(ev.action.id, ev.payload.settings);
        if (!overlay.isOn) this.#paint(ev.action, ev.payload.settings);
        overlay.register(ev.action, ev.payload.coordinates,
            () => this.#paint(ev.action, this.#settings.get(ev.action.id) ?? {}));
    }
    onWillDisappear(ev) { this.#settings.delete(ev.action.id); overlay.unregister(ev.action.id); }
    onDidReceiveSettings(ev) {
        this.#settings.set(ev.action.id, ev.payload.settings);
        // Stream Deck fires this while its window is open; repainting now would stomp the chart.
        if (!overlay.isOn) this.#paint(ev.action, ev.payload.settings);
    }
    onKeyDown(ev) {
        if (overlay.wake()) return;
        const text = (ev.payload.settings.text ?? "Continue").trim();
        if (!text) return;
        fire(`claudedeck://type/${encodeURIComponent(text)}`, ev.action);
    }
    #paint(a, s) { try { a.setImage(labelledKey("›", "#d97757", s.text?.trim() || "Continue"))?.catch?.(() => {}); } catch { /* gone */ } }
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
    #settings = new Map();   // action.id → latest settings, so the overlay restores the current glyph
    onWillAppear(ev) {
        this.#settings.set(ev.action.id, ev.payload.settings);
        if (!overlay.isOn) this.#paint(ev.action, ev.payload.settings);
        overlay.register(ev.action, ev.payload.coordinates,
            () => this.#paint(ev.action, this.#settings.get(ev.action.id) ?? {}));
    }
    onWillDisappear(ev) { this.#settings.delete(ev.action.id); overlay.unregister(ev.action.id); }
    onDidReceiveSettings(ev) {
        this.#settings.set(ev.action.id, ev.payload.settings);
        if (!overlay.isOn) this.#paint(ev.action, ev.payload.settings);
    }
    onKeyDown(ev) {
        if (overlay.wake()) return;
        const sc = SHORTCUTS[ev.payload.settings.shortcut] ?? SHORTCUTS["new-chat"];
        fire(`claudedeck://hotkey/${encodeURIComponent(sc.combo)}`, ev.action);
    }
    #paint(a, s) { try { a.setImage(labelledKey("⌘", "#8e8e93", (SHORTCUTS[s.shortcut] ?? SHORTCUTS["new-chat"]).title))?.catch?.(() => {}); } catch { /* gone */ } }
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
  <rect width="144" height="144" fill="#000"/>
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
        if (!overlay.isOn) this.#paint(ev.action);
        overlay.register(ev.action, ev.payload.coordinates, () => this.#paint(ev.action));
        if (!this.#timer) { this.#poll(); this.#timer = setInterval(() => this.#poll(), POLL_MS); }
    }
    onWillDisappear(ev) {
        overlay.unregister(ev.action.id);
        if ([...this.actions].length === 0 && this.#timer) { clearInterval(this.#timer); this.#timer = null; }
    }
    onKeyDown() {
        if (overlay.wake()) return;
        streamDeck.system.openUrl(PAGE_URL); this.#poll();
    }
    async #poll() {
        try { this.#last = await readStatus(); }
        catch (e) { streamDeck.logger.warn(`status poll failed: ${e.message}`); this.#last = { level: "unknown", subtitle: "offline" }; }
        if (!overlay.isOn) for (const a of this.actions) this.#paint(a);
    }
    #paint(a) {
        try {
            a.setImage(`data:image/svg+xml;base64,${Buffer.from(keySvg(this.#last.level, this.#last.subtitle)).toString("base64")}`)
                ?.catch?.(() => {});
        } catch { /* context already gone */ }
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
/** Ko-fi — GitHub build only (Marketplace forbids sponsor links inside plugins; package.sh --kofi adds it). */
class Kofi extends SingletonAction {
    manifestId = `${PLUGIN}.kofi`;
    onWillAppear(ev) { overlay.register(ev.action, ev.payload.coordinates, () => { try { ev.action.setImage()?.catch?.(() => {}); } catch { /* gone */ } }); }
    onWillDisappear(ev) { overlay.unregister(ev.action.id); }
    onKeyDown() {
        if (overlay.wake()) return;
        streamDeck.system.openUrl("https://ko-fi.com/K3K6RR4LY");
    }
}

try { streamDeck.actions.registerAction(new Kofi()); } catch { /* plain (Marketplace) manifest has no Ko-fi action */ }
streamDeck.actions.registerAction(new Reply());
streamDeck.actions.registerAction(new Shortcut());
streamDeck.actions.registerAction(new ClaudeStatus());
streamDeck.actions.registerAction(new ClaudeUsage(`${PLUGIN}.usage`, overlay));
streamDeck.connect();
ensureHelper();
