// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
let state = { rootDir: null, nodes: [], camera: { x: 80, y: 80, scale: 1 } };
let camera = { x: 80, y: 80, scale: 1 };
let initialized = false;

// Drag state
let drag = null;
let draggingId = null;

// Pan state
let isPanning = false;
let panStart = { mx: 0, my: 0, cx: 0, cy: 0 };

// Context menu state
let ctxTarget = null;

// Timers
let zoomHideTimer = null;
let camSaveTimer = null;

// ════════════════════════════════════════════════════
// TERMINAL STATE  (single shared xterm instance)
// ════════════════════════════════════════════════════
let activeTerm      = null;  // Terminal instance
let activeFitAddon  = null;  // FitAddon instance
let activeAgentId   = null;  // which agent is currently shown
let termReady       = false; // whether term.open() has been called

// ════════════════════════════════════════════════════
// API
// ════════════════════════════════════════════════════
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ════════════════════════════════════════════════════
// WEBSOCKET
// ════════════════════════════════════════════════════
let ws;
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen  = () => console.log('[WS] connected');
  ws.onclose = () => { console.log('[WS] reconnecting…'); setTimeout(connectWS, 1500); };
  ws.onerror = () => ws.close();

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'state') {
      state = msg.payload;
      if (!isPanning) { camera = { ...state.camera }; applyTransform(); }
      renderAll();
      if (state.rootDir && !initialized) { initialized = true; showApp(); }

      // Keep terminal header badge in sync
      if (activeAgentId) {
        const a = state.nodes.find(n => n.id === activeAgentId);
        if (a) updateTermBadge(a);
      }

      // Consensus panel live sync
      syncConsensusFromState();

    } else if (msg.type === 'pty-data') {
      if (activeTerm && msg.agentId === activeAgentId) {
        activeTerm.write(msg.data);
      }
    }
  };
}

// ════════════════════════════════════════════════════
// CAMERA
// ════════════════════════════════════════════════════
function applyTransform() {
  document.getElementById('canvas').style.transform =
    `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
}

function screenToWorld(sx, sy) {
  const rect = document.getElementById('canvas-container').getBoundingClientRect();
  return { x: (sx - rect.left - camera.x) / camera.scale, y: (sy - rect.top - camera.y) / camera.scale };
}

function saveCameraDebounced() {
  clearTimeout(camSaveTimer);
  camSaveTimer = setTimeout(() => {
    api('PATCH', '/api/camera', { x: camera.x, y: camera.y, scale: camera.scale }).catch(() => {});
  }, 300);
}

function showZoomBadge() {
  const el = document.getElementById('zoom-indicator');
  el.textContent = Math.round(camera.scale * 100) + '%';
  el.classList.add('visible');
  clearTimeout(zoomHideTimer);
  zoomHideTimer = setTimeout(() => el.classList.remove('visible'), 1400);
}

function resetView() {
  camera = { x: 80, y: 80, scale: 1 };
  applyTransform();
  saveCameraDebounced();
  showZoomBadge();
}

// ════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════
function renderAll() {
  const canvas = document.getElementById('canvas');
  const existingIds = new Set([...canvas.querySelectorAll('[data-id]')].map(el => el.dataset.id));
  const liveIds     = new Set(state.nodes.map(n => n.id));

  existingIds.forEach(id => { if (!liveIds.has(id)) canvas.querySelector(`[data-id="${id}"]`)?.remove(); });

  state.nodes.filter(n => n.type === 'workspace').forEach(renderWorkspace);
  state.nodes.filter(n => n.type === 'agent').forEach(renderAgent);
}

function renderWorkspace(node) {
  let el = document.querySelector(`[data-id="${node.id}"]`);
  if (!el) { el = buildWorkspaceEl(node); document.getElementById('canvas').appendChild(el); }
  if (draggingId !== node.id) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
  el.style.width = node.w + 'px'; el.style.height = node.h + 'px';
  const lbl = el.querySelector('.ws-name');
  if (lbl && lbl.tagName === 'SPAN') lbl.textContent = node.name;
}

function buildWorkspaceEl(node) {
  const el = document.createElement('div');
  el.className = 'workspace-node'; el.dataset.id = node.id; el.dataset.type = 'workspace';
  el.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px;z-index:1`;
  el.innerHTML = `
    <div class="node-header" data-drag>
      <div class="node-header-left">
        <span class="node-icon">📁</span>
        <span class="ws-name node-label">${escHtml(node.name)}</span>
      </div>
      <div class="node-header-right">
        <button class="btn-icon add-agent-btn" title="新建 Agent">＋</button>
        <button class="btn-icon delete-btn" title="删除">✕</button>
      </div>
    </div>
    <div class="ws-body"><span class="ws-hint">右键或点击 ＋ 新建 Agent</span></div>`;
  wireNodeEvents(el, node.id, 'workspace');
  return el;
}

