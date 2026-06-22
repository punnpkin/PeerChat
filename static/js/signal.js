// PeerChat - WebSocket signaling + entry handlers
(function () {
  'use strict';

  const { state } = window.PeerChat;
  const UI = window.PeerChat.UI;
  const WebRTC = window.PeerChat.WebRTC;

  const els = {};

  function cacheEntryDOM() {
    els.entryView = document.getElementById('entry-view');
    els.chatView = document.getElementById('chat-view');
    els.entryNickname = document.getElementById('entry-nickname');
    els.entryCode = document.getElementById('entry-code');
    els.btnCreate = document.getElementById('btn-create');
    els.btnJoin = document.getElementById('btn-join');
    els.btnRefreshNick = document.getElementById('btn-refresh-nick');
    els.btnShare = document.getElementById('btn-share');
    els.btnLeave = document.getElementById('btn-leave');
    els.headerRoomCode = document.getElementById('header-room-code');
    els.roomCodeText = document.getElementById('room-code-text');
  }

  function readUrlCode() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('code') || '';
    } catch { return ''; }
  }

  // Show/hide grey styling on the nickname input.
  // When showing the auto-generated default nickname, we style it in grey
  // so the user recognizes it as "system default, can be changed".
  function applyGreyNickStyle(isGrey) {
    const input = els.entryNickname;
    if (isGrey) {
      input.classList.add('text-slate-400');
      els.btnRefreshNick.classList.remove('hidden');
    } else {
      input.classList.remove('text-slate-400');
    }
  }

  function setNickname(nick) {
    els.entryNickname.value = nick;
    applyGreyNickStyle(true);
  }

  function initNicknameInput() {
    const saved = localStorage.getItem('peerchat_nickname');
    const initial = saved || window.PeerChat.randomNickname();
    setNickname(initial);

    els.entryNickname.addEventListener('focus', () => {
      applyGreyNickStyle(false);
    });

    els.entryNickname.addEventListener('input', () => {
      applyGreyNickStyle(false);
      // Show/hide refresh button depending on whether there's a default grey nickname
      if (!els.entryNickname.value.trim()) {
        els.btnRefreshNick.classList.add('hidden');
      }
    });

    els.entryNickname.addEventListener('blur', () => {
      // If user left the input empty, show placeholder (no auto re-generate),
      // but hide the refresh button to avoid ambiguity about what "换一个" does.
      if (!els.entryNickname.value.trim()) {
        els.btnRefreshNick.classList.add('hidden');
      } else {
        // If user left something non-default but non-empty, keep as-is (user-typed).
        // We detect "default grey" state via the text-slate-400 class; if removed,
        // the content is user-typed and we don't restore grey style.
      }
    });

    els.btnRefreshNick.addEventListener('click', () => {
      setNickname(window.PeerChat.randomNickname());
      els.btnRefreshNick.classList.remove('hidden');
    });
  }

  function initEntryCode() {
    const urlCode = readUrlCode();
    if (/^\d{8}$/.test(urlCode)) {
      els.entryCode.value = urlCode;
    }
    els.entryCode.addEventListener('input', () => {
      els.entryCode.value = els.entryCode.value.replace(/\D/g, '').slice(0, 8);
    });
  }

  function connectWS(action, code) {
    UI.setStatus('offline');
    UI.hideEntryError();

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProto}//${window.location.host}/`;

    try {
      const ws = new WebSocket(url);
      state.ws = ws;
    } catch (err) {
      UI.showEntryError('无法连接到服务器：' + err.message);
      return;
    }

    state.ws.addEventListener('open', () => {
      if (action === 'create') {
        state.ws.send(JSON.stringify({ type: 'create_room', nickname: state.myNickname }));
      } else {
        state.ws.send(JSON.stringify({ type: 'join_room', room_code: code, nickname: state.myNickname }));
      }
    });

    state.ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      handleSignalMessage(msg);
    });

    state.ws.addEventListener('close', () => {
      if (state.leaving) return; // intentional leave, no error message
      if (!els.chatView.classList.contains('hidden')) {
        UI.setStatus('offline');
        UI.appendSystem('与信令服务器连接断开');
      } else {
        UI.showEntryError('信令服务器连接失败，请重试');
      }
    });

    state.ws.addEventListener('error', () => {
      if (state.leaving) return;
      if (els.chatView.classList.contains('hidden')) {
        UI.showEntryError('信令服务器连接错误');
      }
    });
  }

  function handleSignalMessage(msg) {
    const type = msg.type;
    if (type === 'room_created') {
      state.roomCode = msg.room_code;
      state.isInitiator = true;  // room creator = offerer
      state.clientIP = msg.client_ip || '';   // 服务器视角下的客户端真实 IP，用于重写 .local
      enterChatView();
      UI.setStatus('waiting');
      UI.setHeaderWaiting('等待对方连接...');
      els.roomCodeText.textContent = state.roomCode;
      UI.appendSystem(`会话已创建，会话码 ${state.roomCode}`);
      UI.appendSystem('请将会话码分享给对方，对方加入后将自动建立 P2P 连接');
    } else if (type === 'room_joined') {
      state.roomCode = msg.room_code;
      state.isInitiator = false; // joiner = answerer
      state.peerNickname = msg.peer_nickname || '对方';
      state.clientIP = msg.client_ip || '';   // 服务器视角下的客户端真实 IP，用于重写 .local
      enterChatView();
      UI.setStatus('waiting');
      UI.setHeaderConnected(`对方: ${state.peerNickname}`);
      els.roomCodeText.textContent = state.roomCode;
      UI.appendSystem(`已加入房间 ${state.roomCode}`);
      WebRTC.startPeerConnection(false);
    } else if (type === 'peer_joined') {
      state.peerNickname = msg.peer_nickname || '对方';
      if (msg.client_ip) state.clientIP = msg.client_ip;  // 服务器视角下的客户端真实 IP
      UI.setStatus('waiting');
      UI.setHeaderConnected(`对方: ${state.peerNickname}`);
      UI.appendSystem(`${state.peerNickname} 已加入，正在建立 P2P 连接...`);
      WebRTC.startPeerConnection(true);
    } else if (type === 'peer_left') {
      state.connected = false;
      UI.setStatus('waiting');
      UI.setHeaderWaiting('对方已断开，等待重新连接...');
      UI.appendSystem('对方已离开');
      WebRTC.closePeerConnection();
    } else if (type === 'error') {
      if (!els.chatView.classList.contains('hidden')) {
        UI.appendSystem('错误: ' + (msg.message || ''));
      } else {
        UI.showEntryError(msg.message || '发生错误');
      }
    } else if (type === 'signal') {
      WebRTC.handleWebRTCSignal(msg.data);
    }
  }

  function enterChatView() {
    els.entryView.classList.add('hidden');
    els.chatView.classList.remove('hidden');
    els.chatView.classList.add('flex');
    UI.clearMessages(); // 全新会话：清空上一次会话的残留消息
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {}
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.focus();
  }

  function backToEntry() {
    state.leaving = true; // prevent "disconnected" error message on intentional leave
    els.chatView.classList.add('hidden');
    els.chatView.classList.remove('flex');
    els.entryView.classList.remove('hidden');
    UI.setStatus('offline');
    UI.setHeaderWaiting('等待对方连接...');
    els.roomCodeText.textContent = '--------';
    // Reset state for next session
    setTimeout(() => {
      state.leaving = false;
      state.roomCode = null;
      state.peerNickname = '';
      state.isInitiator = false;
    }, 300);
  }

  function onCreateClick() {
    UI.hideEntryError();
    state.leaving = false;
    const nick = (els.entryNickname.value || '').trim() || window.PeerChat.randomNickname();
    localStorage.setItem('peerchat_nickname', nick);
    state.myNickname = nick;
    connectWS('create', null);
  }

  function onJoinClick() {
    UI.hideEntryError();
    state.leaving = false;
    const nick = (els.entryNickname.value || '').trim() || window.PeerChat.randomNickname();
    localStorage.setItem('peerchat_nickname', nick);
    state.myNickname = nick;
    const code = els.entryCode.value.trim();
    if (!/^\d{8}$/.test(code)) {
      UI.showEntryError('请输入 8 位数字的会话码');
      return;
    }
    connectWS('join', code);
  }

  function initEntryEvents() {
    els.btnCreate.addEventListener('click', onCreateClick);
    els.btnJoin.addEventListener('click', onJoinClick);
    els.entryCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onJoinClick();
    });
    els.entryNickname.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (els.entryCode.value.length === 8) onJoinClick();
        else onCreateClick();
      }
    });

    // Header actions
    els.headerRoomCode.addEventListener('click', () => {
      if (!state.roomCode) return;
      window.PeerChat.copyToClipboard(state.roomCode);
      UI.showToast('会话码已复制', 'success');
    });
    els.btnShare.addEventListener('click', () => {
      if (!state.roomCode) return;
      const link = `${window.location.origin}${window.location.pathname}?code=${state.roomCode}`;
      window.PeerChat.copyToClipboard(link);
      UI.showToast('分享链接已复制', 'success');
    });
    els.btnLeave.addEventListener('click', () => {
      if (!confirm('确定离开当前会话吗？')) return;
      try {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'leave' }));
        }
      } catch {}
      WebRTC.closePeerConnection();
      try { if (state.ws) state.ws.close(); } catch {}
      backToEntry();
    });
  }

  window.PeerChat.Signal = {
    cacheEntryDOM,
    initNicknameInput,
    initEntryCode,
    initEntryEvents,
  };
})();