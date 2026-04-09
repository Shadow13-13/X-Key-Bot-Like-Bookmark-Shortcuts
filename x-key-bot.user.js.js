// ==UserScript==
// @name         X Key Bot — Like & Bookmark Shortcuts
// @namespace    https://x.com/
// @version      1.1.0
// @description  Assign custom hotkeys to like/unlike and bookmark/unbookmark posts on X (Twitter). Draggable button snaps to any screen edge.
// @author       Claude
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const SELECTORS = {
    tweet:          'article[data-testid="tweet"]',
    like:           '[data-testid="like"]',
    unlike:         '[data-testid="unlike"]',
    bookmark:       '[data-testid="bookmark"]',
    removeBookmark: '[data-testid="removeBookmark"]',
  };

  const STORAGE_KEY_LIKE     = 'xbot_like_key';
  const STORAGE_KEY_BOOKMARK = 'xbot_bookmark_key';
  const STORAGE_KEY_FAB_POS  = 'xbot_fab_position';
  const DEFAULT_LIKE_KEY     = 'l';
  const DEFAULT_BOOKMARK_KEY = 'b';
  const FAB_SIZE             = 46;
  const EDGE_MARGIN          = 20; // px gap from screen edge after snapping

  // ─── State ────────────────────────────────────────────────────────────────
  let likeKey        = GM_getValue(STORAGE_KEY_LIKE,     DEFAULT_LIKE_KEY);
  let bookmarkKey    = GM_getValue(STORAGE_KEY_BOOKMARK, DEFAULT_BOOKMARK_KEY);
  let settingsOpen   = false;
  let capturingFor   = null;
  let lastActionTime = 0;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function getFocusedTweet() {
    const articles = [...document.querySelectorAll(SELECTORS.tweet)];
    if (!articles.length) return null;
    const mid = window.innerHeight / 2;
    let closest = null, minDist = Infinity;
    for (const el of articles) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const dist = Math.abs((rect.top + rect.bottom) / 2 - mid);
      if (dist < minDist) { minDist = dist; closest = el; }
    }
    return closest;
  }

  function toggleLike(tweet) {
    const btn = tweet.querySelector(SELECTORS.like) || tweet.querySelector(SELECTORS.unlike);
    if (btn) {
      btn.click();
      showToast(tweet.querySelector(SELECTORS.unlike) ? '❤️  Liked' : '🤍  Unliked');
    }
  }

  function toggleBookmark(tweet) {
    const btn = tweet.querySelector(SELECTORS.bookmark) || tweet.querySelector(SELECTORS.removeBookmark);
    if (btn) {
      btn.click();
      showToast(tweet.querySelector(SELECTORS.removeBookmark) ? '🔖  Bookmarked' : '📄  Bookmark removed');
    }
  }

  function debounced(fn) {
    const now = Date.now();
    if (now - lastActionTime < 400) return;
    lastActionTime = now;
    fn();
  }

  function keyLabel(e) {
    const mods = [];
    if (e.ctrlKey)  mods.push('Ctrl');
    if (e.altKey)   mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey)  mods.push('Meta');
    mods.push(e.key === ' ' ? 'Space' : e.key);
    return mods.join('+');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ─── Key Listener ─────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (capturingFor) {
      e.preventDefault();
      e.stopPropagation();
      const label = keyLabel(e);
      if (capturingFor === 'like') {
        likeKey = label;
        GM_setValue(STORAGE_KEY_LIKE, label);
        document.getElementById('xbot-like-key-display').textContent = label;
      } else {
        bookmarkKey = label;
        GM_setValue(STORAGE_KEY_BOOKMARK, label);
        document.getElementById('xbot-bookmark-key-display').textContent = label;
      }
      capturingFor = null;
      updateCaptureUI();
      return;
    }
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    const pressed = keyLabel(e);
    if (pressed === likeKey)
      debounced(() => { const t = getFocusedTweet(); t ? toggleLike(t)     : showToast('⚠️  No post detected'); });
    if (pressed === bookmarkKey)
      debounced(() => { const t = getFocusedTweet(); t ? toggleBookmark(t) : showToast('⚠️  No post detected'); });
  }, true);

  // ─── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let toast = document.getElementById('xbot-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'xbot-toast';
      Object.assign(toast.style, {
        position: 'fixed', bottom: '88px', left: '50%',
        transform: 'translateX(-50%) translateY(12px)',
        background: '#0f172a', color: '#f1f5f9',
        fontFamily: '"DM Mono","Fira Code",monospace',
        fontSize: '13px', fontWeight: '500',
        padding: '10px 20px', borderRadius: '99px',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        zIndex: '999999', pointerEvents: 'none', opacity: '0',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        whiteSpace: 'nowrap', letterSpacing: '0.02em',
      });
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    clearTimeout(toast._hideTimer);
    void toast.offsetWidth;
    Object.assign(toast.style, { opacity: '1', transform: 'translateX(-50%) translateY(0)' });
    toast._hideTimer = setTimeout(() => {
      Object.assign(toast.style, { opacity: '0', transform: 'translateX(-50%) translateY(12px)' });
    }, 1800);
  }

  // ─── Drag & Edge-Snap ─────────────────────────────────────────────────────
  /*
   * FAB position is persisted as { edge: 'top'|'bottom'|'left'|'right', offset: number }
   * where `offset` is the distance along that edge from the top-left corner.
   * This keeps the button sensibly placed after window resizes.
   */
  function loadFabPos() {
    try {
      const raw = GM_getValue(STORAGE_KEY_FAB_POS, null);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Default: bottom-right
    return { edge: 'right', offset: window.innerHeight - FAB_SIZE - EDGE_MARGIN * 2 };
  }

  function saveFabPos(pos) {
    GM_setValue(STORAGE_KEY_FAB_POS, JSON.stringify(pos));
  }

  /** Convert edge-based position to pixel { left, top }. */
  function edgePosToPixels(pos) {
    const W = window.innerWidth, H = window.innerHeight;
    switch (pos.edge) {
      case 'top':    return { left: clamp(pos.offset, EDGE_MARGIN, W - FAB_SIZE - EDGE_MARGIN), top: EDGE_MARGIN };
      case 'bottom': return { left: clamp(pos.offset, EDGE_MARGIN, W - FAB_SIZE - EDGE_MARGIN), top: H - FAB_SIZE - EDGE_MARGIN };
      case 'left':   return { left: EDGE_MARGIN, top: clamp(pos.offset, EDGE_MARGIN, H - FAB_SIZE - EDGE_MARGIN) };
      case 'right':  return { left: W - FAB_SIZE - EDGE_MARGIN, top: clamp(pos.offset, EDGE_MARGIN, H - FAB_SIZE - EDGE_MARGIN) };
    }
  }

  /** Given pixel { left, top }, find the nearest edge + offset. */
  function pixelsToEdgePos(left, top) {
    const W = window.innerWidth, H = window.innerHeight;
    const cx = left + FAB_SIZE / 2, cy = top + FAB_SIZE / 2;
    const dists = { top: cy, bottom: H - cy, left: cx, right: W - cx };
    const edge  = Object.entries(dists).sort((a, b) => a[1] - b[1])[0][0];
    const offset = (edge === 'top' || edge === 'bottom') ? left : top;
    return { edge, offset };
  }

  function applyFabPos(fab, pos) {
    const { left, top } = edgePosToPixels(pos);
    fab.style.left   = left + 'px';
    fab.style.top    = top  + 'px';
    fab.style.right  = 'auto';
    fab.style.bottom = 'auto';
  }

  /** Position the settings panel so it opens inward from wherever the FAB is. */
  function repositionPanel() {
    const fab   = document.getElementById('xbot-fab');
    const panel = document.getElementById('xbot-panel');
    if (!panel || panel.style.display === 'none' || !fab) return;

    const r       = fab.getBoundingClientRect();
    const panelW  = 320;
    const panelH  = panel.offsetHeight || 230;
    const W       = window.innerWidth, H = window.innerHeight;
    const GAP     = 12;

    // Horizontal centre on FAB, clamp to screen
    let left = r.left + FAB_SIZE / 2 - panelW / 2;
    // Open above if FAB is in the lower half, below otherwise
    let top  = r.top > H / 2 ? r.top - panelH - GAP : r.bottom + GAP;

    left = clamp(left, 8, W - panelW - 8);
    top  = clamp(top,  8, H - panelH - 8);

    panel.style.left   = left + 'px';
    panel.style.top    = top  + 'px';
    panel.style.bottom = 'auto';
    panel.style.right  = 'auto';
  }

  // ─── Edge Guides (shown while dragging) ───────────────────────────────────
  const EDGES = ['top', 'bottom', 'left', 'right'];

  function ensureEdgeGuides() {
    EDGES.forEach(edge => {
      if (!document.getElementById(`xbot-guide-${edge}`)) {
        const g = document.createElement('div');
        g.id        = `xbot-guide-${edge}`;
        g.className = 'xbot-edge-guide';
        document.body.appendChild(g);
      }
    });
  }

  function updateEdgeGuides(fabLeft, fabTop) {
    ensureEdgeGuides();
    const nearest = pixelsToEdgePos(fabLeft, fabTop).edge;
    EDGES.forEach(edge => {
      const g = document.getElementById(`xbot-guide-${edge}`);
      if (g) {
        g.style.display = 'block';
        g.style.opacity  = edge === nearest ? '1' : '0.2';
      }
    });
  }

  function hideEdgeGuides() {
    EDGES.forEach(edge => {
      const g = document.getElementById(`xbot-guide-${edge}`);
      if (g) g.style.display = 'none';
    });
  }

  // ─── Drag Label ───────────────────────────────────────────────────────────
  function setDragHint(visible) {
    let hint = document.getElementById('xbot-drag-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'xbot-drag-hint';
      Object.assign(hint.style, {
        position: 'fixed', top: '14px', left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(15,23,42,0.9)', color: '#94a3b8',
        fontFamily: '"DM Mono","Fira Code",monospace',
        fontSize: '11px', padding: '5px 14px', borderRadius: '99px',
        border: '1px solid rgba(255,255,255,0.08)',
        zIndex: '9999999', pointerEvents: 'none',
        opacity: '0', transition: 'opacity 0.2s ease',
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
      });
      hint.textContent = 'Release to snap to nearest edge';
      document.body.appendChild(hint);
    }
    hint.style.opacity = visible ? '1' : '0';
  }

  // ─── Draggable FAB ────────────────────────────────────────────────────────
  function makeDraggable(fab) {
    let dragging  = false;
    let dragMoved = false;
    let startX, startY, origLeft, origTop;
    let holdTimer = null;

    function beginDrag(cx, cy) {
      const r  = fab.getBoundingClientRect();
      startX   = cx; startY = cy;
      origLeft = r.left; origTop = r.top;
      dragMoved = false;

      holdTimer = setTimeout(() => {
        dragging = true;
        Object.assign(fab.style, {
          cursor:     'grabbing',
          transition: 'none',
          transform:  'scale(1.14)',
          boxShadow:  '0 12px 40px rgba(29,155,240,0.8)',
        });
        setDragHint(true);
      }, 150);
    }

    function moveDrag(cx, cy) {
      if (!dragging) return;
      const dx = cx - startX, dy = cy - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      const W = window.innerWidth, H = window.innerHeight;
      const nl = clamp(origLeft + dx, 0, W - FAB_SIZE);
      const nt = clamp(origTop  + dy, 0, H - FAB_SIZE);
      fab.style.left = nl + 'px';
      fab.style.top  = nt + 'px';
      updateEdgeGuides(nl, nt);
      if (settingsOpen) repositionPanel();
    }

    function endDrag() {
      clearTimeout(holdTimer);
      if (!dragging) return;
      dragging = false;

      Object.assign(fab.style, {
        cursor:     'pointer',
        transform:  'scale(1)',
        boxShadow:  '0 4px 20px rgba(29,155,240,0.5)',
      });
      setDragHint(false);
      hideEdgeGuides();

      // Snap to nearest edge
      const r   = fab.getBoundingClientRect();
      const pos = pixelsToEdgePos(r.left, r.top);
      saveFabPos(pos);

      const { left, top } = edgePosToPixels(pos);
      fab.style.transition = 'left 0.32s cubic-bezier(0.34,1.56,0.64,1), top 0.32s cubic-bezier(0.34,1.56,0.64,1), transform 0.2s ease, box-shadow 0.2s ease';
      fab.style.left = left + 'px';
      fab.style.top  = top  + 'px';

      setTimeout(() => {
        fab.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease';
        if (settingsOpen) repositionPanel();
      }, 350);

      // Block the click event that fires right after mouseup when dragging
      if (dragMoved) {
        fab.addEventListener('click', e => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true });
      }
    }

    // ── Mouse ──
    fab.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      beginDrag(e.clientX, e.clientY);
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup',   () => endDrag());

    // ── Touch ──
    let touchId = null;
    fab.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      touchId = e.touches[0].identifier;
      beginDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      const t = [...e.changedTouches].find(x => x.identifier === touchId);
      if (t) { moveDrag(t.clientX, t.clientY); e.preventDefault(); }
    }, { passive: false });

    document.addEventListener('touchend', e => {
      if ([...e.changedTouches].some(x => x.identifier === touchId)) endDrag();
    });
  }

  // ─── Settings Panel ───────────────────────────────────────────────────────
  function buildSettingsPanel() {
    // Font
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700&display=swap';
    document.head.appendChild(link);

    // ── FAB button ──
    const fab = document.createElement('button');
    fab.id    = 'xbot-fab';
    fab.title = 'X Key Bot — drag to move, click to open settings';
    fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`;
    Object.assign(fab.style, {
      position:       'fixed',
      width:          FAB_SIZE + 'px',
      height:         FAB_SIZE + 'px',
      borderRadius:   '50%',
      background:     'linear-gradient(135deg,#1d9bf0 0%,#0a5fa0 100%)',
      border:         'none',
      color:          '#fff',
      cursor:         'pointer',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      boxShadow:      '0 4px 20px rgba(29,155,240,0.5)',
      zIndex:         '999998',
      transition:     'transform 0.2s ease, box-shadow 0.2s ease',
      userSelect:     'none',
      touchAction:    'none',
    });
    applyFabPos(fab, loadFabPos());
    fab.addEventListener('mouseenter', () => { if (fab.style.cursor !== 'grabbing') { fab.style.transform = 'scale(1.1)'; fab.style.boxShadow = '0 6px 28px rgba(29,155,240,0.7)'; } });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; fab.style.boxShadow = '0 4px 20px rgba(29,155,240,0.5)'; });
    fab.addEventListener('click', toggleSettings);
    document.body.appendChild(fab);
    makeDraggable(fab);

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'xbot-panel';
    panel.innerHTML = `
      <div id="xbot-header">
        <span id="xbot-title">⌨️ X Key Bot</span>
        <button id="xbot-close" title="Close">✕</button>
      </div>
      <p id="xbot-subtitle">Hotkeys target the post nearest screen center.<br>Drag the ⭐ button anywhere — it snaps to the nearest edge.</p>
      <div class="xbot-row">
        <div class="xbot-label"><span class="xbot-icon">❤️</span><span>Like / Unlike</span></div>
        <div class="xbot-controls">
          <kbd id="xbot-like-key-display">${likeKey}</kbd>
          <button class="xbot-assign-btn" data-target="like">Reassign</button>
        </div>
      </div>
      <div class="xbot-row">
        <div class="xbot-label"><span class="xbot-icon">🔖</span><span>Bookmark / Remove</span></div>
        <div class="xbot-controls">
          <kbd id="xbot-bookmark-key-display">${bookmarkKey}</kbd>
          <button class="xbot-assign-btn" data-target="bookmark">Reassign</button>
        </div>
      </div>
      <div id="xbot-capture-notice">Press any key (or combo)…</div>
      <div id="xbot-tip">💡 Supports modifier combos like Shift+L or Alt+B.</div>
    `;

    // ── Styles ──
    const style = document.createElement('style');
    style.textContent = `
      #xbot-panel {
        position:fixed; width:320px;
        background:#0c0e12;
        border:1px solid rgba(255,255,255,0.1); border-radius:16px;
        padding:20px 22px 18px;
        box-shadow:0 24px 64px rgba(0,0,0,0.7),0 0 0 1px rgba(29,155,240,0.15);
        z-index:999997;
        font-family:'DM Mono','Fira Code',monospace; color:#e2e8f0;
        display:none;
      }
      #xbot-panel.xbot-anim { animation:xbot-slide-in 0.25s cubic-bezier(0.34,1.56,0.64,1) both; }
      @keyframes xbot-slide-in { from{opacity:0;transform:translateY(10px) scale(0.96)} to{opacity:1;transform:translateY(0) scale(1)} }
      #xbot-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
      #xbot-title  { font-family:'Syne',sans-serif; font-weight:700; font-size:15px; color:#f8fafc; letter-spacing:-0.02em; }
      #xbot-close  { background:rgba(255,255,255,0.06); border:none; color:#94a3b8; cursor:pointer; width:26px; height:26px; border-radius:50%; font-size:12px; display:flex; align-items:center; justify-content:center; transition:background 0.15s,color 0.15s; }
      #xbot-close:hover { background:rgba(255,255,255,0.12); color:#f1f5f9; }
      #xbot-subtitle { font-size:11px; color:#64748b; margin:0 0 18px; line-height:1.6; }
      .xbot-row  { display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06); }
      .xbot-row:last-of-type { border-bottom:none; }
      .xbot-label { display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1; letter-spacing:0.02em; }
      .xbot-icon  { font-size:15px; }
      .xbot-controls { display:flex; align-items:center; gap:8px; }
      #xbot-panel kbd { display:inline-block; background:#1e293b; border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:3px 10px; font-family:'DM Mono',monospace; font-size:12px; color:#1d9bf0; min-width:38px; text-align:center; box-shadow:0 2px 0 rgba(0,0,0,0.4); letter-spacing:0.04em; }
      .xbot-assign-btn { background:rgba(29,155,240,0.12); border:1px solid rgba(29,155,240,0.3); border-radius:6px; color:#1d9bf0; font-family:'DM Mono',monospace; font-size:11px; padding:4px 10px; cursor:pointer; transition:background 0.15s,border-color 0.15s; letter-spacing:0.03em; }
      .xbot-assign-btn:hover { background:rgba(29,155,240,0.22); border-color:rgba(29,155,240,0.5); }
      .xbot-assign-btn.capturing { background:rgba(239,68,68,0.15); border-color:rgba(239,68,68,0.4); color:#f87171; animation:xbot-pulse 0.8s ease infinite; }
      @keyframes xbot-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
      #xbot-capture-notice { text-align:center; font-size:11px; color:#f87171; margin-top:10px; min-height:16px; letter-spacing:0.04em; display:none; }
      #xbot-tip { margin-top:14px; font-size:11px; color:#475569; line-height:1.6; background:rgba(255,255,255,0.03); border-radius:8px; padding:8px 10px; }

      /* Edge guides */
      .xbot-edge-guide {
        position:fixed; pointer-events:none; display:none;
        z-index:999990; transition:opacity 0.12s ease;
        background:rgba(29,155,240,0.12);
        border:1.5px dashed rgba(29,155,240,0.45);
      }
      #xbot-guide-top    { top:0;    left:0; right:0;   height:${EDGE_MARGIN*2+FAB_SIZE}px; border-radius:0 0 12px 12px; }
      #xbot-guide-bottom { bottom:0; left:0; right:0;   height:${EDGE_MARGIN*2+FAB_SIZE}px; border-radius:12px 12px 0 0; }
      #xbot-guide-left   { left:0;   top:0;  bottom:0;  width:${EDGE_MARGIN*2+FAB_SIZE}px;  border-radius:0 12px 12px 0; }
      #xbot-guide-right  { right:0;  top:0;  bottom:0;  width:${EDGE_MARGIN*2+FAB_SIZE}px;  border-radius:12px 0 0 12px; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    panel.querySelector('#xbot-close').addEventListener('click', toggleSettings);
    panel.querySelectorAll('.xbot-assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        capturingFor = (capturingFor === btn.dataset.target) ? null : btn.dataset.target;
        updateCaptureUI();
      });
    });

    window.addEventListener('resize', () => {
      applyFabPos(document.getElementById('xbot-fab'), loadFabPos());
      if (settingsOpen) repositionPanel();
    });
  }

  function toggleSettings() {
    settingsOpen = !settingsOpen;
    const panel = document.getElementById('xbot-panel');
    if (settingsOpen) {
      panel.classList.remove('xbot-anim');
      panel.style.display = 'block';
      void panel.offsetWidth;
      panel.classList.add('xbot-anim');
      repositionPanel();
    } else {
      panel.style.display = 'none';
      capturingFor = null;
      updateCaptureUI();
    }
  }

  function updateCaptureUI() {
    const notice = document.getElementById('xbot-capture-notice');
    document.querySelectorAll('.xbot-assign-btn').forEach(btn => {
      const active = capturingFor && btn.dataset.target === capturingFor;
      btn.classList.toggle('capturing', active);
      btn.textContent = active ? 'Cancel' : 'Reassign';
    });
    if (notice) {
      notice.style.display = capturingFor ? 'block' : 'none';
      if (capturingFor) notice.textContent = `Press any key to assign to "${capturingFor}"…`;
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSettingsPanel);
  } else {
    buildSettingsPanel();
  }

})();