function renderAgent(node) {
  let el = document.querySelector(`[data-id="${node.id}"]`);
  if (!el) { el = buildAgentEl(node); document.getElementById('canvas').appendChild(el); }
  if (draggingId !== node.id) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }

  const lbl = el.querySelector('.agent-name');
  if (lbl && lbl.tagName === 'SPAN') lbl.textContent = node.name;
  el.querySelector('.agent-dir').textContent = truncatePath(node.dir);

  const badge = el.querySelector('.status-badge');
  badge.className = 'status-badge ' + (node.launched ? 'badge-launched' : 'badge-not-launched');
  badge.textContent = node.launched ? '● 运行中' : '● 未启动';
}

function buildAgentEl(node) {
  const el = document.createElement('div');
  el.className = 'agent-node'; el.dataset.id = node.id; el.dataset.type = 'agent';
  el.style.cssText = `left:${node.x}px;top:${node.y}px;z-index:2`;
  el.innerHTML = `
    <div class="node-header" data-drag>
      <div class="node-header-left">
        <span class="node-icon">🤖</span>
        <span class="agent-name node-label">${escHtml(node.name)}</span>
      </div>
      <div class="node-header-right">
        <button class="btn-icon delete-btn" title="删除">✕</button>
      </div>
    </div>
    <div class="agent-body" data-open-agent="${node.id}">
      <div class="agent-dir">${escHtml(truncatePath(node.dir))}</div>
      <div class="agent-meta">
        <span class="model-badge">${escHtml(node.model)}</span>
        <span class="status-badge ${node.launched ? 'badge-launched' : 'badge-not-launched'}">
          ${node.launched ? '● 运行中' : '● 未启动'}
        </span>
      </div>
      <div class="agent-click-hint">点击进入终端 →</div>
    </div>`;
  wireNodeEvents(el, node.id, 'agent');
  return el;
}

// ════════════════════════════════════════════════════
// NODE EVENTS
// ════════════════════════════════════════════════════
function wireNodeEvents(el, nodeId, nodeType) {
  const header = el.querySelector('[data-drag]');

  // Drag via header
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    startDrag(e, nodeId);
  });

  // Rename on double-click
  header.querySelector('.node-label').addEventListener('dblclick', e => {
    e.stopPropagation();
    beginRename(nodeId, e.currentTarget);
  });

  // Delete button
  el.querySelector('.delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (activeAgentId === nodeId) closeTerminalPanel();
    api('DELETE', `/api/node/${nodeId}`).catch(err => alert(err.message));
  });

  // "+ Agent" button (workspace)
  const addBtn = el.querySelector('.add-agent-btn');
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ws = state.nodes.find(n => n.id === nodeId);
      api('POST', '/api/agent', { x: ws.x + 20, y: ws.y + 60, workspaceId: nodeId }).catch(console.error);
    });
  }

  // Click agent body → open terminal
  const body = el.querySelector('[data-open-agent]');
  if (body) {
    body.addEventListener('click', e => {
      e.stopPropagation();
      openTerminalPanel(nodeId);
    });
  }

  // Right-click context menu
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    openCtxMenu(e.clientX, e.clientY, nodeId, nodeType);
  });

  el.addEventListener('mousedown', e => e.stopPropagation());
}

// ════════════════════════════════════════════════════
// DRAG & DROP
// ════════════════════════════════════════════════════
function startDrag(e, nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  draggingId = nodeId;
  drag = { nodeId, startMX: e.clientX, startMY: e.clientY, startNX: node.x, startNY: node.y };
  document.addEventListener('mousemove', onDragMove, { passive: true });
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.startMX) / camera.scale;
  const dy = (e.clientY - drag.startMY) / camera.scale;
  const nx = drag.startNX + dx, ny = drag.startNY + dy;
  const el = document.querySelector(`[data-id="${drag.nodeId}"]`);
  if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }
  const node = state.nodes.find(n => n.id === drag.nodeId);
  if (node && node.type === 'workspace') {
    const ddx = nx - node.x, ddy = ny - node.y;
    state.nodes.forEach(n => {
      if (n.workspaceId === drag.nodeId) {
        const cel = document.querySelector(`[data-id="${n.id}"]`);
        if (cel) { cel.style.left = (n.x + ddx) + 'px'; cel.style.top = (n.y + ddy) + 'px'; }
      }
    });
  }
}

