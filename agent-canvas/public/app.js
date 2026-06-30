// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
let state = { rootDir: null, nodes: [], camera: { x: 80, y: 80, scale: 1 } };
let camera = { x: 80, y: 80, scale: 1 };
let initialized = false;

// Drag state
let drag = null;        // { nodeId, startMX, startMY, startNX, startNY }
let draggingId = null;  // id of node currently being dragged (skip WS position update)

// Pan state
let isPanning = false;
let panStart = { mx: 0, my: 0, cx: 0, cy: 0 };

// Context menu state
let ctxTarget = null;

// Zoom hide timer
let zoomHideTimer = null;

// Camera debounce timer
let camSaveTimer = null;

// ════════════════════════════════════════════════════
// API HELPER
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
    if (msg.type !== 'state') return;

    state = msg.payload;

    // Accept camera from server only when not actively panning/zooming
    if (!isPanning) {
      camera = { ...state.camera };
      applyTransform();
    }

    renderAll();

    if (state.rootDir && !initialized) {
      initialized = true;
      showApp();
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
  return {
    x: (sx - rect.left - camera.x) / camera.scale,
    y: (sy - rect.top  - camera.y) / camera.scale
  };
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

  // Remove stale DOM nodes
  existingIds.forEach(id => {
    if (!liveIds.has(id)) canvas.querySelector(`[data-id="${id}"]`)?.remove();
  });

  // Workspaces first (z-index 1), agents on top (z-index 2)
  state.nodes.filter(n => n.type === 'workspace').forEach(renderWorkspace);
  state.nodes.filter(n => n.type === 'agent').forEach(renderAgent);
}

// ── Workspace ──────────────────────────────────────
function renderWorkspace(node) {
  let el = document.querySelector(`[data-id="${node.id}"]`);
  if (!el) {
    el = buildWorkspaceEl(node);
    document.getElementById('canvas').appendChild(el);
  }
  if (draggingId !== node.id) {
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
  }
  el.style.width  = node.w + 'px';
  el.style.height = node.h + 'px';

  const lbl = el.querySelector('.ws-name');
  if (lbl && lbl.tagName === 'SPAN') lbl.textContent = node.name;
}

function buildWorkspaceEl(node) {
  const el = document.createElement('div');
  el.className    = 'workspace-node';
  el.dataset.id   = node.id;
  el.dataset.type = 'workspace';
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
    <div class="ws-body">
      <span class="ws-hint">右键或点击 ＋ 在此工作区内新建 Agent</span>
    </div>`;

  wireNodeEvents(el, node.id, 'workspace');
  return el;
}

// ── Agent ───────────────────────────────────────────
function renderAgent(node) {
  let el = document.querySelector(`[data-id="${node.id}"]`);
  if (!el) {
    el = buildAgentEl(node);
    document.getElementById('canvas').appendChild(el);
  }
  if (draggingId !== node.id) {
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
  }

  const lbl = el.querySelector('.agent-name');
  if (lbl && lbl.tagName === 'SPAN') lbl.textContent = node.name;

  el.querySelector('.agent-dir').textContent = truncatePath(node.dir);

  const badge = el.querySelector('.status-badge');
  badge.className = 'status-badge ' + (node.launched ? 'badge-launched' : 'badge-not-launched');
  badge.textContent = node.launched ? '● 运行中' : '● 未启动';

  const btn = el.querySelector('.agent-launch-btn');
  btn.textContent = node.launched ? '↗ 重新在终端启动' : '▶ 启动 Agent';
  btn.className   = 'agent-launch-btn' + (node.launched ? ' launched' : '');
}

function buildAgentEl(node) {
  const el = document.createElement('div');
  el.className    = 'agent-node';
  el.dataset.id   = node.id;
  el.dataset.type = 'agent';
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
    <div class="agent-body">
      <div class="agent-dir">${escHtml(truncatePath(node.dir))}</div>
      <div class="agent-meta">
        <span class="model-badge">${escHtml(node.model)}</span>
        <span class="status-badge ${node.launched ? 'badge-launched' : 'badge-not-launched'}">
          ${node.launched ? '● 运行中' : '● 未启动'}
        </span>
      </div>
      <button class="agent-launch-btn${node.launched ? ' launched' : ''}">
        ${node.launched ? '↗ 重新在终端启动' : '▶ 启动 Agent'}
      </button>
    </div>`;

  wireNodeEvents(el, node.id, 'agent');
  return el;
}

