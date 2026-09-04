// axpress — press a button in the Claude desktop app by its accessibility label.
// Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
//   axpress list                    print [title] description of every button
//   axpress press <label> [...]     press the first button whose title or description matches (case-insensitive)
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first, cmd == "list" || cmd == "press" else {
    print("usage: axpress list | press <label>..."); exit(2)
}
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.anthropic.claudefordesktop").first
    ?? NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "Claude" }) else {
    print("Claude is not running"); exit(1)
}
let promptOpts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(promptOpts) {   // shows the system "allow control" dialog when not yet granted
    print("not trusted: grant Accessibility to ClaudeDeck.app"); exit(5)
}
let appEl = AXUIElementCreateApplication(app.processIdentifier)
// Electron builds its accessibility tree only on request.
AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)

let wanted = Set(args.dropFirst().map { $0.lowercased() })
var queue: [AXUIElement] = (attr(appEl, kAXWindowsAttribute) as? [AXUIElement]) ?? []
if cmd == "list" { print("windows: \(queue.count)") }
var i = 0
while i < queue.count {
    let el = queue[i]; i += 1
    if (attr(el, kAXRoleAttribute) as? String) == kAXButtonRole {
        let title = (attr(el, kAXTitleAttribute) as? String) ?? ""
        let desc  = (attr(el, kAXDescriptionAttribute) as? String) ?? ""
        if cmd == "list" {
            print("[\(title)] \(desc)")
        } else if wanted.contains(title.lowercased()) || wanted.contains(desc.lowercased()) {
            let r = AXUIElementPerformAction(el, kAXPressAction as CFString)
            print(r == .success ? "pressed: \(title.isEmpty ? desc : title)" : "press failed (\(r.rawValue))")
            exit(r == .success ? 0 : 4)
        }
    }
    if let children = attr(el, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children) }
}
if cmd == "press" { print("not found: \(args.dropFirst().joined(separator: " | "))"); exit(3) }
