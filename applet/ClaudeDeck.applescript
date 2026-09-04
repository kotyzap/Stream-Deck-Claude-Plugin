-- ClaudeDeck — Stream Deck helper for the Claude desktop app
-- Pavel Kotyza <kotyza@gmail.com> — https://www.4xs.dev
--
-- URL scheme:  claudedeck://<command>[/<argument>]
--   allow-once | allow-session | always-allow | deny   press the matching permission button (Accessibility API)
--   stop                                              activate Claude, press Esc
--   type/<percent-encoded text>                        activate Claude, type text, press Return
--   hotkey/<mods+key>  e.g. hotkey/cmd+shift+o         activate Claude, send the key combo
--   activate                                          bring Claude to front
--   inspect                                           log every button label in Claude's windows to ~/Library/Logs/ClaudeDeck.log

property logFile : (POSIX path of (path to library folder from user domain)) & "Logs/ClaudeDeck.log"

-- Candidate labels, tried in order. Update here if Anthropic renames a button (use claudedeck://inspect to see current ones).
property labelsAllowOnce : {"Allow once", "Allow Once", "Allow"}
property labelsAllowSession : {"Allow for session", "Allow for this session", "Allow for chat", "Allow for this chat"}
property labelsAlwaysAllow : {"Always allow", "Allow always", "Always Allow", "Allow Always"}
property labelsDeny : {"Deny", "Don't allow", "Don’t allow", "Decline", "Reject"}

on run
	logMsg("run without URL — nothing to do")
end run

on open location theURL
	try
		set cmd to text ((offset of "://" in theURL) + 3) thru -1 of theURL
		if cmd ends with "/" then set cmd to text 1 thru -2 of cmd
		set arg to ""
		if cmd contains "/" then
			set slashPos to offset of "/" in cmd
			set arg to text (slashPos + 1) thru -1 of cmd
			set cmd to text 1 thru (slashPos - 1) of cmd
		end if
		logMsg("cmd=" & cmd & " arg=" & arg)
		if cmd is "allow-once" then
			pressFirst(labelsAllowOnce)
		else if cmd is "allow-session" then
			pressFirst(labelsAllowSession)
		else if cmd is "always-allow" then
			pressFirst(labelsAlwaysAllow)
		else if cmd is "deny" then
			pressFirst(labelsDeny)
		else if cmd is "stop" then
			activateClaude()
			tell application "System Events" to key code 53 -- Esc
		else if cmd is "type" then
			activateClaude()
			tell application "System Events"
				keystroke my urlDecode(arg)
				delay 0.15
				key code 36 -- Return
			end tell
		else if cmd is "hotkey" then
			activateClaude()
			sendHotkey(arg)
		else if cmd is "activate" then
			activateClaude()
		else if cmd is "inspect" then
			inspectButtons()
		else
			logMsg("unknown command")
		end if
	on error errMsg number errNum
		logMsg("ERROR " & errNum & ": " & errMsg)
		if errNum is -25211 or errMsg contains "assistive" or errMsg contains "not trusted" then
			display notification "Grant ClaudeDeck access in System Settings → Privacy & Security → Accessibility" with title "ClaudeDeck"
		end if
	end try
end open location

on activateClaude()
	tell application "Claude" to activate
	delay 0.25
end activateClaude

on sendHotkey(spec)
	-- spec: "cmd+shift+o" — modifiers: cmd, shift, option/alt, ctrl; key: single character or "esc"/"return"/"tab"
	set AppleScript's text item delimiters to "+"
	set parts to text items of spec
	set AppleScript's text item delimiters to ""
	set mods to {}
	set theKey to ""
	repeat with p in parts
		set p to (p as text)
		if p is "cmd" or p is "command" then
			set end of mods to command down
		else if p is "shift" then
			set end of mods to shift down
		else if p is "option" or p is "alt" then
			set end of mods to option down
		else if p is "ctrl" or p is "control" then
			set end of mods to control down
		else
			set theKey to p
		end if
	end repeat
	tell application "System Events"
		if theKey is "esc" then
			key code 53 using mods
		else if theKey is "return" or theKey is "enter" then
			key code 36 using mods
		else if theKey is "tab" then
			key code 48 using mods
		else
			keystroke theKey using mods
		end if
	end tell
end sendHotkey

on axpress(argList)
	set bin to quoted form of ((POSIX path of (path to me)) & "Contents/MacOS/axpress")
	set cmdLine to bin
	repeat with a in argList
		set cmdLine to cmdLine & " " & quoted form of (a as text)
	end repeat
	return do shell script cmdLine
end axpress

on pressFirst(labelList)
	try
		set res to axpress({"press"} & labelList)
		logMsg(res)
	on error errMsg number errNum
		logMsg("axpress error " & errNum & ": " & errMsg)
		if errNum is 3 then
			display notification "No \"" & (item 1 of labelList) & "\" button visible" with title "ClaudeDeck"
		else
			error errMsg number errNum
		end if
	end try
end pressFirst

on inspectButtons()
	logMsg("INSPECT")
	set bin to quoted form of ((POSIX path of (path to me)) & "Contents/MacOS/axpress")
	do shell script bin & " list >> " & quoted form of logFile & " 2>&1"
	display notification "Button labels written to ~/Library/Logs/ClaudeDeck.log" with title "ClaudeDeck"
end inspectButtons

on urlDecode(s)
	-- minimal %XX decoder (ASCII); '+' -> space
	set AppleScript's text item delimiters to "+"
	set parts to text items of s
	set AppleScript's text item delimiters to " "
	set s to parts as text
	set AppleScript's text item delimiters to ""
	set out to ""
	set i to 1
	set n to length of s
	repeat while i ≤ n
		set c to character i of s
		if c is "%" and i + 2 ≤ n then
			set hexStr to text (i + 1) thru (i + 2) of s
			set out to out & (character id (my hexToInt(hexStr)))
			set i to i + 3
		else
			set out to out & c
			set i to i + 1
		end if
	end repeat
	return out
end urlDecode

on hexToInt(h)
	set digits to "0123456789abcdef"
	set h to do shell script "echo " & quoted form of h & " | tr A-F a-f"
	return ((offset of (character 1 of h) in digits) - 1) * 16 + ((offset of (character 2 of h) in digits) - 1)
end hexToInt

on logMsg(m)
	try
		do shell script "printf '%s %s\\n' \"$(date '+%F %T')\" " & quoted form of m & " >> " & quoted form of logFile
	end try
end logMsg