// ════════════════════════════════════════════════════
// NODE EVENT WIRING
// ════════════════════════════════════════════════════
function wireNodeEvents(el, nodeId, nodeType) {
  const header = el.querySelector('[data-drag]');

  // ── Drag (header, not buttons) ───────────────────
  header.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    startDrag(e, nodeId);
  });

  // ── Double-click to rename ───────────────────────
  header.querySelector('.node-label').addEventListener('dblclick', e => {
    e.stopPropagation();
    beginRename(nodeId, e.currentTarget);
  });

  // ── Delete button ────────────────────────────────
  el.querySelector('.delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    api('DELETE', `/api/node/${nodeId}`).catch(err => alert(err.message));
  });

  // ── "+ Agent" button (workspace) ────────────────
  const addBtn = el.querySelector('.add-agent-btn');
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ws = state.nodes.find(n => n.id === nodeId);
      api('POST', '/api/agent', {
        x: ws.x + 20, y: ws.y + 60, workspaceId: nodeId
      }).catch(console.error);
    });
  }

  // ── Launch button (agent) ────────────────────────
  const launchBtn = el.querySelector('.agent-launch-btn');
  if (launchBtn) {
    launchBtn.addEventListener('click', e => {
      e.stopPropagation();
      launchBtn.disabled = true;
      launchBtn.textContent = '启动中…';
      api('POST', `/api/agent/${nodeId}/launch`)
        .catch(err => alert('启动失败：' + err.message))
        .finally(() => { launchBtn.disabled = false; });
    });
  }

  // ── Right-click context menu on node ────────────
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    openCtxMenu(e.clientX, e.clientY, nodeId, nodeType);
  });

  // ── Stop propagation so canvas pan doesn't trigger
  el.addEventListener('mousedown', e => e.stopPropagation());
}

// ════════════════════════════════════════════════════
// DRAG & DROP
// ════════════════════════════════════════════════════
function startDrag(e, nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  draggingId = nodeId;
  drag = {
    nodeId,
    startMX: e.clientX, startMY: e.clientY,
    startNX: node.x,    startNY: node.y
  };
  document.addEventListener('mousemove', onDragMove, { passive: true });
  document.addEventListener('mouseup',   onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.startMX) / camera.scale;
  const dy = (e.clientY - drag.startMY) / camera.scale;
  const nx = drag.startNX + dx;
  const ny = drag.startNY + dy;

  // Move the node's DOM element immediately
  const el = document.querySelector(`[data-id="${drag.nodeId}"]`);
  if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }

  // Move workspace children visually too
  const node = state.nodes.find(n => n.id === drag.nodeId);
  if (node && node.type === 'workspace') {
    const ddx = nx - node.x, ddy = ny - node.y;
    state.nodes.forEach(n => {
      if (n.workspaceId === drag.nodeId) {
        const cel = document.querySelector(`[data-id="${n.id}"]`);
        if (cel) {
          cel.style.left = (n.x + ddx) + 'px';
          cel.style.top  = (n.y + ddy) + 'px';
        }
      }
    });
  }
}

function onDragEnd(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.startMX) / camera.scale;
  const dy = (e.clientY - drag.startMY) / camera.scale;

  api('PATCH', `/api/node/${drag.nodeId}`, {
    x: drag.startNX + dx,
    y: drag.startNY + dy
  }).catch(console.error);

  drag = null;
  draggingId = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup',   onDragEnd);
}