function onDragEnd(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.startMX) / camera.scale;
  const dy = (e.clientY - drag.startMY) / camera.scale;
  api('PATCH', `/api/node/${drag.nodeId}`, { x: drag.startNX + dx, y: drag.startNY + dy }).catch(console.error);
  drag = null; draggingId = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
}

// ════════════════════════════════════════════════════
// RENAME
// ════════════════════════════════════════════════════
function beginRename(nodeId, labelSpan) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const input = document.createElement('input');
  input.className = 'node-label-input'; input.value = node.name;
  labelSpan.replaceWith(input);
  input.focus(); input.select();

  function commit() {
    const newName = input.value.trim() || node.name;
    const span = document.createElement('span');
    span.className = labelSpan.className; span.textContent = newName;
    input.replaceWith(span);
    span.addEventListener('dblclick', e => { e.stopPropagation(); beginRename(nodeId, span); });
    api('PATCH', `/api/node/${nodeId}`, { name: newName }).catch(console.error);
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = node.name; input.blur(); }
  });
}

// ════════════════════════════════════════════════════
// TERMINAL PANEL
// ════════════════════════════════════════════════════
function initTerminalIfNeeded() {
  if (termReady) return;
  termReady = true;

  activeTerm = new Terminal({
    theme: {
      background:        '#0d1117',
      foreground:        '#e6edf3',
      cursor:            '#a78bfa',
      cursorAccent:      '#0d1117',
      selectionBackground: 'rgba(124,58,237,0.25)',
      black:        '#1c2230', brightBlack:   '#6e7681',
      red:          '#ef4444', brightRed:     '#f87171',
      green:        '#10b981', brightGreen:   '#34d399',
      yellow:       '#f59e0b', brightYellow:  '#fcd34d',
      blue:         '#3b82f6', brightBlue:    '#60a5fa',
      magenta:      '#8b5cf6', brightMagenta: '#a78bfa',
      cyan:         '#06b6d4', brightCyan:    '#22d3ee',
      white:        '#e6edf3', brightWhite:   '#f0f6ff',
    },
    fontSize: 13,
    fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    convertEol: false,
    // macOS: Option 键作为 Meta（Claude Code 快捷键需要）
    macOptionIsMeta: true,
    macOptionClickForcesSelection: false,
    // 允许浏览器粘贴事件穿透到 xterm
    allowProposedApi: true,
  });

  // 点击终端区域立刻聚焦（确保 / 等按键不被浏览器截获）
  document.getElementById('term-container').addEventListener('mousedown', () => {
    activeTerm.focus();
  });

  // 焦点状态视觉反馈
  activeTerm.onFocus(() => {
    document.getElementById('term-container').style.outline = '1px solid rgba(124,58,237,0.5)';
    document.getElementById('term-container').style.outlineOffset = '-1px';
  });
  activeTerm.onBlur(() => {
    document.getElementById('term-container').style.outline = 'none';
  });

  activeFitAddon = new FitAddon.FitAddon();
  activeTerm.loadAddon(activeFitAddon);
  activeTerm.open(document.getElementById('term-container'));

  // User keystrokes → pty
  activeTerm.onData(data => {
    if (activeAgentId && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'pty-input', agentId: activeAgentId, data }));
    }
  });

  // Terminal DOM resize → notify pty
  activeTerm.onResize(({ cols, rows }) => {
    if (activeAgentId && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'pty-resize', agentId: activeAgentId, cols, rows }));
    }
  });

  // Refit when container resizes
  new ResizeObserver(() => {
    if (document.getElementById('term-panel').classList.contains('open')) {
      try { activeFitAddon.fit(); } catch (_) {}
    }
  }).observe(document.getElementById('term-container'));
}

function updateTermBadge(agent) {
  const badge = document.getElementById('tph-badge');
  if (!badge) return;
  badge.className = 'status-badge ' + (agent.launched ? 'badge-launched' : 'badge-not-launched');
  badge.textContent = agent.launched ? '● 运行中' : '● 未启动';
}

