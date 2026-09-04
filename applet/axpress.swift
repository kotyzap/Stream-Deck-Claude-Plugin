// axpress — press a button in the Claude desktop app by its accessibility label.
// Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
//   axpress list                 print role | pressable | label for every labelled/pressable element
//   axpress press <label>...      press the most specific pressable element whose label contains any <label>
//
// The Claude/Cowork permission card renders its buttons in a web view: the visible text ("Allow once",
// "Deny") sits in child elements, not the button's own AXTitle. So we compute a label from descendant
// text, match case-insensitively by substring, and press the smallest match (falling back to a click).
import Cocoa
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func actions(_ el: AXUIElement) -> [String] {
    var v: CFArray?
    return AXUIElementCopyActionNames(el, &v) == .success ? (v as? [String] ?? []) : []
}
func norm(_ s: String) -> String {
    let low = s.lowercased().unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
    return String(low).split(separator: " ").joined(separator: " ")
}
// Descendant text (title/desc/value of this element and its children, depth-limited), for computing a label.
func labelText(_ el: AXUIElement, depth: Int = 5) -> String {
    var parts: [String] = []
    for a in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        if let s = attr(el, a) as? String, !s.isEmpty { parts.append(s) }
    }
    if depth > 0, let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
        for k in kids { let t = labelText(k, depth: depth - 1); if !t.isEmpty { parts.append(t) } }
    }
    return parts.joined(separator: " ")
}
func isPressable(_ el: AXUIElement) -> Bool {
    if (attr(el, kAXRoleAttribute) as? String) == kAXButtonRole { return true }
    return actions(el).contains(kAXPressAction as String)
}
func frameCenter(_ el: AXUIElement) -> CGPoint? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
    return CGPoint(x: pt.x + sz.width / 2, y: pt.y + sz.height / 2)
}
func clickAt(_ p: CGPoint) {
    let src = CGEventSource(stateID: .combinedSessionState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
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
if !AXIsProcessTrustedWithOptions(promptOpts) { print("not trusted: grant Accessibility to ClaudeDeck.app"); exit(5) }
let appEl = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)   // Electron builds AX on request

// Breadth-first over the whole tree.
var all: [AXUIElement] = []
var queue: [AXUIElement] = (attr(appEl, kAXWindowsAttribute) as? [AXUIElement]) ?? []
var i = 0
while i < queue.count {
    let el = queue[i]; i += 1
    all.append(el)
    if let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: kids) }
}

if cmd == "list" {
    print("elements: \(all.count)")
    for el in all {
        let role = (attr(el, kAXRoleAttribute) as? String) ?? "?"
        let title = (attr(el, kAXTitleAttribute) as? String) ?? ""
        let desc  = (attr(el, kAXDescriptionAttribute) as? String) ?? ""
        let own = [title, desc].filter { !$0.isEmpty }.joined(separator: " / ")
        let press = isPressable(el) ? "P" : " "
        if press == "P" {
            var deep = labelText(el); if deep.count > 80 { deep = String(deep.prefix(80)) + "…" }
            print("\(press) \(role) [\(own)] :: \(deep)")
        } else if !own.isEmpty { print("\(press) \(role) [\(own)]") }
    }
    exit(0)
}

// press: pick the most specific (shortest-label) pressable element whose label contains any wanted phrase.
let wanted = args.dropFirst().map { norm($0) }.filter { !$0.isEmpty }
var best: (el: AXUIElement, label: String)? = nil
for el in all where isPressable(el) {
    let label = norm(labelText(el))
    if label.isEmpty { continue }
    if wanted.contains(where: { label.contains($0) }) {
        if best == nil || label.count < best!.label.count { best = (el, label) }
    }
}
guard let hit = best else { print("not found: \(args.dropFirst().joined(separator: " | "))"); exit(3) }
if AXUIElementPerformAction(hit.el, kAXPressAction as CFString) == .success { print("pressed: \(hit.label)"); exit(0) }
if let c = frameCenter(hit.el) { clickAt(c); print("clicked: \(hit.label)"); exit(0) }
print("press failed: \(hit.label)"); exit(4)