// ════════════════════════════════════════════════════
// RENAME
// ════════════════════════════════════════════════════
function beginRename(nodeId, labelSpan) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const input = document.createElement('input');
  input.className = 'node-label-input';
  input.value = node.name;
  labelSpan.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newName = input.value.trim() || node.name;
    // Restore span immediately (optimistic)
    const span = document.createElement('span');
    span.className = labelSpan.className;
    span.textContent = newName;
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
// CONTEXT MENU
// ════════════════════════════════════════════════════
function openCtxMenu(sx, sy, nodeId, nodeType) {
  const world = screenToWorld(sx, sy);

  // Find if we're over a workspace (for canvas right-click)
  let wsId = null;
  if (nodeType === 'workspace') {
    wsId = nodeId;
  } else if (!nodeId) {
    state.nodes.filter(n => n.type === 'workspace').forEach(ws => {
      if (world.x >= ws.x && world.x <= ws.x + ws.w &&
          world.y >= ws.y && world.y <= ws.y + ws.h) {
        wsId = ws.id;
      }
    });
  }

  ctxTarget = { nodeId, nodeType, worldX: world.x, worldY: world.y, wsId };

  // Show/hide items based on context
  const hasNode = !!nodeId;
  document.getElementById('ctx-rename').style.display   = hasNode ? '' : 'none';
  document.getElementById('ctx-delete').style.display   = hasNode ? '' : 'none';
  document.getElementById('ctx-sep-node').style.display = hasNode ? '' : 'none';

  const agentInWsItem = document.querySelector('[data-action="new-agent-in-ws"]');
  agentInWsItem.style.display = wsId ? '' : 'none';

  const menu = document.getElementById('ctx-menu');
  // Position before showing to avoid flash
  const W = window.innerWidth, H = window.innerHeight;
  const mw = 195, mh = 170;
  menu.style.left = (sx + mw > W ? sx - mw : sx) + 'px';
  menu.style.top  = (sy + mh > H ? sy - mh : sy) + 'px';
  menu.style.display = 'block';
}

function closeCtxMenu() {
  document.getElementById('ctx-menu').style.display = 'none';
  ctxTarget = null;
}

document.getElementById('ctx-menu').addEventListener('click', e => {
  const li = e.target.closest('li[data-action]');
  if (!li || !ctxTarget) return;
  const { action }    = li.dataset;
  const { nodeId, nodeType, worldX, worldY, wsId } = ctxTarget;
  closeCtxMenu();

  switch (action) {
    case 'new-workspace':
      api('POST', '/api/workspace', { x: worldX, y: worldY }).catch(console.error);
      break;
    case 'new-agent':
      api('POST', '/api/agent', { x: worldX, y: worldY, workspaceId: wsId }).catch(console.error);
      break;
    case 'new-agent-in-ws': {
      const ws = state.nodes.find(n => n.id === wsId);
      api('POST', '/api/agent', {
        x: ws ? ws.x + 20 : worldX,
        y: ws ? ws.y + 60 : worldY,
        workspaceId: wsId
      }).catch(console.error);
      break;
    }
    case 'rename':
      if (nodeId) {
        const lbl = document.querySelector(`[data-id="${nodeId}"] .node-label`);
        if (lbl) beginRename(nodeId, lbl);
      }
      break;
    case 'delete':
      if (nodeId) api('DELETE', `/api/node/${nodeId}`).catch(err => alert(err.message));
      break;
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
  const rect   = container.getBoundingClientRect();
  const mx     = e.clientX - rect.left;
  const my     = e.clientY - rect.top;
  const factor = Math.pow(1.001, -e.deltaY);
  const ns     = Math.min(4, Math.max(0.08, camera.scale * factor));
  camera.x     = mx - (mx - camera.x) * (ns / camera.scale);
  camera.y     = my - (my - camera.y) * (ns / camera.scale);
  camera.scale = ns;
  applyTransform();
  showZoomBadge();
  saveCameraDebounced();
}, { passive: false });

container.addEventListener('contextmenu', e => {
  e.preventDefault();
  openCtxMenu(e.clientX, e.clientY, null, null);
});

// Close menu on outside click or Escape
document.addEventListener('click',   e => { if (!e.target.closest('#ctx-menu')) closeCtxMenu(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCtxMenu();
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
  btn.disabled = true;
  btn.textContent = '正在初始化…';
  try {
    await api('POST', '/api/init', { rootDir });
    // showApp() will be triggered by WS broadcast
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false;
    btn.textContent = '进入画布 →';
  }
});

document.getElementById('root-dir-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('start-btn').click();
});

document.getElementById('browse-btn').addEventListener('click', () => {
  const cur = document.getElementById('root-dir-input').value;
  const p = prompt('输入工作目录的完整路径：', cur || '/Users/');
  if (p !== null) document.getElementById('root-dir-input').value = p.trim();
});

// ════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════
function truncatePath(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-2).join('/');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════
connectWS();