async function openTerminalPanel(agentId) {
  const agent = state.nodes.find(n => n.id === agentId);
  if (!agent) return;

  document.getElementById('tph-name').textContent = agent.name;
  document.getElementById('tph-dir').textContent  = agent.dir;
  updateTermBadge(agent);
  document.getElementById('term-panel').classList.add('open');

  initTerminalIfNeeded();
  // 立刻聚焦，让键盘输入直接进终端
  activeTerm.focus();

  const switching = activeAgentId !== agentId;
  activeAgentId = agentId;

  if (switching) {
    activeTerm.clear();
    // Load server-side output history
    try {
      const { data } = await fetch(`/api/agent/${agentId}/pty-buffer`).then(r => r.json());
      if (activeAgentId === agentId && data) activeTerm.write(data);
    } catch (_) {}
  }

  // Fit after panel animation (0.22s)
  setTimeout(() => {
    try {
      activeFitAddon.fit();
      if (activeAgentId && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'pty-resize', agentId: activeAgentId, cols: activeTerm.cols, rows: activeTerm.rows }));
      }
    } catch (_) {}
    activeTerm.focus();
  }, 240);

  // Auto-launch if agent not running
  if (!agent.launched) {
    activeTerm.write('\x1b[33m[启动 Agent…]\x1b[0m\r\n');
    api('POST', `/api/agent/${agentId}/launch`).catch(err => {
      if (activeAgentId === agentId) {
        activeTerm.write(`\x1b[31m[启动失败: ${err.message}]\x1b[0m\r\n`);
      }
    });
  }
}

function closeTerminalPanel() {
  document.getElementById('term-panel').classList.remove('open');
}

// Terminal panel buttons
document.getElementById('tp-close-btn').addEventListener('click', closeTerminalPanel);

document.getElementById('tp-restart-btn').addEventListener('click', () => {
  if (!activeAgentId) return;
  activeTerm.clear();
  activeTerm.write('\x1b[33m[重启 Agent…]\x1b[0m\r\n');
  api('POST', `/api/agent/${activeAgentId}/launch`).catch(err => {
    activeTerm.write(`\x1b[31m[重启失败: ${err.message}]\x1b[0m\r\n`);
  });
});

// ════════════════════════════════════════════════════
// CONTEXT MENU
// ════════════════════════════════════════════════════
function openCtxMenu(sx, sy, nodeId, nodeType) {
  const world = screenToWorld(sx, sy);

  let wsId = nodeType === 'workspace' ? nodeId : null;
  if (!nodeId) {
    state.nodes.filter(n => n.type === 'workspace').forEach(ws => {
      if (world.x >= ws.x && world.x <= ws.x + ws.w && world.y >= ws.y && world.y <= ws.y + ws.h) wsId = ws.id;
    });
  }

  ctxTarget = { nodeId, nodeType, worldX: world.x, worldY: world.y, wsId };

  const hasNode    = !!nodeId;
  const isAgent    = nodeType === 'agent';
  document.getElementById('ctx-rename').style.display        = hasNode ? '' : 'none';
  document.getElementById('ctx-delete').style.display        = hasNode ? '' : 'none';
  document.getElementById('ctx-sep-node').style.display      = hasNode ? '' : 'none';
  document.getElementById('ctx-open-terminal').style.display = isAgent ? '' : 'none';
  document.querySelector('[data-action="new-agent-in-ws"]').style.display = wsId ? '' : 'none';

  const menu = document.getElementById('ctx-menu');
  const mw = 200, mh = 180;
  menu.style.left = (sx + mw > window.innerWidth  ? sx - mw : sx) + 'px';
  menu.style.top  = (sy + mh > window.innerHeight ? sy - mh : sy) + 'px';
  menu.style.display = 'block';
}

function closeCtxMenu() { document.getElementById('ctx-menu').style.display = 'none'; ctxTarget = null; }

