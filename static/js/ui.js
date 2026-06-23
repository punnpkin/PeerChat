// PeerChat - UI helpers: timeline messages, status, toast, scroll
(function () {
  'use strict';

  const { state, escapeHtml, escapeAttr, formatSize, shortTime } = window.PeerChat;

  // DOM refs
  const els = {
    statusDot: null,
    statusText: null,
    statusIndicator: null,
    peerNameLabel: null,
    messagesEl: null,
    newMsgBar: null,
    imgModal: null,
    imgModalImg: null,
    toasts: null,
  };

  // Timeline state: track the last "group" (avatar row + message block)
  // so that we can append to it when the same user continues chatting.
  const MAX_PER_GROUP = 5; // continuous messages per group before split
  const MAX_LINES_PER_MSG = 5; // single message > N lines forces a "sub-split" (still in one bubble but visually distinct)
  let lastGroup = null; // { senderKey: 'me' | 'peer:<nick>', countInGroup, containerEl, firstTs }

  // ---- Tab 未读消息标题闪烁 ----
  let baseTitle = document.title || 'PeerChat';   // 页面原始标题，用于切回 tab 后恢复
  let unreadCount = 0;                             // 切换到后台后收到的新消息数
  function updateTitle() {
    if (unreadCount > 0) {
      document.title = `（${unreadCount} 条新消息）${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }
  function notifyIncoming() {
    // 仅当用户不在当前 tab 时才累加未读数，避免聊天时也改标题
    if (document.hidden || document.visibilityState === 'hidden') {
      unreadCount++;
      updateTitle();
    }
  }
  function initTabNotification() {
    baseTitle = document.title || 'PeerChat';
    // 用户切回 tab 时清空未读，恢复原始标题
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        unreadCount = 0;
        updateTitle();
      }
    });
  }

  // ---- Tab 未读消息标题闪烁 ----
  let baseTitle = document.title || 'PeerChat';   // 页面原始标题，用于切回 tab 后恢复
  let unreadCount = 0;                             // 切换到后台后收到的新消息数
  function updateTitle() {
    if (unreadCount > 0) {
      document.title = `（${unreadCount} 条新消息）${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
  }
  function notifyIncoming() {
    // 仅当用户不在当前 tab 时才累加未读数，避免聊天时也改标题
    if (document.hidden || document.visibilityState === 'hidden') {
      unreadCount++;
      updateTitle();
    }
  }
  function initTabNotification() {
    baseTitle = document.title || 'PeerChat';
    // 用户切回 tab 时清空未读，恢复原始标题
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        unreadCount = 0;
        updateTitle();
      }
    });
  }

  function cacheDOM() {
    els.statusDot = document.getElementById('status-dot');
    els.statusText = document.getElementById('status-text');
    els.statusIndicator = document.getElementById('status-indicator');
    els.peerNameLabel = document.getElementById('peer-name-label');
    els.messagesEl = document.getElementById('messages');
    els.newMsgBar = document.getElementById('new-msg-bar');
    els.imgModal = document.getElementById('img-modal');
    els.imgModalImg = document.getElementById('img-modal-img');
    els.toasts = document.getElementById('toasts');
  }

  function setStatus(kind) {
    els.statusIndicator.classList.remove('bg-slate-100', 'bg-amber-50', 'bg-emerald-50');
    els.statusIndicator.classList.remove('text-slate-600', 'text-amber-700', 'text-emerald-700');
    els.statusDot.classList.remove('bg-slate-400', 'bg-amber-500', 'bg-emerald-500', 'pulse-dot');
    if (kind === 'offline') {
      els.statusIndicator.classList.add('bg-slate-100', 'text-slate-600');
      els.statusDot.classList.add('bg-slate-400');
      els.statusText.textContent = '未连接';
    } else if (kind === 'waiting') {
      els.statusIndicator.classList.add('bg-amber-50', 'text-amber-700');
      els.statusDot.classList.add('bg-amber-500', 'pulse-dot');
      els.statusText.textContent = '等待连接';
    } else if (kind === 'connected') {
      els.statusIndicator.classList.add('bg-emerald-50', 'text-emerald-700');
      els.statusDot.classList.add('bg-emerald-500');
      els.statusText.textContent = '已连接';
    }
  }

  function setHeaderConnected(name) { els.peerNameLabel.textContent = name; }
  function setHeaderWaiting(text) { els.peerNameLabel.textContent = text; }

  function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    const colors = {
      info: 'bg-slate-800 text-white',
      success: 'bg-emerald-600 text-white',
      error: 'bg-red-600 text-white',
    };
    el.className = `pointer-events-auto toast-in text-sm font-medium rounded-full px-4 py-1.5 shadow-md ${colors[type] || colors.info}`;
    el.textContent = msg;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }

  function showEntryError(msg) {
    const el = document.getElementById('entry-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideEntryError() {
    const el = document.getElementById('entry-error');
    if (!el) return;
    el.classList.add('hidden');
  }

  // ============ Helpers ============
  function getInitial(name) {
    if (!name) return '?';
    const s = name.trim();
    if (!s) return '?';
    const ch = Array.from(s)[0];
    return ch.toUpperCase();
  }

  // Avatar palette — expanded from original 8 with a few more nice tones.
  // All still cool/dark enough to pair well with white text.
  const AVATAR_PALETTE = [
    '#5b6fe8', // brand primary
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#8b5cf6', // violet-500
    '#06b6d4', // cyan-500
    '#ec4899', // pink-500
    '#64748b', // slate-500 (grey)
    '#14b8a6', // teal-500
    '#0ea5e9', // sky-500
    '#f97316', // orange-500
    '#6366f1', // indigo-500
  ];

  function simpleHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Partition the palette into two non-overlapping halves:
  // "me" draws from the first half, "peer" from the second half —
  // this guarantees the two parties in a chat never share a color.
  function avatarColor(name, role) {
    const n = (name || '').trim() || '?';
    const h = simpleHash(n);
    const half = Math.ceil(AVATAR_PALETTE.length / 2);
    if (role === 'me') {
      return AVATAR_PALETTE[h % half];
    } else {
      return AVATAR_PALETTE[half + (h % (AVATAR_PALETTE.length - half))];
    }
  }

  // Count visual lines for a piece of text (approx: split by newline + wrap estimate based on container width)
  function countNewlines(text) {
    if (!text) return 0;
    const m = text.match(/\n/g);
    return m ? m.length : 0;
  }

  // Convert plain text to HTML lines — preserving newlines as <br/>
  function renderTextLines(text) {
    // We want the rendered content to keep the indentation from the parent padding (we use pre-wrap).
    return escapeHtml(text).replace(/\n/g, '<br/>');
  }

  // Build a timeline group: [ avatar + name/time ]   [ message block ]
  function buildGroup({ senderKey, nickname, ts }) {
    const isMe = senderKey === 'me';
    const bgColor = avatarColor(nickname || '', isMe ? 'me' : 'peer');

    const wrap = document.createElement('div');
    wrap.className = 'timeline-group';
    wrap.dataset.senderKey = senderKey;
    wrap.dataset.countInGroup = '0';
    wrap.dataset.firstTs = String(ts || Date.now());

    // Row: avatar (column) + content (column)
    const row = document.createElement('div');
    row.className = 'flex gap-3 items-start';
    // Rounded-rectangle avatar (not a circle)
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'shrink-0 flex flex-col items-center pt-0.5';
    const avatar = document.createElement('div');
    avatar.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-semibold shadow-soft';
    avatar.style.backgroundColor = bgColor;
    avatar.textContent = getInitial(nickname);
    avatar.setAttribute('aria-label', nickname || '');
    avatarWrap.appendChild(avatar);

    // Right: content column
    const col = document.createElement('div');
    col.className = 'min-w-0 flex-1';

    // Header line: nickname · time
    const head = document.createElement('div');
    head.className = 'flex items-baseline gap-2 mb-1 text-xs';
    const nameEl = document.createElement('span');
    nameEl.className = 'font-semibold text-slate-700';
    nameEl.textContent = nickname || (isMe ? '我' : '对方');
    const timeEl = document.createElement('span');
    timeEl.className = 'text-slate-400 tabular-nums';
    timeEl.textContent = shortTime(ts || Date.now());
    head.appendChild(nameEl);
    head.appendChild(timeEl);

    // Message container — messages stack vertically; between messages: larger gap;
    // inside a message (soft wrap / newlines): smaller gap handled by line-height
    const msgContainer = document.createElement('div');
    msgContainer.className = 'msg-container';
    msgContainer.dataset.role = 'msg-container';

    col.appendChild(head);
    col.appendChild(msgContainer);

    row.appendChild(avatarWrap);
    row.appendChild(col);
    wrap.appendChild(row);

    return { wrap, msgContainer };
  }

  function currentSenderKey(fromMe, nickname) {
    return fromMe ? 'me' : `peer:${nickname || '?'}`;
  }

  // Returns a DOM element where message content should be injected.
  // When user keeps sending consecutively and group isn't full, reuse the group;
  // otherwise start a new group.
  function ensureMessageTarget(fromMe, nickname, ts) {
    const key = currentSenderKey(fromMe, nickname);

    if (lastGroup && lastGroup.senderKey === key && lastGroup.countInGroup < MAX_PER_GROUP) {
      lastGroup.countInGroup += 1;
      lastGroup.wrap.dataset.countInGroup = String(lastGroup.countInGroup);
      return { wrap: lastGroup.wrap, msgContainer: lastGroup.msgContainer, isNewGroup: false };
    }

    const { wrap, msgContainer } = buildGroup({ senderKey: key, nickname, ts });
    els.messagesEl.appendChild(wrap);
    lastGroup = {
      senderKey: key,
      countInGroup: 1,
      wrap,
      msgContainer,
      firstTs: ts || Date.now(),
    };
    wrap.dataset.countInGroup = '1';
    return { wrap, msgContainer, isNewGroup: true };
  }

  // Insert a text-message row into the container.
  // If the message has more than MAX_LINES_PER_MSG newlines, split into a multi-chunk presentation
  // with slightly larger internal spacing between chunks (visually "split" but still under same header).
  function insertTextContent(msgContainer, text) {
    const content = document.createElement('div');
    content.className = 'msg-body';

    if (!text) {
      msgContainer.appendChild(content);
      return content;
    }

    const lineCount = countNewlines(text) + 1;

    if (lineCount <= MAX_LINES_PER_MSG) {
      content.innerHTML = renderTextLines(text);
      msgContainer.appendChild(content);
      return content;
    }

    // Long message — split into chunks of roughly MAX_LINES_PER_MSG lines each.
    const lines = text.split('\n');
    let i = 0;
    let firstChunk = true;
    while (i < lines.length) {
      const chunk = document.createElement('div');
      chunk.className = 'msg-body' + (firstChunk ? '' : ' msg-body-split');
      const slice = lines.slice(i, i + MAX_LINES_PER_MSG).join('\n');
      chunk.innerHTML = renderTextLines(slice);
      msgContainer.appendChild(chunk);
      firstChunk = false;
      i += MAX_LINES_PER_MSG;
    }
    return content;
  }

  // ============ Public API ============

  function appendSystem(text) {
    const wrap = document.createElement('div');
    wrap.className = 'flex justify-center fade-in my-1';
    wrap.innerHTML = `<div class="text-xs text-slate-500 bg-white/60 border border-slate-200 rounded-full px-3 py-1 shadow-soft">${escapeHtml(text)}</div>`;
    els.messagesEl.appendChild(wrap);
    // system messages break the consecutive grouping
    lastGroup = null;
    maybeScrollToBottom();
  }

  function appendMessage({ fromMe = false, nickname, text = '', ts = Date.now() }) {
    const { msgContainer, isNewGroup } = ensureMessageTarget(fromMe, nickname, ts);
    insertTextContent(msgContainer, text);
    maybeScrollToBottom();
    if (!fromMe) notifyIncoming();  // 对方发来的消息 → 如果在后台就改标题
    return { isNewGroup };
  }

  // File / image placeholder — returns an element to be updated or swapped out.
  // For timeline we still treat each file as one "row" in the same group (same avatar header).
  function appendFilePlaceholder({ fromMe, name, size, isImage, nickname, ts }) {
    // Build target just like text messages
    const { msgContainer } = ensureMessageTarget(fromMe, nickname || (fromMe ? '我' : state.peerNickname), ts);
    if (!fromMe) notifyIncoming();  // 对方发来的文件/图片 → 如果在后台就改标题
    if (!fromMe) notifyIncoming();  // 对方发来的文件/图片 → 如果在后台就改标题

    const wrap = document.createElement('div');
    wrap.className = 'msg-body msg-file';

    // A single compact rounded box: icon | filename + progress | percent
    const card = document.createElement('div');
    card.className = 'file-card flex items-center gap-3 border border-slate-200 rounded-xl bg-white/70 px-3 py-2 shadow-soft max-w-md min-w-0';
    const iconSvg = isImage
      ? `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
      : `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    card.innerHTML = `
      <div class="shrink-0 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">${iconSvg}</div>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-slate-800 truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        <div class="flex items-center justify-between gap-2 mt-1.5">
          <div class="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div data-role="progress-bar" class="h-full bg-brand-500 transition-[width] duration-200" style="width:0%"></div>
          </div>
          <span data-role="progress-pct" class="shrink-0 text-xs text-slate-400 tabular-nums w-10 text-right">0%</span>
        </div>
        <div class="text-[11px] text-slate-400 tabular-nums mt-0.5" data-role="progress-size">0 B / ${formatSize(size)}</div>
      </div>
    `;
    wrap.appendChild(card);
    msgContainer.appendChild(wrap);
    maybeScrollToBottom();
    return wrap;
  }

  function updateFileProgress(wrap, received, size) {
    if (!wrap) return;
    const pct = Math.min(100, Math.floor((received / size) * 100));
    const bar = wrap.querySelector('[data-role="progress-bar"]');
    const pctEl = wrap.querySelector('[data-role="progress-pct"]');
    const sizeEl = wrap.querySelector('[data-role="progress-size"]');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (sizeEl) sizeEl.textContent = `${formatSize(received)} / ${formatSize(size)}`;
  }

  function renderFinalFile(wrap, { name, size, mimeType, isImage, url }) {
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.classList.remove('msg-file');

    // Image: keep the image preview as-is (user said "图片目前很好不用管"),
    // but replace the caption below with the same compact file-info box used for files.
    if (isImage) {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'msg-img max-w-[320px] sm:max-w-md max-h-96 rounded-lg cursor-zoom-in bg-slate-100';
      img.loading = 'lazy';
      img.addEventListener('click', () => openImgModal(url));
      img.addEventListener('load', () => maybeScrollToBottom(true));
      wrap.appendChild(img);

      const info = document.createElement('div');
      info.className = 'file-card flex items-center gap-3 border border-slate-200 rounded-xl bg-white/70 px-3 py-2 shadow-soft max-w-md min-w-0 mt-1.5';
      info.innerHTML = `
        <div class="shrink-0 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div class="min-w-0 flex-1 flex items-baseline gap-2">
          <span class="text-sm text-slate-800 truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
          <span class="shrink-0 text-xs text-slate-400 tabular-nums">${formatSize(size)}</span>
        </div>
        <a href="${url}" download="${escapeAttr(name)}" class="shrink-0 inline-flex items-center gap-1 text-xs font-medium rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2 py-1 transition">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          下载
        </a>
      `;
      wrap.appendChild(info);
    } else {
      // File: one compact rounded box — icon, filename + size (inline), download button.
      const card = document.createElement('div');
      card.className = 'file-card flex items-center gap-3 border border-slate-200 rounded-xl bg-white/70 px-3 py-2 shadow-soft max-w-md min-w-0';
      card.innerHTML = `
        <div class="shrink-0 w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="min-w-0 flex-1 flex items-baseline gap-2">
          <span class="text-sm text-slate-800 truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
          <span class="shrink-0 text-xs text-slate-400 tabular-nums">${formatSize(size)}</span>
        </div>
        <a href="${url}" download="${escapeAttr(name)}" class="shrink-0 inline-flex items-center gap-1 text-xs font-medium rounded-md bg-brand-600 hover:bg-brand-700 text-white px-2 py-1 transition">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          下载
        </a>
      `;
      wrap.appendChild(card);
    }
    maybeScrollToBottom(true);
  }

  // ============ Scroll ============
  function isNearBottom() {
    const threshold = 72;
    const el = els.messagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  // force: force scroll-to-bottom and mark "auto scroll on"
  // otherwise: only scroll when user has left the scroll near the bottom
  function maybeScrollToBottom(force) {
    if (force || state.autoScroll) {
      els.messagesEl.scrollTop = els.messagesEl.scrollHeight;
      if (force) state.autoScroll = true;
      els.newMsgBar.classList.add('hidden');
    } else {
      els.newMsgBar.classList.remove('hidden');
    }
  }

  function scrollToBottom(force) {
    els.messagesEl.scrollTop = els.messagesEl.scrollHeight;
    if (force) state.autoScroll = true;
    els.newMsgBar.classList.add('hidden');
  }

  function bindScroll() {
    els.messagesEl.addEventListener('scroll', () => {
      if (isNearBottom()) {
        state.autoScroll = true;
        els.newMsgBar.classList.add('hidden');
      } else {
        state.autoScroll = false;
      }
    });
  }

  // ============ Image modal ============
  function openImgModal(url) {
    els.imgModalImg.src = url;
    els.imgModal.classList.remove('hidden');
  }
  function closeImgModal() {
    els.imgModal.classList.add('hidden');
    els.imgModalImg.src = '';
  }
  function bindImgModal() {
    els.imgModal.addEventListener('click', closeImgModal);
  }

  // ============ Reset on new session ============
  function clearMessages() {
    els.messagesEl.innerHTML = '';
    lastGroup = null;
  }

  // 初始化 Tab 通知模块（绑定 visibilitychange 监听）
  function initTabNotificationAPI() {
    initTabNotification();
  }

  // 初始化 Tab 通知模块（绑定 visibilitychange 监听）
  function initTabNotificationAPI() {
    initTabNotification();
  }

  window.PeerChat.UI = {
    cacheDOM,
    initTabNotification: initTabNotificationAPI,
    initTabNotification: initTabNotificationAPI,
    setStatus,
    setHeaderConnected,
    setHeaderWaiting,
    showToast,
    showEntryError,
    hideEntryError,
    appendSystem,
    appendMessage,
    appendFilePlaceholder,
    updateFileProgress,
    renderFinalFile,
    clearMessages,
    maybeScrollToBottom,
    scrollToBottom,
    bindScroll,
    openImgModal,
    bindImgModal,
  };
})();