#!/usr/bin/env python3
"""Build Claude.streamDeckProfile (Stream Deck 7.x, v3 format) for a 15-key MK.2.
Every key is an action from the com.4xsdev.claude plugin; key art comes from the plugin.
Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
"""
import json, os, shutil, uuid, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")
PLUGIN = {"Name": "ClaudeDeck", "UUID": "com.4xsdev.claude", "Version": "1.2.1.0"}


def A(aid, name, **settings):
    return dict(uuid=f"com.4xsdev.claude.{aid}", name=name, settings=settings)


# "col,row" → action. Drag more from the "Claude" group in the Stream Deck app.
KEYS = {
    "0,0": A("allow-once", "Allow once"),
    "1,0": A("allow-session", "Allow for session"),
    "2,0": A("always-allow", "Always allow"),
    "3,0": A("deny", "Deny"),
    "4,0": A("stop", "Stop"),
    "0,1": A("reply", "Reply", text="continue"),
    "1,1": A("reply", "Reply", text="yes"),
    "2,1": A("reply", "Reply", text="fix it"),
    "3,1": A("reply", "Reply", text="commit"),
    "4,1": A("status", "Claude Status"),
    "0,2": A("activate", "Activate Claude"),
    "1,2": A("shortcut", "Shortcut", shortcut="new-chat"),
    "2,2": A("shortcut", "Shortcut", shortcut="new-session"),
    "3,2": A("shortcut", "Shortcut", shortcut="search"),
    "4,2": A("inspect", "Inspect"),
}


def action(spec):
    return {"ActionID": str(uuid.uuid4()), "LinkedTitle": True, "Resources": None, "State": 0,
            "Name": spec["name"], "UUID": spec["uuid"], "Plugin": PLUGIN, "Settings": spec["settings"],
            "States": [{"FontFamily": "", "FontSize": 12, "FontStyle": "", "FontUnderline": False,
                        "OutlineThickness": 2, "ShowTitle": False,
                        "TitleAlignment": "middle", "TitleColor": "#ffffff"}]}


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    prof_uuid = str(uuid.uuid4()).upper()
    page_uuid = str(uuid.uuid4()).upper()
    root = os.path.join(OUT, f"{prof_uuid}.sdProfile")
    page = os.path.join(root, "Profiles", page_uuid)
    os.makedirs(os.path.join(page, "Images"))
    os.makedirs(os.path.join(root, "Images"))

    actions = {pos: action(spec) for pos, spec in KEYS.items()}
    json.dump({"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""},
              open(os.path.join(page, "manifest.json"), "w"), indent=2)
    json.dump({"Device": {"Model": "20GAA9902", "UUID": ""},   # MK.2; empty UUID = any MK.2
               "Name": "Claude",
               "Pages": {"Current": page_uuid.lower(), "Default": page_uuid.lower(), "Pages": [page_uuid.lower()]},
               "Version": "3.0"},
              open(os.path.join(root, "manifest.json"), "w"), indent=2)

    zpath = os.path.join(HERE, "Claude.streamDeckProfile")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, fs in os.walk(root):
            for f in fs:
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, OUT))
    print("wrote", zpath)


if __name__ == "__main__":
    main()
