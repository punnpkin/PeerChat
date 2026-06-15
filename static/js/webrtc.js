// PeerChat - WebRTC: PeerConnection & DataChannel lifecycle
(function () {
  'use strict';

  const { state } = window.PeerChat;
  const UI = window.PeerChat.UI;
  const FileMod = null; // lazy-resolved via window.PeerChat.File

  function onIncomingText(text) {
    try {
      const msg = JSON.parse(text);
      if (!msg || !msg.type) return;

      if (msg.type === 'chat') {
        UI.appendMessage({
          fromMe: false,
          nickname: state.peerNickname || '对方',
          text: msg.text,
          ts: msg.ts || Date.now(),
        });
      } else if (msg.type === 'file-meta') {
        // Start receiving file
        state.receivingFile = {
          id: msg.id,
          meta: {
            name: msg.name,
            size: msg.size,
            mimeType: msg.mimeType,
            isImage: !!msg.isImage,
          },
          chunks: [],
          received: 0,
          wrap: UI.appendFilePlaceholder({
            fromMe: false,
            nickname: state.peerNickname || '对方',
            name: msg.name,
            size: msg.size,
            isImage: !!msg.isImage,
          }),
        };
      } else if (msg.type === 'file-done') {
        if (state.receivingFile && state.receivingFile.id === msg.id) {
          const rf = state.receivingFile;
          const blob = new Blob(rf.chunks, { type: rf.meta.mimeType || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          UI.renderFinalFile(rf.wrap, { ...rf.meta, url });
          state.receivingFile = null;
        }
      }
    } catch (e) {
      console.warn('Failed to parse text message', e);
    }
  }

  function onIncomingBinary(data) {
    const rf = state.receivingFile;
    if (!rf) return;
    const arr = new Uint8Array(data);
    rf.chunks.push(arr);
    rf.received += arr.length;
    UI.updateFileProgress(rf.wrap, rf.received, rf.meta.size);
  }

  function setupDataChannel(dc) {
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      state.connected = true;
      UI.setStatus('connected');
      UI.setHeaderConnected(`对方: ${state.peerNickname}`);
      // Enable send button via state; app.js watches
      const btn = document.getElementById('btn-send');
      if (btn) btn.disabled = false;
    };
    dc.onclose = () => {
      state.connected = false;
    };
    dc.onerror = (e) => console.error('DC error', e);
    dc.onmessage = (evt) => {
      if (typeof evt.data === 'string') onIncomingText(evt.data);
      else onIncomingBinary(evt.data);
    };
  }

  function startPeerConnection(isInitiator) {
    closePeerConnection();
    const pc = new RTCPeerConnection({ iceServers: [] });
    state.pc = pc;

    // Only the initiator (who created the room) creates the data channel.
    // The other side will receive it via `ondatachannel` and send back an answer.
    // Doing both on both sides was causing duplicate offers and Chrome/Firefox interoperability failures.
    if (isInitiator) {
      const dc = pc.createDataChannel('chat', { ordered: true });
      setupDataChannel(dc);
      state.dataChannel = dc;
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
          type: 'signal',
          room_code: state.roomCode,
          data: { candidate: ev.candidate.toJSON() },
        }));
      }
    };

    pc.ondatachannel = (ev) => {
      setupDataChannel(ev.channel);
      state.dataChannel = ev.channel;
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' || pc.connectionState === 'completed') {
        state.connected = true;
        UI.setStatus('connected');
        UI.setHeaderConnected(`对方: ${state.peerNickname}`);
        UI.appendSystem('P2P 连接已建立，可以开始聊天');
        const btn = document.getElementById('btn-send');
        if (btn) btn.disabled = false;
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        state.connected = false;
        UI.setStatus('waiting');
        UI.appendSystem('P2P 连接断开');
      }
    };

    // Only initiator creates and sends an offer.
    // The responder waits for an offer to arrive and then responds with an answer.
    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (state.ws && state.ws.readyState === WebSocket.OPEN && pc.localDescription) {
            state.ws.send(JSON.stringify({
              type: 'signal',
              room_code: state.roomCode,
              data: { sdp: pc.localDescription.toJSON() },
            }));
          }
        })
        .catch((err) => console.error('create offer error', err));
    }
  }

  function handleWebRTCSignal(data) {
    const pc = state.pc;
    if (!pc) return;
    if (data.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => {
          if (data.sdp.type === 'offer') {
            return pc.createAnswer().then((ans) => pc.setLocalDescription(ans));
          }
        })
        .then(() => {
          if (data.sdp.type === 'offer' && pc.localDescription && state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
              type: 'signal',
              room_code: state.roomCode,
              data: { sdp: pc.localDescription.toJSON() },
            }));
          }
        })
        .catch((err) => console.error('sdp error', err));
    } else if (data.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((err) => console.error('ice error', err));
    }
  }

  function closePeerConnection() {
    if (state.dataChannel) {
      try { state.dataChannel.close(); } catch {}
      state.dataChannel = null;
    }
    if (state.pc) {
      try { state.pc.close(); } catch {}
      state.pc = null;
    }
    state.connected = false;
    state.receivingFile = null;
    state.sendingFiles.forEach((s) => clearInterval(s.interval));
    state.sendingFiles.clear();
    const btn = document.getElementById('btn-send');
    if (btn) btn.disabled = true;
  }

  function sendTextMessage(text) {
    if (!state.connected || !state.dataChannel) return false;
    try {
      state.dataChannel.send(JSON.stringify({ type: 'chat', text, ts: Date.now() }));
      UI.appendMessage({ fromMe: true, nickname: state.myNickname || '我', text, ts: Date.now() });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function isConnected() {
    return state.connected && !!state.dataChannel;
  }

  function getDataChannel() {
    return state.dataChannel;
  }

  window.PeerChat.WebRTC = {
    startPeerConnection,
    handleWebRTCSignal,
    closePeerConnection,
    sendTextMessage,
    isConnected,
    getDataChannel,
  };
})();