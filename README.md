# 📎 Clippy — your AI desktop assistant

A nostalgic, walking **Clippy** for your Mac that is actually useful. It wanders along
the edges of your screen, you chat with it, and it's powered by **Claude** through your
own local [Claude Code](https://docs.claude.com/en/docs/claude-code) login.

Clippy can:

- 💬 **Chat** with Claude in a small, always-on-top bubble (with conversation memory).
- 📊 Track your **token usage** over rolling 5‑hour and 7‑day windows.
- 📎 **Read files & images** you attach or drop onto it.
- 👁️ **Look at your screen** and answer questions about what you're doing.
- 🧠 **Analyze & act**: it can read your open Excel/CSV/Word files (it finds them itself),
  run Python to compare them, and search the web.
- 🌐 **Drive a real browser** (a visible Chrome window) to do web tasks for you —
  navigate, scrape data into a spreadsheet, download files — while you watch.
- 🎛️ **Pick the model** (Opus / Sonnet / Haiku) from the UI; every answer shows which
  model produced it.
- 👀 Eyes that follow your mouse, blinking, curious head‑tilts, and a "done thinking"
  bubble when an answer is ready while the chat is closed.

> The UI text is currently in **Dutch** — easy to translate in `renderer/index.html`.

---

## 🔒 Privacy & how auth works (read this)

**Clippy contains no credentials and no API keys.** It talks to Claude by shelling out to
the `claude` command‑line tool that you install and log into yourself. That means:

- **Every user logs into their own Claude account.** Nothing about anyone else's account
  is bundled or shared.
- Your conversations go to Anthropic via *your* Claude Code session, exactly like using
  Claude Code in a terminal. They do not pass through any third‑party server.
- Local usage data (token counts, your chosen budgets, the current session id) is stored
  only on your machine and is **git‑ignored** so it never ends up in the repo.

---

## ✅ Requirements

- **macOS** (Apple Silicon or Intel).
- **Node.js 18+** (`node -v`).
- **Claude Code** installed and **logged into your own account** (see first‑time setup
  below). Verify with `claude --version`.
- **Google Chrome** — only needed for the browser‑task feature.
- **Python 3** with `openpyxl` and `pandas` — only needed for spreadsheet analysis
  (`pip3 install openpyxl pandas`).

## 🔑 First‑time setup: log into Claude (do this once)

Clippy has **no login screen** and ships with **no credentials**. It uses *your own* Claude
Code session. Set it up once:

1. Install Claude Code: https://docs.claude.com/en/docs/claude-code
2. Log into **your own** Claude account:
   ```bash
   claude          # first run opens a browser to sign in
   # (or, with a Claude subscription:)
   claude setup-token
   ```
3. Verify it works:
   ```bash
   claude -p "hi"
   ```

Once `claude` works in your terminal, Clippy will use that login automatically. Every user
authenticates with their **own** account — nothing about anyone else's login is included
in this repository.

## 🚀 Run it

```bash
git clone <your-fork-url> clippy
cd clippy
npm install
npm start
```

Clippy appears near the bottom‑right of your screen. **Click** it to chat, **drag** it to
move it, and use the **pin** button to keep it in place.

## 📦 Build a double‑clickable app (macOS)

- `npm run build` → builds the app into `dist/Clippy-darwin-<arch>/Clippy.app`.
- **Double‑click `Rebuild app.command`** (recommended on macOS) → builds, ad‑hoc signs,
  and places a ready `Clippy.app` in the project folder.

Move `Clippy.app` to `/Applications` or make an alias wherever you like.

> Note: rebuilding changes the app's signature, so macOS will ask you to re‑grant
> **Screen Recording** permission for the screen‑look feature after each rebuild.

## 🔐 Permissions

- **Screen Recording** (System Settings → Privacy & Security → Screen Recording): required
  only for the 👁️ "look at my screen" feature. Chat, file analysis, web and browser tasks
  do **not** need it.

---

## 🧰 Agent capabilities & safety

Clippy runs Claude with tools enabled so it can genuinely help:

- File analysis uses `Read` + `Bash` (Python) and can read files in your home folder.
- Web access uses `WebSearch` / `WebFetch`.
- Browser tasks use a visible Chrome via the
  [Playwright MCP](https://github.com/microsoft/playwright-mcp), with its **own browser
  profile** (`browser-profile/`, git‑ignored) so your logins persist. You log in yourself
  in that window — **Clippy never types passwords**.

Built‑in guardrails (system prompt): Clippy will **not** modify or delete your files unless
you explicitly ask, and will **not** perform irreversible or financial actions (send, pay,
delete, order) in the browser without explicit instruction.

**⚠️ This is still a powerful agent that can run shell commands and control a browser on
your machine. Review the code, and use it on tasks and machines you trust.**

---

## 🗂️ Project structure

| File | Purpose |
|---|---|
| `main.js` | Electron main process: window, wandering, screenshots, Claude calls, IPC |
| `preload.js` | Safe bridge between the UI and the main process |
| `renderer/index.html` | The whole UI + the drawn SVG Clippy + behavior |
| `package.json` | Dependencies and scripts |
| `Rebuild app.command` | Double‑click helper to (re)build `Clippy.app` on macOS |

## 📄 License

MIT — see [LICENSE](LICENSE). Made by **stelloc**. Have fun, and make your own Clippy agent. 📎
