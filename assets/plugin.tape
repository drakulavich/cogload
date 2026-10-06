# cognitive-load plugin screencast for the top of the README.
#
# Recorded against the synthetic fixture through scripts/demo-fixture.ts, never against
# real transcripts: the plugin runs `cogload` from PATH, and the sandbox's bin/cogload
# reads only the fixture. Claude Code itself runs under your own account, since a
# temporary HOME opens its first-run screen; the plugin's store goes to a throwaway
# directory so your rests and overrides are not touched, and your status line is
# switched off for the run.
#
# 1. Once: create /tmp/cogload-demo and trust it in Claude Code (run `claude` there and
#    answer yes), so the recording opens on the prompt, not on the trust question.
#
# 2. Record within five minutes of building the sandbox. Its live session's last action
#    is four minutes old, so the streak is past 40 minutes and the rest starts on the
#    first reading; ten minutes after the build the streak has ended.
#
#      DIR=$(bun scripts/demo-fixture.ts)
#      PATH="$DIR/bin:$PATH" CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d) vhs assets/plugin.tape
#
#    Nothing is sent to the model: the held prompt is dropped, the override line alone
#    only lifts the rest, and /cogload is the plugin's own command.
#
# 3. The WebP, budgets and ffmpeg steps are the same as in assets/demo.tape, with
#    plugin.mp4 and plugin.webp.

Output assets/plugin.mp4

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 50ms
Set Width 1500
Set Height 800
Set FontSize 22

Hide
Type `P="$PWD/plugin"; cd /tmp/cogload-demo && clear && claude --plugin-dir "$P" --settings '{"statusLine":{"type":"command","command":"true"}}'`
Enter
Sleep 10s
Show

# 1. the band: the level, and a rest that has just started
Sleep 3s

# 2. a prompt during the rest is held and goes back into the box
Type "add a retry to the fetch call"
Sleep 400ms
Enter
Sleep 4s

# 3. an override with a reason lifts the rest
Ctrl+U
Sleep 400ms
Type "override: prod is down, fixing it"
Sleep 400ms
Enter
Sleep 3500ms

# 4. what drives the hour, and the week's rests and overrides
Type "/cogload"
Sleep 800ms
Enter
Sleep 5s
