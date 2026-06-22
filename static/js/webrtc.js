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

  // ---------- mDNS 地址重写（Chrome 把 IP 藏成 xxx.local 时的兜底） ----------
  // 优先用服务器返回的 client_ip（服务器视角下的客户端真实 IP，跨子网/远端服务器部署时必需）
  // 回退方案：从 window.location.hostname 推断（本机调试时，服务器在本机时有效）
  function detectRealIP() {
    // 1) 服务器返回的客户端真实 IP（最可靠，跨子网必需）
    const ipFromServer = state.clientIP;
    if (ipFromServer && ipFromServer !== 'localhost' && ipFromServer !== '127.0.0.1' &&
        ipFromServer.indexOf(':') === -1 && /^\d+\.\d+\.\d+\.\d+$/.test(ipFromServer)) {
      return ipFromServer;
    }
    // 2) 回退：从 URL 推断（服务器跑在本机上，或同网段能直连时）
    let ip = window.location.hostname || '';
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1' && ip.indexOf(':') === -1 && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return ip;
    }
    return null;
  }

  // 把 candidate 字符串里的 xxx.local 换成真实 IP
  function rewriteCandidateIP(candidateStr) {
    if (!candidateStr || candidateStr.indexOf('.local') === -1) return candidateStr;
    const realIP = detectRealIP();
    if (!realIP) return candidateStr;
    const parts = candidateStr.split(' ');
    if (parts.length >= 6 && parts[4] && parts[4].indexOf('.local') !== -1) {
      parts[4] = realIP;
      return parts.join(' ');
    }
    return candidateStr;
  }

  // 把整个 SDP 里 a=candidate:...xxx.local... 的行重写成真实 IP
  function rewriteSDP(sdp) {
    if (!sdp || sdp.indexOf('.local') === -1) return sdp;
    const realIP = detectRealIP();
    if (!realIP) return sdp;
    let rewritten = 0;
    const lines = sdp.split('\r\n');
    const newLines = lines.map(line => {
      if (line.startsWith('a=candidate:') && line.indexOf('.local') !== -1) {
        const parts = line.split(' ');
        if (parts.length >= 6 && parts[4] && parts[4].indexOf('.local') !== -1) {
          const old = parts[4];
          parts[4] = realIP;
          rewritten++;
          console.log('[P2P] SDP candidate 重写: ' + old + ' -> ' + realIP);
          return parts.join(' ');
        }
      }
      return line;
    });
    if (rewritten > 0) console.log('[P2P] SDP 重写完成，共改写 ' + rewritten + ' 个候选地址');
    return newLines.join('\r\n');
  }

  function startPeerConnection(isInitiator) {
    closePeerConnection();
    // iceServers 为空 = 只收集 host 类型候选（即本机/局域网 IP），
    // 适合纯局域网；若想跨子网/跨 NAT，请填 STUN 服务器，例如：
    //   [{ urls: 'stun:stun.l.google.com:19302' }]
    const pc = new RTCPeerConnection({ iceServers: [] });
    state.pc = pc;

    const realIP = detectRealIP();
    const ipHint = realIP ? realIP : '(无法推断，请用 http://<机器IP>:8000 访问)';
    console.log('[P2P] 开始建立连接，isInitiator=' + isInitiator + ' 本机IP=' + ipHint);

    if (isInitiator) {
      const dc = pc.createDataChannel('chat', { ordered: true });
      setupDataChannel(dc);
      state.dataChannel = dc;
      console.log('[P2P] 发起方已创建 DataChannel，准备 createOffer');
    } else {
      console.log('[P2P] 接收方等待 DataChannel (ondatachannel)');
    }

    // 打印每个收集到的 ICE 候选 —— 把 .local 重写成真实 IP 再发给对方
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const original = ev.candidate.candidate;
        console.log('[P2P] ICE candidate: ' + original);
        const rewritten = rewriteCandidateIP(original);
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          const candJSON = ev.candidate.toJSON();
          candJSON.candidate = rewritten;
          state.ws.send(JSON.stringify({
            type: 'signal',
            room_code: state.roomCode,
            data: { candidate: candJSON },
          }));
        }
      } else {
        console.log('[P2P] ICE candidate 收集完成 (null 标记)');
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('[P2P] ICE gathering state:', pc.iceGatheringState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[P2P] Signaling state:', pc.signalingState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[P2P] ICE connection state:', pc.iceConnectionState);
    };

    pc.ondatachannel = (ev) => {
      console.log('[P2P] 收到对方的 DataChannel');
      setupDataChannel(ev.channel);
      state.dataChannel = ev.channel;
    };

    pc.onconnectionstatechange = () => {
      console.log('[P2P] Connection state:', pc.connectionState);
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

    if (isInitiator) {
      pc.createOffer()
        .then((offer) => {
          console.log('[P2P] createOffer 完成，SDP 长度:', offer.sdp.length);
          return pc.setLocalDescription(offer);
        })
        .then(() => {
          // 把 SDP 里的 xxx.local 伪地址替换成真实 IP
          if (pc.localDescription) {
            const newSDP = rewriteSDP(pc.localDescription.sdp);
            if (newSDP !== pc.localDescription.sdp) {
              const newDesc = new RTCSessionDescription({ type: 'offer', sdp: newSDP });
              return pc.setLocalDescription(newDesc);
            }
          }
          return Promise.resolve();
        })
        .then(() => {
          if (state.ws && state.ws.readyState === WebSocket.OPEN && pc.localDescription) {
            console.log('[P2P] 发送 offer 给信令服务器 (SDP 长度: ' + pc.localDescription.sdp.length + ')');
            state.ws.send(JSON.stringify({
              type: 'signal',
              room_code: state.roomCode,
              data: { sdp: pc.localDescription.toJSON() },
            }));
          }
        })
        .catch((err) => console.error('[P2P] create offer error', err));
    }
  }

  function handleWebRTCSignal(data) {
    const pc = state.pc;
    if (!pc) {
      console.warn('[P2P] 收到信令但 PeerConnection 尚未创建，忽略');
      return;
    }
    if (data.sdp) {
      console.log('[P2P] 收到 SDP，type: ' + data.sdp.type);
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => {
          console.log('[P2P] setRemoteDescription 成功');
          if (data.sdp.type === 'offer') {
            console.log('[P2P] 创建 answer');
            return pc.createAnswer().then((ans) => pc.setLocalDescription(ans));
          }
        })
        .then(() => {
          // answer 也重写 SDP 里的 .local 地址
          if (data.sdp.type === 'offer' && pc.localDescription) {
            const newSDP = rewriteSDP(pc.localDescription.sdp);
            if (newSDP !== pc.localDescription.sdp) {
              const newDesc = new RTCSessionDescription({ type: 'answer', sdp: newSDP });
              return pc.setLocalDescription(newDesc);
            }
          }
          return Promise.resolve();
        })
        .then(() => {
          if (data.sdp.type === 'offer' && pc.localDescription && state.ws && state.ws.readyState === WebSocket.OPEN) {
            console.log('[P2P] 发送 answer 给信令服务器 (SDP 长度: ' + pc.localDescription.sdp.length + ')');
            state.ws.send(JSON.stringify({
              type: 'signal',
              room_code: state.roomCode,
              data: { sdp: pc.localDescription.toJSON() },
            }));
          }
        })
        .catch((err) => console.error('[P2P] sdp error', err));
    } else if (data.candidate) {
      console.log('[P2P] 添加 ICE candidate: ' + data.candidate.candidate.substring(0, 70));
      if (data.candidate.candidate && data.candidate.candidate.indexOf('.local') !== -1) {
        console.warn('[P2P] ⚠️ 对方发来的 candidate 仍是 .local 地址，请确保对方也用 http://<机器IP>:8000 访问');
      }
      pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((err) => console.error('[P2P] ice error', err));
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