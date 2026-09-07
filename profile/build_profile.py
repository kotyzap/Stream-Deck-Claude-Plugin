#!/usr/bin/env python3
"""Build the Claude*.streamDeckProfile files (Stream Deck 7.x, v3 format).
One page per device — the usage chart is not a page, the plugin repaints these same keys after
IDLE_MS of no presses (see plugin/src/usage.js, IdleOverlay). Key art comes from the plugin.
Inspect is a diagnostic, not a daily control, so the 15-key layout spends that key on a Stats
tile instead; Inspect stays in the action list to drag on when Claude's UI changes.
Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
"""
import json, os, shutil, uuid, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")
PLUGIN = {"Name": "Deck for Claude", "UUID": "com.4xsdev.claude", "Version": "1.5.1.0"}


def A(aid, name, **settings):
    return dict(uuid=f"com.4xsdev.claude.{aid}", name=name, settings=settings)


# Stream Deck's own page-navigation actions. Metadata read from a profile the app itself wrote —
# built-ins carry the *parent* plugin UUID (com.elgato.streamdeck.page), not the action's.
PAGES_PLUGIN = {"Name": "Pages", "UUID": "com.elgato.streamdeck.page", "Version": "1.0"}
NEXT = dict(uuid="com.elgato.streamdeck.page.next", name="Next Page", settings={}, plugin=PAGES_PLUGIN)
PREV = dict(uuid="com.elgato.streamdeck.page.previous", name="Previous Page", settings={}, plugin=PAGES_PLUGIN)


def usage_rows(cols, rows=3):
    """One Usage key per cell. The action reads its own coordinates: each deck row becomes one
    limit and the row's width is the 0-100% scale, so the bar spans whichever keys are present."""
    return {f"{c},{r}": A("usage", "Claude Usage") for r in range(rows) for c in range(cols)}


# One layout per Stream Deck device type. Plugin manifest "Profiles" binds each to its DeviceType.
# Model codes: 20GAA9902 = Stream Deck MK.2 (15 keys), 20GAI9901 = Mini (6), 20GAT9901 = XL (32).
LAYOUTS = {
    "Claude": dict(model="20GAA9902", device_type=0, keys={
        "0,0": A("allow-once", "Allow once"),
        "1,0": A("allow-session", "Allow for session"),
        "2,0": A("always-allow", "Always allow"),
        "3,0": A("deny", "Deny"),
        "4,0": A("stop", "Stop"),
        "0,1": A("reply", "Reply", text="Continue"),
        "1,1": A("reply", "Reply", text="Yes"),
        "2,1": A("reply", "Reply", text="Fix it"),
        "3,1": A("reply", "Reply", text="Commit"),
        "4,1": A("status", "Claude Status"),
        "0,2": A("activate", "Activate Claude"),
        "1,2": A("shortcut", "Shortcut", shortcut="new-chat"),
        "2,2": A("shortcut", "Shortcut", shortcut="new-session"),
        "3,2": A("shortcut", "Shortcut", shortcut="search"),
        "4,2": A("usage", "Claude Usage"),   # alone on its row -> compact Stats tile
    }),
    "Claude Mini": dict(model="20GAI9901", device_type=1, keys={
        "0,0": A("allow-once", "Allow once"),
        "1,0": A("always-allow", "Always allow"),
        "2,0": A("deny", "Deny"),
        "0,1": A("stop", "Stop"),
        "1,1": A("reply", "Reply", text="Continue"),
        "2,1": A("status", "Claude Status"),
    }),
    "Claude XL": dict(model="20GAT9901", device_type=2, keys={
        "0,0": A("allow-once", "Allow once"),
        "1,0": A("allow-session", "Allow for session"),
        "2,0": A("always-allow", "Always allow"),
        "3,0": A("deny", "Deny"),
        "4,0": A("stop", "Stop"),
        "7,0": A("status", "Claude Status"),
        "0,1": A("reply", "Reply", text="Continue"),
        "1,1": A("reply", "Reply", text="Yes"),
        "2,1": A("reply", "Reply", text="Fix it"),
        "3,1": A("reply", "Reply", text="Commit"),
        "4,1": A("reply", "Reply", text="Go ahead"),
        "5,1": A("reply", "Reply", text="No"),
        "6,1": A("reply", "Reply", text="Try again"),
        "0,2": A("activate", "Activate Claude"),
        "1,2": A("shortcut", "Shortcut", shortcut="new-chat"),
        "2,2": A("shortcut", "Shortcut", shortcut="new-session"),
        "3,2": A("shortcut", "Shortcut", shortcut="search"),
        "4,2": A("shortcut", "Shortcut", shortcut="palette"),
        "5,2": A("shortcut", "Shortcut", shortcut="sidebar"),
        "6,2": A("shortcut", "Shortcut", shortcut="prev-session"),
        "7,2": A("shortcut", "Shortcut", shortcut="next-session"),
        "6,3": A("usage", "Claude Usage"),
        "7,3": A("inspect", "Inspect"),
    }),
}


def action(spec):
    base = {"ActionID": str(uuid.uuid4()), "LinkedTitle": True, "Resources": None, "State": 0,
            "Name": spec["name"], "UUID": spec["uuid"], "Settings": spec["settings"]}
    if "plugin" in spec:      # a Stream Deck built-in — the app writes States as [{}]
        return {**base, "Plugin": spec["plugin"], "States": [{}]}
    return {**base, "Plugin": PLUGIN,
            "States": [{"FontFamily": "", "FontSize": 12, "FontStyle": "", "FontUnderline": False,
                        "OutlineThickness": 2, "ShowTitle": False,
                        "TitleAlignment": "middle", "TitleColor": "#ffffff"}]}


def build(name, layout):
    shutil.rmtree(OUT, ignore_errors=True)
    prof_uuid = str(uuid.uuid4()).upper()
    root = os.path.join(OUT, f"{prof_uuid}.sdProfile")
    os.makedirs(os.path.join(root, "Images"))

    pages = [layout["keys"]] + ([layout["page2"]] if layout.get("page2") else [])
    page_uuids = []
    for keys in pages:
        page_uuid = str(uuid.uuid4()).upper()
        page_uuids.append(page_uuid)
        page = os.path.join(root, "Profiles", page_uuid)
        os.makedirs(os.path.join(page, "Images"))
        actions = {pos: action(spec) for pos, spec in keys.items()}
        json.dump({"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""},
                  open(os.path.join(page, "manifest.json"), "w"), indent=2)

    lower = [p.lower() for p in page_uuids]
    json.dump({"Device": {"Model": layout["model"], "UUID": ""},   # empty UUID = any device of this model
               "Name": name,
               "Pages": {"Current": lower[0], "Default": lower[0], "Pages": lower},
               "Version": "3.0"},
              open(os.path.join(root, "manifest.json"), "w"), indent=2)

    zpath = os.path.join(HERE, f"{name}.streamDeckProfile")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, fs in os.walk(root):
            for f in fs:
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, OUT))
    print("wrote", zpath, f"({len(pages)} pages)")


def main():
    for name, layout in LAYOUTS.items():
        build(name, layout)
    shutil.rmtree(OUT, ignore_errors=True)


if __name__ == "__main__":
    main()
