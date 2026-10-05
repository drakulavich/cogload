# cogload README screencast.
#
# Recorded against the synthetic fixture in tests/fixtures/busy-week, through
# scripts/demo-fixture.ts, and never against real transcripts. That is the rule, not a
# convenience: the recording is published, so every number in a frame must be the
# fixture's. scripts/demo-fixture.ts builds a throwaway directory whose bin/cogload runs
# this checkout with --projects pinned to the fixture, which is what makes that true.
#
# assets/demo.mp4 and assets/demo.webp are plain files in git, not LFS, so a clone needs
# nothing extra before touching either.
#
# 1. Record the mp4.
#
#      DIR=$(bun scripts/demo-fixture.ts)
#      PATH="$DIR/bin:$PATH" TZ=UTC vhs assets/demo.tape
#
#    Use vhs 0.11.0. Version 0.12.0 exits 0 and writes no file
#    (https://github.com/charmbracelet/vhs/issues/787). vhs drives a real terminal through
#    ttyd, so `brew install ttyd` first; without it vhs prints one line and leaves the old
#    file untouched. TZ=UTC is required: the fixture's timestamps are UTC and cogload
#    buckets by local time, so any other zone shifts the hours away from the samples
#    pasted in the README.
#
#    Record right after building the sandbox. The status step reads today: the sandbox
#    carries a session whose last action is four minutes old at build time, which is what
#    gives `cogload status` a live streak instead of a row of nulls, and it goes stale
#    within the hour. The sandbox is also where `status` writes its file, since the
#    wrapper sets HOME; the recording cannot touch the status line of whoever records it.
#
# 2. Build the animated WebP the README shows. This ffmpeg has no libwebp encoder, so
#    the frames go through the libwebp tools; -d 83 is the frame delay in ms at 12 fps.
#    img2webp reads frame options only before the frames they apply to, so -d has to sit
#    ahead of the glob; after it, img2webp warns and silently uses its 100 ms default.
#
#      FRAMES=$(mktemp -d)
#      ffmpeg -i assets/demo.mp4 -vf "fps=12" "$FRAMES/f%04d.png"
#      img2webp -loop 0 -lossy -q 80 -d 83 "$FRAMES"/f*.png -o assets/demo.webp
#
# 3. Budgets: the WebP under 2 MB, the mp4 under 4 MB, the recording under 30 seconds.
#    If the WebP comes out over budget, drop -q to 70 or the rate to fps=10 before you
#    shrink the canvas.
#
# FontSize is 22, which fits about 110 columns in a 1500-pixel frame. The widest thing
# the recording shows is the week grid, 98 columns and 100 with its hour header, so it
# has room to spare. Do not add --explain to the day command: that table is 133 columns
# and would wrap at this size. The README shows it as text instead. Never crop.
#
# Every command is preceded by Ctrl+L, so each one starts at the top of an empty frame
# instead of partway down a scrolling screen. It also keeps `head -c`, which cuts its
# output without a newline, from leaving the next prompt inside the JSON.

Output assets/demo.mp4

Set Shell "bash"
Set Theme "Catppuccin Mocha"
Set Padding 24
Set TypingSpeed 50ms
Set Width 1500
Set Height 800
Set FontSize 22

# 1. the hero: a week of hourly load as a heatmap
Ctrl+L
Sleep 500ms
Type "cogload --to 2026-09-20"
Sleep 300ms
Enter
Sleep 4s

# 2. one day, hour by hour
Ctrl+L
Sleep 500ms
Type "cogload 2026-09-14"
Sleep 300ms
Enter
Sleep 4s

# 3. the same data as JSON, which is what a pipe gets
Ctrl+L
Sleep 500ms
Type "cogload 2026-09-14 --json | head -c 400"
Sleep 300ms
Enter
Sleep 2500ms

# 4. the line a status line reads, from the sandbox's own today
Ctrl+L
Sleep 500ms
Type "cogload status"
Sleep 300ms
Enter
Sleep 3s

Sleep 800ms