document.getElementById('ctx-menu').addEventListener('click', e => {
  const li = e.target.closest('li[data-action]');
  if (!li || !ctxTarget) return;
  const { action } = li.dataset;
  const { nodeId, nodeType, worldX, worldY, wsId } = ctxTarget;
  closeCtxMenu();

  switch (action) {
    case 'new-workspace':
      api('POST', '/api/workspace', { x: worldX, y: worldY }).catch(console.error); break;
    case 'new-agent':
      api('POST', '/api/agent', { x: worldX, y: worldY, workspaceId: wsId }).catch(console.error); break;
    case 'new-agent-in-ws': {
      const ws = state.nodes.find(n => n.id === wsId);
      api('POST', '/api/agent', { x: ws ? ws.x + 20 : worldX, y: ws ? ws.y + 60 : worldY, workspaceId: wsId }).catch(console.error); break;
    }
    case 'open-terminal': if (nodeId) openTerminalPanel(nodeId); break;
    case 'rename':
      if (nodeId) { const lbl = document.querySelector(`[data-id="${nodeId}"] .node-label`); if (lbl) beginRename(nodeId, lbl); } break;
    case 'delete':
      if (nodeId) { if (activeAgentId === nodeId) closeTerminalPanel(); api('DELETE', `/api/node/${nodeId}`).catch(err => alert(err.message)); } break;
  }
});

// ════════════════════════════════════════════════════
// CANVAS PAN + ZOOM
// ════════════════════════════════════════════════════
const container = document.getElementById('canvas-container');

container.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  closeCtxMenu();
  isPanning = true;
  panStart = { mx: e.clientX, my: e.clientY, cx: camera.x, cy: camera.y };
  container.classList.add('panning');
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!isPanning) return;
  camera.x = panStart.cx + (e.clientX - panStart.mx);
  camera.y = panStart.cy + (e.clientY - panStart.my);
  applyTransform();
});

document.addEventListener('mouseup', () => {
  if (!isPanning) return;
  isPanning = false;
  container.classList.remove('panning');
  saveCameraDebounced();
});

container.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const ns = Math.min(4, Math.max(0.08, camera.scale * Math.pow(1.001, -e.deltaY)));
  camera.x = mx - (mx - camera.x) * (ns / camera.scale);
  camera.y = my - (my - camera.y) * (ns / camera.scale);
  camera.scale = ns;
  applyTransform(); showZoomBadge(); saveCameraDebounced();
}, { passive: false });

container.addEventListener('contextmenu', e => { e.preventDefault(); openCtxMenu(e.clientX, e.clientY, null, null); });
document.addEventListener('click',   e => { if (!e.target.closest('#ctx-menu')) closeCtxMenu(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCtxMenu();
    // 终端有焦点时 Escape 不关面板（Claude Code 用 Esc 退出输入/命令模式）
    const termFocused = termReady &&
      document.getElementById('term-panel').classList.contains('open') &&
      document.getElementById('term-container').contains(document.activeElement);
    if (!termFocused) closeTerminalPanel();
  }
});

// ════════════════════════════════════════════════════
// HEADER BUTTONS
// ════════════════════════════════════════════════════
document.getElementById('btn-new-workspace').addEventListener('click', () => {
  const w = screenToWorld(window.innerWidth / 2 - 170, window.innerHeight / 2 - 130);
  api('POST', '/api/workspace', { x: w.x, y: w.y }).catch(console.error);
});

document.getElementById('btn-new-agent').addEventListener('click', () => {
  const w = screenToWorld(window.innerWidth / 2 - 120, window.innerHeight / 2 - 75);
  api('POST', '/api/agent', { x: w.x, y: w.y }).catch(console.error);
});

document.getElementById('btn-reset-view').addEventListener('click', resetView);

// ════════════════════════════════════════════════════
// INIT OVERLAY
// ════════════════════════════════════════════════════
function showApp() {
  document.getElementById('init-overlay').classList.add('hidden');
  document.getElementById('header').style.display = 'flex';
  document.getElementById('canvas-container').style.display = 'block';
  document.getElementById('root-path-display').textContent = state.rootDir;
  applyTransform();
}

document.getElementById('start-btn').addEventListener('click', async () => {
  const rootDir = document.getElementById('root-dir-input').value.trim();
  const errEl   = document.getElementById('init-error');
  const btn     = document.getElementById('start-btn');
  errEl.textContent = '';
  if (!rootDir) { errEl.textContent = '请输入目录路径'; return; }
  btn.disabled = true; btn.textContent = '正在初始化…';
  try {
    await api('POST', '/api/init', { rootDir });
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = '进入画布 →';
  }
});

document.getElementById('root-dir-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('start-btn').click();
});

document.getElementById('browse-btn').addEventListener('click', async () => {
  const btn = document.getElementById('browse-btn');
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const { path } = await fetch('/api/pick-folder').then(r => r.json());
    if (path) document.getElementById('root-dir-input').value = path;
  } catch (_) {}
  btn.disabled = false;
  btn.textContent = '📂';
});

