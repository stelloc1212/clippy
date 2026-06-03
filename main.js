const { app, BrowserWindow, ipcMain, screen, desktopCapturer, systemPreferences, shell, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win;
const APP_DIR = path.join(os.homedir(), 'ClippyClaude');
// data (token-boekhouding, budget, sessie) op het bureaublad
const DATA_DIR = path.join(os.homedir(), 'Desktop', 'Clippy Data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const STATE_FILE = path.join(DATA_DIR, 'clippy-data.json');
// eenmalige migratie van oude locatie
try {
  const old = path.join(APP_DIR, 'state.json');
  if (fs.existsSync(old) && !fs.existsSync(STATE_FILE)) fs.copyFileSync(old, STATE_FILE);
} catch {}

const COLLAPSED = { w: 140, h: 180 };
const EXPANDED = { w: 340, h: 600 };

// ---------- persistente staat ----------
const DEFAULT_STATE = {
  usedTokens: 0,
  usedCostUsd: 0,
  budgetTokens: 10000000,
  sessionId: null,
  messages: 0,
  pinned: false,
  model: '',                  // '' = accountstandaard; anders 'opus' / 'sonnet' / 'haiku'
  events: [],                 // [{ t, tokens, cost }] voor rollende vensters
  budget5h: 2000000,          // tokenlimiet voor het 5-uurs venster
  budgetWeek: 10000000        // tokenlimiet voor het 7-daagse venster
};
const HOUR = 3600 * 1000, FIVE_H = 5 * HOUR, WEEK = 7 * 24 * HOUR;
function loadState() {
  try { return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_STATE }; }
}
function saveState(s) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {} }
let state = loadState();

function claudeBin() {
  const guess = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(guess) ? guess : 'claude';
}

// volledige login-PATH ophalen zodat node/npx/python vindbaar zijn vanuit de app
let LOGIN_PATH = '';
try { LOGIN_PATH = execSync('/bin/zsh -lc "echo -n $PATH"', { timeout: 5000 }).toString().trim(); } catch {}

// ---------- browser-automatisering (Playwright via MCP) ----------
const PW_PROFILE = path.join(APP_DIR, 'browser-profile');   // eigen profiel = login blijft bewaard
const PW_CONFIG = path.join(APP_DIR, 'mcp-playwright.json');
(function ensurePwConfig() {
  const cfg = { mcpServers: { playwright: { command: 'npx',
    args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome', '--user-data-dir', PW_PROFILE] } } };
  try { fs.writeFileSync(PW_CONFIG, JSON.stringify(cfg, null, 2)); } catch {}
})();
const BROWSER_GUARD = "Je bestuurt een zichtbaar browservenster om een taak voor de gebruiker uit te voeren. " +
  "Werk zelfstandig, stap voor stap. Vul NOOIT wachtwoorden of inloggegevens in — als inloggen nodig is, " +
  "vraag de gebruiker om dat zelf in het browservenster te doen en wacht daarop. " +
  "Voer GEEN onomkeerbare of financiële acties uit (definitief verzenden, betalen, verwijderen, bestellen) " +
  "zonder expliciete opdracht; vraag bij twijfel eerst. Navigeren, lezen en downloaden mag. " +
  "Je mag gegevens die je op de website uitleest met je Bash-gereedschap (python/openpyxl/pandas) wegschrijven naar een NIEUW Excel- of CSV-bestand " +
  "(standaard in de map Downloads, tenzij anders gevraagd). Je werkt dus ook als scraper: data verzamelen en netjes in een bestand zetten. " +
  "Antwoord in het Nederlands en vat aan het eind kort samen wat je hebt gedaan en waar het bestand staat.";

// ---------- venster ----------
let mode = 'collapsed';
let chatOpen = false;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: COLLAPSED.w,
    height: COLLAPSED.h,
    x: workArea.x + workArea.width - COLLAPSED.w - 40,
    y: workArea.y + workArea.height - COLLAPSED.h - 40,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  startWander();

  // cursorpositie doorsturen zodat Clippy met zijn ogen meekijkt
  setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.webContents.send('clippy:gaze', { x: p.x - b.x, y: p.y - b.y });
  }, 60);
}

function clampToScreen(x, y, w, h) {
  const { workArea } = screen.getPrimaryDisplay();
  const nx = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - w));
  const ny = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - h));
  return { x: nx, y: ny };
}

