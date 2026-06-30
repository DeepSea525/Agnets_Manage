const express = require('express');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Agent command ─────────────────────────────────────────────
const AGENT_COMMAND = 'claude --model claude-opus-4-6';
const SHELL = process.env.SHELL || '/bin/zsh';

// ─── In-memory state ───────────────────────────────────────────
let state = { rootDir: null, nodes: [], camera: { x: 80, y: 80, scale: 1 } };

// ─── PTY registry ──────────────────────────────────────────────
const ptys    = new Map(); // agentId → pty process
const ptyBufs = new Map(); // agentId → string (rolling 100 KB history)
const PTY_BUF_MAX = 100000;

// ─── Persistence ──────────────────────────────────────────────
let saveTimer = null;
function saveState() {
  if (!state.rootDir) return;
  try { fs.writeFileSync(path.join(state.rootDir, 'canvas-state.json'), JSON.stringify(state, null, 2)); }
  catch (e) { console.error('Save failed:', e.message); }
}
function debouncedSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 500); }

function loadState(rootDir) {
  const file = path.join(rootDir, 'canvas-state.json');
  if (fs.existsSync(file)) {
    try { state = { ...JSON.parse(fs.readFileSync(file, 'utf8')), rootDir }; return; }
    catch (_) {}
  }
  state = { rootDir, nodes: [], camera: { x: 80, y: 80, scale: 1 } };
}

// ─── Broadcast helpers ─────────────────────────────────────────
function broadcastState() {
  send({ type: 'state', payload: state });
}
function send(msg) {
  const raw = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(raw); });
}

// ─── PTY helpers ───────────────────────────────────────────────
function killPty(agentId) {
  if (ptys.has(agentId)) {
    try { ptys.get(agentId).kill(); } catch (_) {}
    ptys.delete(agentId);
  }
}

function spawnPty(node) {
  killPty(node.id);
  ptyBufs.set(node.id, ''); // fresh buffer

  // Spawn a login-interactive shell so ~/.zshrc / PATH are fully loaded,
  // then write the agent command once the shell prompt is ready.
  const shellBin = SHELL.startsWith('/') ? SHELL : '/bin/zsh';
  const p = pty.spawn(shellBin, ['-l', '-i'], {
    name: 'xterm-256color',
    cols: 220, rows: 50,
    cwd: node.dir,
    env: { ...process.env, TERM: 'xterm-256color', LANG: process.env.LANG || 'en_US.UTF-8' }
  });

  // Give the shell ~400 ms to finish initializing, then run the agent command
  setTimeout(() => {
    if (ptys.has(node.id)) p.write(AGENT_COMMAND + '\r');
  }, 400);

  ptys.set(node.id, p);

  p.onData(data => {
    // Append to rolling buffer
    let buf = (ptyBufs.get(node.id) || '') + data;
    if (buf.length > PTY_BUF_MAX) buf = buf.slice(buf.length - PTY_BUF_MAX);
    ptyBufs.set(node.id, buf);
    // Stream to all browser clients
    send({ type: 'pty-data', agentId: node.id, data });
  });

  p.onExit(() => {
    ptys.delete(node.id);
    const n = state.nodes.find(x => x.id === node.id);
    if (n) { n.launched = false; debouncedSave(); broadcastState(); }
    console.log(`[pty] agent ${node.name} exited`);
  });

  node.launched = true;
  debouncedSave();
  broadcastState();
}

// ─── WebSocket ─────────────────────────────────────────────────
wss.on('connection', ws => {
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'state', payload: state }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'pty-input') {
      const p = ptys.get(msg.agentId);
      if (p) p.write(msg.data);

    } else if (msg.type === 'pty-resize') {
      const p = ptys.get(msg.agentId);
      if (p && msg.cols > 0 && msg.rows > 0) p.resize(msg.cols, msg.rows);
    }
  });
});

// ─── Routes ────────────────────────────────────────────────────

app.post('/api/init', (req, res) => {
  const { rootDir } = req.body;
  if (!rootDir) return res.status(400).json({ error: 'rootDir required' });
  if (!fs.existsSync(rootDir)) {
    try { fs.mkdirSync(rootDir, { recursive: true }); }
    catch (e) { return res.status(400).json({ error: 'Cannot create directory: ' + e.message }); }
  }
  loadState(rootDir);
  broadcastState();
  res.json({ ok: true, state });
});

