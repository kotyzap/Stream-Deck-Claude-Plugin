#!/usr/bin/env python3
"""Build Claude.streamDeckProfile (Stream Deck 7.x, v3 format) for a 15-key MK.2.
Every key is an action from the com.4xsdev.claude plugin; key art comes from the plugin.
Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
"""
import json, os, shutil, uuid, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")
PLUGIN = {"Name": "ClaudeDeck", "UUID": "com.4xsdev.claude", "Version": "1.3.0.0"}


def A(aid, name, **settings):
    return dict(uuid=f"com.4xsdev.claude.{aid}", name=name, settings=settings)


# One layout per Stream Deck device type. Plugin manifest "Profiles" binds each to its DeviceType.
# Model codes: 20GAA9902 = Stream Deck MK.2 (15 keys), 20GAI9901 = Mini (6), 20GAT9901 = XL (32).
LAYOUTS = {
    "Claude": dict(model="20GAA9902", device_type=0, keys={
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
    }),
    "Claude Mini": dict(model="20GAI9901", device_type=1, keys={
        "0,0": A("allow-once", "Allow once"),
        "1,0": A("always-allow", "Always allow"),
        "2,0": A("deny", "Deny"),
        "0,1": A("stop", "Stop"),
        "1,1": A("reply", "Reply", text="continue"),
        "2,1": A("status", "Claude Status"),
    }),
    "Claude XL": dict(model="20GAT9901", device_type=2, keys={
        "0,0": A("allow-once", "Allow once"),
        "1,0": A("allow-session", "Allow for session"),
        "2,0": A("always-allow", "Always allow"),
        "3,0": A("deny", "Deny"),
        "4,0": A("stop", "Stop"),
        "7,0": A("status", "Claude Status"),
        "0,1": A("reply", "Reply", text="continue"),
        "1,1": A("reply", "Reply", text="yes"),
        "2,1": A("reply", "Reply", text="fix it"),
        "3,1": A("reply", "Reply", text="commit"),
        "4,1": A("reply", "Reply", text="go ahead"),
        "5,1": A("reply", "Reply", text="no"),
        "6,1": A("reply", "Reply", text="try again"),
        "0,2": A("activate", "Activate Claude"),
        "1,2": A("shortcut", "Shortcut", shortcut="new-chat"),
        "2,2": A("shortcut", "Shortcut", shortcut="new-session"),
        "3,2": A("shortcut", "Shortcut", shortcut="search"),
        "4,2": A("shortcut", "Shortcut", shortcut="palette"),
        "5,2": A("shortcut", "Shortcut", shortcut="sidebar"),
        "6,2": A("shortcut", "Shortcut", shortcut="prev-session"),
        "7,2": A("shortcut", "Shortcut", shortcut="next-session"),
        "7,3": A("inspect", "Inspect"),
    }),
}


def action(spec):
    return {"ActionID": str(uuid.uuid4()), "LinkedTitle": True, "Resources": None, "State": 0,
            "Name": spec["name"], "UUID": spec["uuid"], "Plugin": PLUGIN, "Settings": spec["settings"],
            "States": [{"FontFamily": "", "FontSize": 12, "FontStyle": "", "FontUnderline": False,
                        "OutlineThickness": 2, "ShowTitle": False,
                        "TitleAlignment": "middle", "TitleColor": "#ffffff"}]}


def build(name, layout):
    shutil.rmtree(OUT, ignore_errors=True)
    prof_uuid = str(uuid.uuid4()).upper()
    page_uuid = str(uuid.uuid4()).upper()
    root = os.path.join(OUT, f"{prof_uuid}.sdProfile")
    page = os.path.join(root, "Profiles", page_uuid)
    os.makedirs(os.path.join(page, "Images"))
    os.makedirs(os.path.join(root, "Images"))

    actions = {pos: action(spec) for pos, spec in layout["keys"].items()}
    json.dump({"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""},
              open(os.path.join(page, "manifest.json"), "w"), indent=2)
    json.dump({"Device": {"Model": layout["model"], "UUID": ""},   # empty UUID = any device of this model
               "Name": name,
               "Pages": {"Current": page_uuid.lower(), "Default": page_uuid.lower(), "Pages": [page_uuid.lower()]},
               "Version": "3.0"},
              open(os.path.join(root, "manifest.json"), "w"), indent=2)

    zpath = os.path.join(HERE, f"{name}.streamDeckProfile")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, fs in os.walk(root):
            for f in fs:
                full = os.path.join(dp, f)
                z.write(full, os.path.relpath(full, OUT))
    print("wrote", zpath)


def main():
    for name, layout in LAYOUTS.items():
        build(name, layout)
    shutil.rmtree(OUT, ignore_errors=True)


if __name__ == "__main__":
    main()