// klap chatvenster open/dicht, met Clippy's onderkant als ankerpunt
function setExpanded(expand) {
  if (!win) return;
  const b = win.getBounds();
  const anchorX = b.x + b.width / 2;     // midden
  const anchorBottom = b.y + b.height;   // onderkant
  const size = expand ? EXPANDED : COLLAPSED;
  let nx = Math.round(anchorX - size.w / 2);
  let ny = Math.round(anchorBottom - size.h);
  const c = clampToScreen(nx, ny, size.w, size.h);
  win.setBounds({ x: c.x, y: c.y, width: size.w, height: size.h });
  mode = expand ? 'expanded' : 'collapsed';
}

// ---------- rondlopen ----------
let stepTimer = null, restTimer = null, target = null;
function canWander() { return win && !state.pinned && mode === 'collapsed' && !chatOpen && !dragging; }
function pickTarget() {
  const { workArea } = screen.getPrimaryDisplay();
  const minX = workArea.x;
  const maxX = workArea.x + Math.max(1, workArea.width - COLLAPSED.w);
  const maxY = workArea.y + Math.max(1, workArea.height - COLLAPSED.h);
  const midY = (workArea.y + maxY) / 2;
  const cur = win ? win.getBounds() : { x: minX, y: maxY };
  const clampX = (x) => Math.max(minX, Math.min(maxX, x));
  const r = Math.random();
  let x, y;
  if (r < 0.6) {
    // klein stapje langs de onderrand, dicht bij waar hij nu staat (rustig)
    x = clampX(cur.x + (Math.random() * 2 - 1) * 260);
    y = maxY;
  } else if (r < 0.78) {
    // af en toe een oversteek: ergens anders langs de onderrand
    x = minX + Math.floor(Math.random() * (maxX - minX));
    y = maxY;
  } else if (r < 0.89) {
    x = minX; y = Math.floor(midY + Math.random() * (maxY - midY)); // linkerrand
  } else {
    x = maxX; y = Math.floor(midY + Math.random() * (maxY - midY)); // rechterrand
  }
  target = { x: Math.round(x), y };
}
function startWander() {
  pickTarget();
  stepTimer = setInterval(() => {
    if (!canWander() || !target) return;
    const b = win.getBounds();
    const dx = target.x - b.x, dy = target.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      win.webContents.send('clippy:walking', false);
      if (!restTimer) {
        // langere, rustige pauzes tussen verplaatsingen
        restTimer = setTimeout(() => { restTimer = null; pickTarget(); }, 5000 + Math.random() * 11000);
      }
      return;
    }
    const speed = 1.3; // rustiger looptempo
    const nx = Math.round(b.x + (dx / dist) * Math.min(speed, dist));
    const ny = Math.round(b.y + (dy / dist) * Math.min(speed, dist));
    win.setBounds({ x: nx, y: ny, width: b.width, height: b.height });
    win.webContents.send('clippy:walking', true);
    win.webContents.send('clippy:facing', dx >= 0 ? 1 : -1);
  }, 16);
}

// ---------- slepen ----------
let dragging = false, dragOffset = { x: 0, y: 0 }, dragTimer = null;
function startDrag(off) {
  dragging = true;
  dragOffset = off;
  if (win) win.webContents.send('clippy:walking', false);
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || !dragging) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    win.setBounds({ x: Math.round(p.x - dragOffset.x), y: Math.round(p.y - dragOffset.y), width: b.width, height: b.height });
  }, 10);
}
function endDrag() {
  dragging = false;
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
}

// ---------- schermafbeelding (kijk mee) via macOS screencapture ----------
// Dit triggert de Schermopname-toestemming betrouwbaar en zet "Clippy" in de lijst.
function captureScreen() {
  return new Promise((resolve) => {
    const out = path.join(APP_DIR, 'screen.png');
    try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch {}
    const wasVisible = win && win.isVisible();
    if (win) win.hide(); // Clippy even weg zodat hij niet op de foto staat
    setTimeout(() => {
      const cap = spawn('/usr/sbin/screencapture', ['-x', out]);
      const done = () => {
        if (win && wasVisible) win.show();
        try { if (fs.existsSync(out) && fs.statSync(out).size > 1000) return resolve(out); } catch {}
        resolve(null); // leeg/zwart of mislukt -> geen toegang
      };
      cap.on('close', done);
      cap.on('error', () => { if (win && wasVisible) win.show(); resolve(null); });
    }, 250);
  });
}

