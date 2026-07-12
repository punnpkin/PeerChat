// PeerChat - File transfer: chunked send & finalize UI
(function () {
  'use strict';

  const { state, formatSize, escapeHtml } = window.PeerChat;
  const UI = window.PeerChat.UI;
  const CHUNK_SIZE = state.CHUNK_SIZE;

  function sendBinaryWithPacing(dc, buf) {
    return new Promise((resolve) => {
      if (!dc || dc.readyState !== 'open') return resolve();
      const trySend = () => {
        try {
          if (dc.bufferedAmount > 8 * 1024 * 1024) {
            setTimeout(trySend, 20);
            return;
          }
          dc.send(buf);
          resolve();
        } catch (e) {
          resolve();
        }
      };
      trySend();
    });
  }

  function sendSingleFile(file) {
    return new Promise((resolve) => {
      if (file.size > 10 * 1024 * 1024 * 1024) {
        if (!confirm(`该文件大小为 ${formatSize(file.size)}，发送大文件可能较慢或失败，是否继续？`)) {
          resolve();
          return;
        }
      }
      const isImage = file.type && file.type.startsWith('image/');
      const id = 'f_' + Math.random().toString(36).slice(2, 10);
      const meta = {
        type: 'file-meta',
        id,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        isImage,
      };

      // Local UI placeholder (outgoing)
      const wrap = UI.appendFilePlaceholder({
        fromMe: true,
        nickname: state.myNickname || '我',
        name: file.name,
        size: file.size,
        isImage,
      });

      const dc = state.dataChannel;
      if (!dc || dc.readyState !== 'open') {
        resolve();
        return;
      }

      try { dc.send(JSON.stringify(meta)); } catch { resolve(); return; }

      let offset = 0;
      let readerIdx = 0;
      const readers = [new FileReader(), new FileReader()];
      let pendingBuf = null;
      let reading = false;
      let sending = false;
      let sent = 0;

      function pump() {
        if (offset >= file.size && !pendingBuf && !sending) {
          try { dc.send(JSON.stringify({ type: 'file-done', id })); } catch {}
          const url = URL.createObjectURL(file);
          UI.renderFinalFile(wrap, {
            name: file.name,
            size: file.size,
            mimeType: meta.mimeType,
            isImage,
            url,
          });
          resolve();
          return;
        }
        if (!reading && !pendingBuf && offset < file.size) {
          reading = true;
          const reader = readers[readerIdx];
          readerIdx = 1 - readerIdx;
          const chunkSize = Math.min(CHUNK_SIZE, file.size - offset);
          const slice = file.slice(offset, offset + chunkSize);
          offset += chunkSize;
          reader.onload = (ev) => {
            reading = false;
            pendingBuf = ev.target.result;
            pump();
          };
          reader.onerror = () => {
            reading = false;
            UI.appendSystem('文件读取失败');
            resolve();
          };
          reader.readAsArrayBuffer(slice);
        }
        if (!sending && pendingBuf) {
          sending = true;
          const buf = pendingBuf;
          pendingBuf = null;
          sendBinaryWithPacing(dc, buf).then(() => {
            sending = false;
            sent += buf.byteLength;
            UI.updateFileProgress(wrap, sent, file.size);
            pump();
          });
        }
      }

      pump();
    });
  }

  async function sendFiles(fileList) {
    if (!window.PeerChat.WebRTC.isConnected()) {
      UI.showToast('P2P 连接尚未建立', 'error');
      return;
    }
    for (const file of fileList) {
      await sendSingleFile(file);
    }
  }

  window.PeerChat.File = { sendFiles, sendSingleFile };
})();