// ════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════
function truncatePath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length <= 3 ? p : '…/' + parts.slice(-2).join('/');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════
// CONSENSUS PANEL (共识管理: 项目级 / 工作区级 CLAUDE.md + skills)
// ════════════════════════════════════════════════════
let cnsScope = 'project';   // 'project' | 'workspace'
let cnsWsId   = null;       // workspace id when scope === 'workspace'
let cnsOpen   = false;
let cnsSaveTimer = null;

function consensusData() {
  if (cnsScope === 'project') {
    if (!state.projectConsensus) state.projectConsensus = { claudeMd: '', skills: [] };
    return state.projectConsensus;
  }
  const ws = state.nodes.find(n => n.id === cnsWsId && n.type === 'workspace');
  if (!ws) return null;
  if (ws.claudeMd == null) ws.claudeMd = '';
  if (!Array.isArray(ws.skills)) ws.skills = [];
  return ws;
}

function openConsensusPanel() {
  cnsOpen = true;
  document.getElementById('consensus-panel').classList.add('open');
  renderCnsTree();
  renderCnsEditor();
}
function closeConsensusPanel() {
  cnsOpen = false;
  document.getElementById('consensus-panel').classList.remove('open');
}
document.getElementById('btn-consensus').addEventListener('click', openConsensusPanel);
document.getElementById('cns-close-btn').addEventListener('click', closeConsensusPanel);

function renderCnsTree() {
  const tree = document.getElementById('cns-tree');
  const workspaces = state.nodes.filter(n => n.type === 'workspace');
  const rootName = (state.rootDir || '项目').replace(/\\/g,'/').split('/').filter(Boolean).pop() || '项目';

  let html = '<div class="cns-tree-section">层级</div>';
  html += `<div class="cns-tree-item ${cnsScope==='project'?'active':''}" data-scope="project">
    <span class="cns-tree-icon">📁</span>
    <span class="cns-tree-name">${escHtml(rootName)}</span>
    <span class="cns-tree-meta">项目级</span>
  </div>`;

  if (workspaces.length) {
    html += '<div class="cns-tree-section">工作区</div>';
    workspaces.forEach(ws => {
      html += `<div class="cns-tree-item ${cnsScope==='workspace'&&cnsWsId===ws.id?'active':''}" data-scope="workspace" data-id="${ws.id}">
        <span class="cns-tree-icon">🗂</span>
        <span class="cns-tree-name">${escHtml(ws.name)}</span>
        <span class="cns-tree-meta">${(ws.skills||[]).length} skill</span>
      </div>`;
    });
  }

  tree.innerHTML = html;
  tree.querySelectorAll('.cns-tree-item').forEach(el => {
    el.addEventListener('click', () => {
      cnsScope = el.dataset.scope;
      cnsWsId = el.dataset.id || null;
      renderCnsTree();
      renderCnsEditor();
    });
  });
}

function renderCnsEditor() {
  const editor = document.getElementById('cns-editor');
  const data = consensusData();
  if (!data) {
    editor.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3);font-size:13px">该工作区已不存在</div>';
    return;
  }
  const scopeLabel = cnsScope === 'project'
    ? `项目级 <b>${escHtml((state.rootDir||'').replace(/\\/g,'/').split('/').filter(Boolean).pop()||'项目')}</b> · 对所有 Agent 生效`
    : `工作区级 <b>${escHtml(state.nodes.find(n=>n.id===cnsWsId)?.name||'')}</b> · 对该工作区内 Agent 生效`;

  const skills = Array.isArray(data.skills) ? data.skills : [];
  editor.innerHTML = `
    <div class="cns-scope-label">${scopeLabel}</div>
    <div class="cns-section">
      <div class="cns-section-title">CLAUDE.md <span class="cns-save-hint">共识与约束</span></div>
      <textarea class="cns-textarea" id="cns-claudemd" placeholder="# 项目/工作区共识&#10;&#10;在这里沉淀该层级的背景、规范、字段约定、目录结构、边界等共识...">${escHtml(data.claudeMd||'')}</textarea>
    </div>
    <div class="cns-section">
      <div class="cns-section-title">Skills / 工具箱 <span class="cns-save-hint">${skills.length} 个</span></div>
      <div id="cns-skills"></div>
      <button class="cns-add-skill" id="cns-add-skill">+ 新增 Skill</button>
    </div>`;

  renderCnsSkills(skills);
  // CLAUDE.md 自动保存
  document.getElementById('cns-claudemd').addEventListener('input', e => {
    data.claudeMd = e.target.value;
    scheduleCnsSave();
  });
  document.getElementById('cns-add-skill').addEventListener('click', () => {
    if (!Array.isArray(data.skills)) data.skills = [];
    data.skills.push({ id: crypto.randomUUID(), name: 'new-skill', description: '', content: '' });
    renderCnsSkills(data.skills);
    scheduleCnsSave();
  });
}