// ---------- welke documenten staan er open? (zodat Clippy ze zelf kan vinden) ----------
function getOpenDocuments() {
  try {
    const cmd = "/usr/sbin/lsof -c 'Microsoft Excel' -c 'Microsoft Word' -c 'Microsoft PowerPoint' -c Numbers -c Pages -c Preview -c Keynote -Fn 2>/dev/null " +
      "| grep -iE '\\.(xlsx|xlsm|xls|csv|docx|doc|pptx|key|numbers|pages|pdf)$' | sed 's/^n//' | sort -u";
    const out = execSync(cmd, { shell: '/bin/zsh', timeout: 5000 }).toString();
    return out.split('\n').map(s => s.trim())
      .filter(Boolean)
      .filter(p => !/\/~\$/.test(p) && !p.includes('/.~lock'));
  } catch { return []; }
}

// ---------- chat via claude CLI ----------
const AGENT_TOOLS = ['Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const GUARD = "Je bent Clippy, een behulpzame assistent op de Mac van de gebruiker. " +
  "Je mag bestanden lezen en analyseren en daarvoor shell-commando's uitvoeren (bijv. python met openpyxl/pandas om Excel-tabbladen te lezen en te vergelijken). " +
  "Je mag het web opzoeken (WebSearch/WebFetch) wanneer actuele of externe informatie nodig is. " +
  "Wijzig, overschrijf of verwijder NOOIT bestanden van de gebruiker, tenzij daar in dit bericht expliciet om wordt gevraagd. " +
  "Werk zelfstandig: als paden van geopende documenten zijn meegegeven, gebruik die direct in plaats van erom te vragen. " +
  "Voor taken die een ECHTE browser vereisen (inloggen op een website, gegevens scrapen, klikken, downloaden): " +
  "je hebt geen browser in deze modus, maar de gebruiker kan op de wereldbol-knop (Browser-taak) in jouw venster klikken — " +
  "vertel hem dat kort in plaats van te zeggen dat je het niet kunt. " +
  "Antwoord in het Nederlands, kort en concreet.";

function runClaude(prompt, opts = {}) {
  return new Promise((resolve) => {
    const args = ['--output-format', 'json'];
    if (state.model) args.push('--model', state.model);
    if (opts.browser) {
      args.push('--add-dir', os.homedir());
      args.push('--mcp-config', PW_CONFIG);
      args.push('--append-system-prompt', BROWSER_GUARD);
      args.push('--allowedTools', 'mcp__playwright', 'Read', 'Bash');
    } else if (opts.agent) {
      args.push('--add-dir', os.homedir());
      args.push('--append-system-prompt', GUARD);
      args.push('--allowedTools', ...AGENT_TOOLS);
    } else if (opts.read) {
      args.push('--allowedTools', 'Read');
    }
    if (state.sessionId) args.push('--resume', state.sessionId);
    args.push('-p', prompt);
    const env = { ...process.env };
    env.PATH = [path.join(os.homedir(), '.local', 'bin'), LOGIN_PATH, env.PATH].filter(Boolean).join(':');
    let out = '', err = '';
    const child = spawn(claudeBin(), args, { cwd: APP_DIR, env });
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('error', e => resolve({ ok: false, error: 'Kon claude niet starten: ' + e.message }));
    child.on('close', () => {
      try {
        const json = JSON.parse(out);
        const u = json.usage || {};
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        const cost = json.total_cost_usd || 0;
        state.usedTokens += tokens;
        state.usedCostUsd += cost;
        state.messages += 1;
        state.events.push({ t: Date.now(), tokens, cost });
        const cutoff = Date.now() - WEEK;
        state.events = state.events.filter(e => e.t >= cutoff); // ouder dan 7d weg
        if (json.session_id) state.sessionId = json.session_id;
        saveState(state);
        // welk model maakte het eigenlijke antwoord (meeste output-tokens)
        const mu = json.modelUsage || {};
        let usedModel = '', maxOut = -1;
        for (const [k, v] of Object.entries(mu)) {
          if ((v.outputTokens || 0) > maxOut) { maxOut = v.outputTokens || 0; usedModel = k; }
        }
        resolve({ ok: !json.is_error, text: json.result || '(geen antwoord)', state: publicState(), usedModel });
      } catch {
        resolve({ ok: false, error: (err || out || 'Onbekende fout').slice(0, 500) });
      }
    });
  });
}
function publicState() {
  const now = Date.now();
  let tok5h = 0, cost5h = 0, tokWk = 0, costWk = 0;
  for (const e of state.events) {
    if (e.t >= now - WEEK) { tokWk += e.tokens; costWk += e.cost; }
    if (e.t >= now - FIVE_H) { tok5h += e.tokens; cost5h += e.cost; }
  }
  const pct = (used, budget) => Math.max(0, Math.min(100, 100 * used / budget));
  // tijd tot het oudste event uit elk venster valt (= "reset over")
  const inWin = (ms) => state.events.filter(e => e.t >= now - ms).map(e => e.t);
  const resetIn = (ms) => { const a = inWin(ms); return a.length ? Math.max(0, (Math.min(...a) + ms) - now) : 0; };
  return {
    pinned: state.pinned,
    model: state.model,
    messages: state.messages,
    usedTokens: state.usedTokens, usedCostUsd: state.usedCostUsd,
    fiveH: { tokens: tok5h, cost: cost5h, budget: state.budget5h,
             pct: pct(tok5h, state.budget5h), resetMs: resetIn(FIVE_H) },
    week:  { tokens: tokWk, cost: costWk, budget: state.budgetWeek,
             pct: pct(tokWk, state.budgetWeek), resetMs: resetIn(WEEK) }
  };
}

// ---------- IPC ----------
function openDocsContext() {
  const docs = getOpenDocuments();
  if (!docs.length) return '';
  return `\n\n(Context — documenten die nu op het scherm van de gebruiker open staan; gebruik deze paden direct:\n${docs.map(d => '  • ' + d).join('\n')}\n)`;
}
ipcMain.handle('chat', async (_e, payload) => {
  // payload kan een string zijn (alleen tekst) of { text, files: [paden] }
  const text = typeof payload === 'string' ? payload : ((payload && payload.text) || '');
  const files = (payload && payload.files) || [];
  let prompt = text;
  if (files.length) {
    prompt += `\n\nMeegestuurde bestanden (lees/analyseer met je gereedschap):\n${files.map(f => '  • ' + f).join('\n')}`;
  }
  prompt += openDocsContext();
  return runClaude(prompt || '(geen bericht)', { agent: true });
});
ipcMain.handle('browser-task', async (_e, text) => {
  const prompt = `${text}\n\n(Voer dit uit in het zichtbare browservenster dat je via je browser-gereedschap opent.)`;
  return runClaude(prompt, { browser: true });
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Kies bestanden voor Clippy',
    properties: ['openFile', 'multiSelections'],
    message: 'Selecteer bestanden of foto\'s om met Clippy te delen'
  });
  return (r && !r.canceled) ? r.filePaths : [];
});
ipcMain.handle('look', async (_e, question) => {
  // Eerst écht proberen te capturen — die poging registreert Clippy in de
  // Schermopname-lijst van macOS én vraagt de toestemming aan.
  const img = await captureScreen();
  if (!img) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return { ok: false, error: 'Ik kon je scherm nog niet vastleggen — waarschijnlijk mist de Schermopname-toegang. Ik heb de instellingen geopend: zet daar "Clippy" aan (die verschijnt nu in de lijst), sluit me af met de power-knop en start me opnieuw via je snelkoppeling. Daarna kijk ik echt mee.' };
  }
  const q = (question && question.trim()) ? question.trim()
    : 'Wat zie je op mijn scherm? Vat kort samen waar ik mee bezig lijk te zijn.';
  const prompt = `Ik deel een schermafbeelding van mijn beeldscherm: ${img}\nBekijk die met je Read-gereedschap. Als er documenten open staan en mijn vraag daarover gaat, mag je die bestanden ook echt inlezen en analyseren.${openDocsContext()}\n\nMijn vraag: ${q}`;
  return runClaude(prompt, { agent: true });
});
ipcMain.handle('get-state', async () => publicState());
ipcMain.handle('set-budgets', async (_e, b) => {
  const a = parseInt(b && b.five, 10), w = parseInt(b && b.week, 10);
  if (!isNaN(a) && a > 0) state.budget5h = a;
  if (!isNaN(w) && w > 0) state.budgetWeek = w;
  saveState(state);
  return publicState();
});
ipcMain.handle('set-model', async (_e, m) => {
  const allowed = ['', 'claude-opus-4-8', 'sonnet', 'haiku', 'opus'];
  state.model = allowed.includes(m) ? m : '';
  saveState(state);
  return state.model;
});
ipcMain.handle('reset-session', async () => { state.sessionId = null; saveState(state); return true; });
ipcMain.handle('toggle-pin', async () => { state.pinned = !state.pinned; saveState(state); return state.pinned; });
ipcMain.on('set-chat-open', (_e, v) => { chatOpen = !!v; setExpanded(chatOpen); });
ipcMain.on('drag-start', (_e, off) => startDrag(off));
ipcMain.on('drag-end', () => endDrag());
ipcMain.on('quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!win) createWindow(); });
