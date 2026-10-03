# 📸 Show & Tell

Shows you the pictures: a thumbnail the moment you paste a screenshot, and a gallery of every image in the session.

```
/plugin install show-and-tell@lorcan-plugins
```

## How it works

- **Pastes show as you paste.** Press `ctrl+v` with an image on the clipboard and its thumbnail appears above the
  prompt within a quarter of a second, before you send anything. Show & Tell watches the draft for Claude Code's
  `[Image #1]` and copies the image Claude Code saved for it. If that copy isn't where it expects, it reads the
  clipboard itself (`osascript` on macOS, `wl-paste` or `xclip` on Linux, PowerShell on Windows). If that fails
  too, it keeps the image when you send the prompt instead.
- **Claude's pictures show too.** An image Claude reads with Read, a screenshot a browser or MCP tool returns, a
  picture Claude writes or edits, and one a shell command makes in the working directory or a folder just inside
  it (`playwright screenshot`, a chart script) are all added the same way.
- **The band** above the prompt shows the newest thumbnails with Gallery and Dismiss. A paste's thumbnail goes
  when you send it; the rest go after 20 seconds (`/config` changes that).

## The gallery

Click `📸 4` in the status row, or run `/gallery`: every image this session, newest first, with a large preview
of the one you pick. `a`, `y` and `c` show all of them, yours or Claude's. `o` opens the image in your viewer, `i`
puts `@path` in your prompt so Claude can look at it again, `p` copies the path and `f` shows it in its folder.
Tab walks the list.

## Which terminals show pictures

Pictures draw where the terminal speaks the kitty graphics protocol: Ghostty and kitty. In other terminals, in
tmux and in the desktop app the same band and gallery show in words (`📎 Pasted image #1 · 200×120`), and the
buttons all still work.

A thumbnail has to be a PNG. Other formats are converted once: `sips` on macOS, ImageMagick (`magick` or
`convert`) elsewhere, and on macOS `qlmanage` renders SVG and PDF. Without a converter the image is listed
without a picture.

## In the background

No model calls. Pasted images and images that only exist in a tool's result are copied to
`~/.claude/show-and-tell/<session>/`, beside a `manifest.json` that brings the gallery back after `/resume`. Files
Claude read or made stay where they are. Copies older than seven days are removed when a session starts. That
needs `find`, so on Windows they stay until you delete them.

The draft is checked four times a second while a session is open; that is a read of the prompt box, with nothing
run unless a new `[Image #N]` appears. The place Claude Code saves pastes (`/tmp/claude-<uid>/…/images/`) isn't
part of the plugin API, so a future Claude Code may move it; the clipboard is the fallback when it does.
