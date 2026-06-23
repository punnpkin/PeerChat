// PeerChat - Main entry: wires UI, Signal, WebRTC, File modules together.
(function () {
  'use strict';

  const { state } = window.PeerChat;
  const UI = window.PeerChat.UI;
  const Signal = window.PeerChat.Signal;
  const WebRTC = window.PeerChat.WebRTC;
  const FileMod = window.PeerChat.File;

  // ---- Cache DOM across modules ----
  UI.cacheDOM();
  Signal.cacheEntryDOM();

  // ---- Initialize entry UI (auto-generated grey nickname, URL code) ----
  Signal.initNicknameInput();
  Signal.initEntryCode();
  Signal.initEntryEvents();

  // ---- UI bindings: scroll, image modal ----
  UI.bindScroll();
  UI.bindImgModal();

  // ---- Chat input (textarea auto-size + Enter to send) ----
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const fileInput = document.getElementById('file-input');

  function autosize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
  }

  chatInput.addEventListener('input', autosize);

  // ---- Paste image: Ctrl+V 粘贴剪贴板中的图片/文件
  chatInput.addEventListener('paste', async (e) => {
    if (!e.clipboardData) return;
    const items = e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();   // 阻止把图片转成文本塞进 textarea
      await FileMod.sendFiles(files);
    }
    // 非图片内容（纯文本）走浏览器默认粘贴行为
  });

  function trySendFromInput() {
    const text = chatInput.value;
    if (!text.trim()) return;
    if (WebRTC.sendTextMessage(text)) {
      chatInput.value = '';
      autosize();
    }
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      trySendFromInput();
    }
  });

  btnSend.addEventListener('click', trySendFromInput);

  // ---- File picker ----
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    fileInput.value = '';
    if (!files.length) return;
    await FileMod.sendFiles(files);
  });

  // ---- Before unload confirmation ----
  window.addEventListener('beforeunload', (e) => {
    if (state.connected || state.roomCode) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---- Global helpers exposed to inline HTML handlers ----
  window.scrollToBottom = UI.scrollToBottom;
  window.closeImgModal = function () {
    const modal = document.getElementById('img-modal');
    const img = document.getElementById('img-modal-img');
    modal.classList.add('hidden');
    img.src = '';
  };

  // ---- Initial state ----
  UI.setStatus('offline');
  btnSend.disabled = true;
})();