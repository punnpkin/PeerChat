// PeerChat - Utilities & shared state
(function () {
  'use strict';

  // Shared singleton state for all modules
  const state = {
    ws: null,
    roomCode: null,
    myNickname: '',
    peerNickname: '',
    isInitiator: false,   // who created the room = the offerer
    leaving: false,       // set when the user intentionally leaves
    clientIP: '',         // 服务器视角下客户端的真实 IP，用于 SDP 中 .local 重写
    pc: null,
    dataChannel: null,
    connected: false,
    autoScroll: true,
    receivingFile: null,
    sendingFiles: new Map(),
    CHUNK_SIZE: 16 * 1024,
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function shortTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Generate neutral grey-style nickname like "访客_a1b2c"
  const ADJECTIVES = ['快乐的', '安静的', '友好的', '好奇的', '悠闲的', '温和的', '机智的', '活泼的', '沉稳的', '闪亮的', '灵动的', '热情的'];
  const ANIMALS = ['小熊', '海豚', '麻雀', '狐狸', '兔子', '松鼠', '企鹅', '小鹿', '小猫', '考拉', '柴犬', '水獭'];

  function randomNickname() {
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    // const suffix = Math.floor(Math.random() * 9000 + 1000);
    // return `${a}${b}${suffix}`;
    return `${a}${b}`;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  // Expose globally as PeerChat namespace
  window.PeerChat = {
    state,
    escapeHtml,
    escapeAttr,
    formatSize,
    shortTime,
    timeAgo,
    randomNickname,
    copyToClipboard,
  };
})();