function renderCnsSkills(skills) {
  const wrap = document.getElementById('cns-skills');
  if (!wrap) return;
  if (!skills.length) {
    wrap.innerHTML = '<div style="padding:10px 0;font-size:12px;color:var(--text3)">暂无 skill，点击下方新增。</div>';
    return;
  }
  wrap.innerHTML = skills.map((s, i) => `
    <div class="cns-skill-card" data-i="${i}">
      <div class="cns-skill-head">
        <span class="cns-skill-chev">▶</span>
        <span class="cns-skill-name">${escHtml(s.name||'(未命名)')}</span>
        <span class="cns-skill-desc-tag">${escHtml(s.description||'')}</span>
        <button class="cns-skill-del" data-del="${i}" title="删除">✕</button>
      </div>
      <div class="cns-skill-body">
        <div class="cns-field">
          <div class="cns-field-label">名称 (目录名)</div>
          <input class="cns-input mono" data-field="name" data-i="${i}" value="${escHtml(s.name||'')}" placeholder="image-review">
        </div>
        <div class="cns-field">
          <div class="cns-field-label">一句话描述</div>
          <input class="cns-input" data-field="description" data-i="${i}" value="${escHtml(s.description||'')}" placeholder="这个 skill 做什么">
        </div>
        <div class="cns-field">
          <div class="cns-field-label">SKILL.md 正文</div>
          <textarea class="cns-textarea" data-field="content" data-i="${i}" placeholder="---&#10;name: ...&#10;description: ...&#10;---&#10;&#10;skill 正文内容...">${escHtml(s.content||'')}</textarea>
        </div>
      </div>
    </div>`).join('');

  // 折叠/展开
  wrap.querySelectorAll('.cns-skill-head').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.closest('.cns-skill-del')) return;
      head.parentElement.classList.toggle('open');
    });
  });
  // 删除
  wrap.querySelectorAll('.cns-skill-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.del;
      const data = consensusData();
      data.skills.splice(i, 1);
      renderCnsSkills(data.skills);
      renderCnsTree(); // 更新计数
      scheduleCnsSave();
    });
  });
  // 编辑字段
  wrap.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const i = +el.dataset.i;
      const field = el.dataset.field;
      const data = consensusData();
      if (data.skills[i]) {
        data.skills[i][field] = el.value;
        if (field === 'name' || field === 'description') {
          // 更新卡片头部显示
          const card = wrap.querySelector(`.cns-skill-card[data-i="${i}"]`);
          if (card) {
            card.querySelector('.cns-skill-name').textContent = data.skills[i].name || '(未命名)';
            card.querySelector('.cns-skill-desc-tag').textContent = data.skills[i].description || '';
          }
        }
        scheduleCnsSave();
      }
    });
  });
}

function scheduleCnsSave() {
  clearTimeout(cnsSaveTimer);
  cnsSaveTimer = setTimeout(saveConsensus, 500);
}

function saveConsensus() {
  const data = consensusData();
  if (!data) return;
  if (cnsScope === 'project') {
    api('PATCH', '/api/consensus/project', { claudeMd: data.claudeMd, skills: data.skills }).catch(console.error);
  } else {
    api('PATCH', `/api/node/${cnsWsId}`, { claudeMd: data.claudeMd, skills: data.skills }).catch(console.error);
  }
}

// 当 WebSocket 推送新 state 且抽屉打开时,刷新左侧树与当前编辑区
function syncConsensusFromState() {
  if (!cnsOpen) return;
  // 记录当前焦点元素以便恢复
  renderCnsTree();
  // 仅在非编辑态时刷新编辑区,避免覆盖用户正在输入的内容
  const active = document.activeElement;
  if (!active || !active.closest('#cns-editor')) {
    renderCnsEditor();
  }
}

// ════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════
connectWS();