app.post('/api/workspace', (req, res) => {
  if (!state.rootDir) return res.status(400).json({ error: 'Not initialized' });
  const { x, y, name } = req.body;
  const id = crypto.randomUUID();
  const wsName = (name || `Workspace ${state.nodes.filter(n => n.type === 'workspace').length + 1}`).trim();
  fs.mkdirSync(path.join(state.rootDir, wsName), { recursive: true });
  const node = { id, type: 'workspace', x: x ?? 100, y: y ?? 100, w: 340, h: 260, name: wsName, dir: path.join(state.rootDir, wsName), workspaceId: null };
  state.nodes.push(node);
  debouncedSave(); broadcastState(); res.json(node);
});

app.post('/api/agent', (req, res) => {
  if (!state.rootDir) return res.status(400).json({ error: 'Not initialized' });
  const { x, y, name, workspaceId } = req.body;
  const id = crypto.randomUUID();
  const agentName = (name || `Agent ${state.nodes.filter(n => n.type === 'agent').length + 1}`).trim();
  let dir = state.rootDir;
  if (workspaceId) {
    const ws = state.nodes.find(n => n.id === workspaceId && n.type === 'workspace');
    if (ws) dir = ws.dir;
  }
  const node = { id, type: 'agent', x: x ?? 200, y: y ?? 200, w: 240, h: 150, name: agentName, dir, model: 'claude-opus-4-6', launched: false, workspaceId: workspaceId || null };
  state.nodes.push(node);
  debouncedSave(); broadcastState(); res.json(node);
});

// Launch agent — starts PTY in-process (no Terminal.app)
app.post('/api/agent/:id/launch', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node || node.type !== 'agent') return res.status(404).json({ error: 'Agent not found' });
  try {
    spawnPty(node);
    res.json({ ok: true });
  } catch (e) {
    console.error('[pty] spawn error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get pty output history (for reconnecting / panel reopen)
app.get('/api/agent/:id/pty-buffer', (req, res) => {
  res.json({ data: ptyBufs.get(req.params.id) || '', running: ptys.has(req.params.id) });
});

app.patch('/api/node/:id', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  if (node.type === 'workspace' && (req.body.x !== undefined || req.body.y !== undefined)) {
    const dx = (req.body.x ?? node.x) - node.x;
    const dy = (req.body.y ?? node.y) - node.y;
    if (dx || dy) state.nodes.forEach(n => { if (n.workspaceId === node.id) { n.x += dx; n.y += dy; } });
  }

  if (node.type === 'workspace' && req.body.name && req.body.name !== node.name) {
    const newDir = path.join(state.rootDir, req.body.name.trim());
    try {
      if (fs.existsSync(node.dir)) fs.renameSync(node.dir, newDir);
      else fs.mkdirSync(newDir, { recursive: true });
      node.dir = newDir;
      state.nodes.forEach(n => { if (n.workspaceId === node.id) n.dir = newDir; });
    } catch (e) { return res.status(500).json({ error: 'Rename failed: ' + e.message }); }
  }

  ['x','y','w','h','name','launched'].forEach(k => { if (req.body[k] !== undefined) node[k] = req.body[k]; });
  debouncedSave(); broadcastState(); res.json(node);
});

app.delete('/api/node/:id', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  if (node.type === 'workspace') {
    state.nodes.filter(n => n.workspaceId === node.id).forEach(n => killPty(n.id));
    state.nodes = state.nodes.filter(n => n.id !== req.params.id && n.workspaceId !== req.params.id);
  } else {
    killPty(node.id);
    state.nodes = state.nodes.filter(n => n.id !== req.params.id);
  }
  debouncedSave(); broadcastState(); res.json({ ok: true });
});

app.patch('/api/camera', (req, res) => {
  if (req.body.x !== undefined) state.camera.x = req.body.x;
  if (req.body.y !== undefined) state.camera.y = req.body.y;
  if (req.body.scale !== undefined) state.camera.scale = req.body.scale;
  debouncedSave(); res.json({ ok: true });
});

app.get('/api/state', (req, res) => res.json(state));

// Open native macOS Finder folder picker
app.get('/api/pick-folder', (req, res) => {
  try {
    const chosen = execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "选择工作目录")'`,
      { timeout: 60000 }
    ).toString().trim();
    res.json({ path: chosen });
  } catch (_) {
    res.json({ path: null }); // user cancelled
  }
});

// ─── Start ─────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n🚀  Agent Canvas ready at http://localhost:3000\n');
  try { execSync('open http://localhost:3000'); } catch (_) {}
});
