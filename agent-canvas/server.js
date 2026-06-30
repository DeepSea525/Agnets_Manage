const express = require('express');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── The command run in Terminal when an agent is launched ───
const AGENT_COMMAND = 'claude --model claude-opus-4-6';

// ─── In-memory state ─────────────────────────────────────────
let state = {
  rootDir: null,
  nodes: [],
  camera: { x: 0, y: 0, scale: 1 }
};

// ─── Persistence ─────────────────────────────────────────────
let saveTimer = null;

function saveState() {
  if (!state.rootDir) return;
  try {
    fs.writeFileSync(
      path.join(state.rootDir, 'canvas-state.json'),
      JSON.stringify(state, null, 2)
    );
  } catch (e) {
    console.error('Save failed:', e.message);
  }
}

function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

function loadState(rootDir) {
  const file = path.join(rootDir, 'canvas-state.json');
  if (fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = { ...saved, rootDir };
      return;
    } catch (e) { /* fall through to fresh state */ }
  }
  state = { rootDir, nodes: [], camera: { x: 80, y: 80, scale: 1 } };
}

// ─── WebSocket broadcast ──────────────────────────────────────
function broadcast() {
  const msg = JSON.stringify({ type: 'state', payload: state });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', payload: state }));
});

// ─── Terminal spawn (macOS) ───────────────────────────────────
function spawnTerminal(dir) {
  // Write a temp shell script to avoid quoting nightmares
  const tmp = `/tmp/agent-canvas-launch-${Date.now()}.sh`;
  fs.writeFileSync(tmp, `#!/bin/bash\ncd "${dir.replace(/"/g, '\\"')}"\n${AGENT_COMMAND}\n`);
  fs.chmodSync(tmp, '755');
  execSync(`osascript -e 'tell application "Terminal" to do script "bash ${tmp}"'`);
}

// ─── Routes ───────────────────────────────────────────────────

// Init: set root directory, load saved state
app.post('/api/init', (req, res) => {
  const { rootDir } = req.body;
  if (!rootDir) return res.status(400).json({ error: 'rootDir required' });
  if (!fs.existsSync(rootDir)) {
    try { fs.mkdirSync(rootDir, { recursive: true }); }
    catch (e) { return res.status(400).json({ error: 'Cannot create directory: ' + e.message }); }
  }
  loadState(rootDir);
  broadcast();
  res.json({ ok: true, state });
});

// Create workspace (= create subfolder)
app.post('/api/workspace', (req, res) => {
  if (!state.rootDir) return res.status(400).json({ error: 'Not initialized' });
  const { x, y, name } = req.body;
  const id = crypto.randomUUID();
  const wsCount = state.nodes.filter(n => n.type === 'workspace').length;
  const wsName = (name || `Workspace ${wsCount + 1}`).trim();
  const dir = path.join(state.rootDir, wsName);
  fs.mkdirSync(dir, { recursive: true });
  const node = {
    id, type: 'workspace',
    x: x ?? 100, y: y ?? 100,
    w: 340, h: 260,
    name: wsName, dir,
    workspaceId: null
  };
  state.nodes.push(node);
  debouncedSave();
  broadcast();
  res.json(node);
});

// Create agent node
app.post('/api/agent', (req, res) => {
  if (!state.rootDir) return res.status(400).json({ error: 'Not initialized' });
  const { x, y, name, workspaceId } = req.body;
  const id = crypto.randomUUID();
  const agentCount = state.nodes.filter(n => n.type === 'agent').length;
  const agentName = (name || `Agent ${agentCount + 1}`).trim();
  let dir = state.rootDir;
  if (workspaceId) {
    const ws = state.nodes.find(n => n.id === workspaceId && n.type === 'workspace');
    if (ws) dir = ws.dir;
  }
  const node = {
    id, type: 'agent',
    x: x ?? 200, y: y ?? 200,
    w: 240, h: 150,
    name: agentName, dir,
    model: 'claude-opus-4-6',
    launched: false,
    workspaceId: workspaceId || null
  };
  state.nodes.push(node);
  debouncedSave();
  broadcast();
  res.json(node);
});

// Launch agent in Terminal
app.post('/api/agent/:id/launch', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node || node.type !== 'agent') return res.status(404).json({ error: 'Agent not found' });
  try {
    spawnTerminal(node.dir);
    node.launched = true;
    debouncedSave();
    broadcast();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Patch node (position, size, name)
app.patch('/api/node/:id', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  // If workspace moves, carry its child agents
  if (node.type === 'workspace' && (req.body.x !== undefined || req.body.y !== undefined)) {
    const dx = (req.body.x ?? node.x) - node.x;
    const dy = (req.body.y ?? node.y) - node.y;
    if (dx !== 0 || dy !== 0) {
      state.nodes.forEach(n => {
        if (n.workspaceId === node.id) { n.x += dx; n.y += dy; }
      });
    }
  }

  // If workspace renamed, rename the folder
  if (node.type === 'workspace' && req.body.name && req.body.name !== node.name) {
    const newName = req.body.name.trim();
    const newDir = path.join(state.rootDir, newName);
    try {
      if (fs.existsSync(node.dir)) fs.renameSync(node.dir, newDir);
      else fs.mkdirSync(newDir, { recursive: true });
      node.dir = newDir;
      state.nodes.forEach(n => { if (n.workspaceId === node.id) n.dir = newDir; });
    } catch (e) {
      return res.status(500).json({ error: 'Rename folder failed: ' + e.message });
    }
  }

  const allowed = ['x', 'y', 'w', 'h', 'name', 'launched'];
  allowed.forEach(k => { if (req.body[k] !== undefined) node[k] = req.body[k]; });

  debouncedSave();
  broadcast();
  res.json(node);
});

// Delete node (workspace deletes its children too)
app.delete('/api/node/:id', (req, res) => {
  const node = state.nodes.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  if (node.type === 'workspace') {
    state.nodes = state.nodes.filter(n => n.id !== req.params.id && n.workspaceId !== req.params.id);
  } else {
    state.nodes = state.nodes.filter(n => n.id !== req.params.id);
  }
  debouncedSave();
  broadcast();
  res.json({ ok: true });
});

// Persist camera position
app.patch('/api/camera', (req, res) => {
  const { x, y, scale } = req.body;
  if (x !== undefined) state.camera.x = x;
  if (y !== undefined) state.camera.y = y;
  if (scale !== undefined) state.camera.scale = scale;
  debouncedSave();
  res.json({ ok: true });
});

// Current state snapshot
app.get('/api/state', (req, res) => res.json(state));

// ─── Start ────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, () => {
  console.log('\n🚀  Agent Canvas ready at http://localhost:3000\n');
  try { execSync('open http://localhost:3000'); } catch (_) {}
});
