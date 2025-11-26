// P2P Client with WebRTC
class P2PClient {
  constructor() {
    this.ws = null;
    this.peerId = null;
    this.username = null;
    this.peers = new Map();
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    
    // WebRTC configuration with public STUN servers
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };
    
    this.setupUI();
  }
  
  setupUI() {
    // Login elements
    this.loginScreen = document.getElementById('loginScreen');
    this.usernameInput = document.getElementById('usernameInput');
    this.joinBtn = document.getElementById('joinBtn');
    
    // App elements
    this.app = document.getElementById('app');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.usernameDisplay = document.getElementById('usernameDisplay');
    this.yourPeerId = document.getElementById('yourPeerId');
    this.peerList = document.getElementById('peerList');
    this.peerCount = document.getElementById('peerCount');
    this.chatMessages = document.getElementById('chatMessages');
    this.chatInput = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.dropZone = document.getElementById('dropZone');
    this.fileInput = document.getElementById('fileInput');
    this.transferList = document.getElementById('transferList');
    
    // Event listeners
    this.joinBtn.addEventListener('click', () => this.connect());
    this.usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.connect();
    });
    
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
    
    // File transfer
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragover');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragover');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });
    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
    });
  }
  
  connect() {
    this.username = this.usernameInput.value.trim() || 'anonymous';
    
    // Determine WebSocket URL (works locally and on hosted services)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('Connecting to:', wsUrl);
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateConnectionStatus(true);
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSignalingMessage(message);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.updateConnectionStatus(false);
      // Attempt reconnection
      setTimeout(() => {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this.addSystemMessage('Connection lost. Reconnecting...');
          this.connect();
        }
      }, 3000);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateConnectionStatus(false);
    };
  }
  
  handleSignalingMessage(message) {
    switch (message.type) {
      case 'welcome':
        this.peerId = message.peerId;
        this.yourPeerId.textContent = this.peerId;
        this.usernameDisplay.textContent = this.username;
        
        // Show main app
        this.loginScreen.classList.add('hidden');
        this.app.classList.add('active');
        
        // Set username on server
        this.ws.send(JSON.stringify({
          type: 'set-username',
          username: this.username
        }));
        
        // Add existing peers
        message.peers.forEach(peerId => {
          this.peers.set(peerId, { peerId, username: peerId });
          this.createPeerConnection(peerId, true);
        });
        this.updatePeerList();
        
        this.addSystemMessage(`Connected as ${this.username}`);
        break;
        
      case 'peer-joined':
        this.peers.set(message.peerId, { peerId: message.peerId, username: message.peerId });
        this.createPeerConnection(message.peerId, false);
        this.updatePeerList();
        this.addSystemMessage(`${message.peerId} joined the network`);
        break;
        
      case 'peer-updated':
        if (this.peers.has(message.peerId)) {
          this.peers.get(message.peerId).username = message.username;
          this.updatePeerList();
        }
        break;
        
      case 'peer-left':
        this.peers.delete(message.peerId);
        this.closePeerConnection(message.peerId);
        this.updatePeerList();
        this.addSystemMessage(`${message.peerId} left the network`);
        break;
        
      case 'offer':
        this.handleOffer(message.fromPeerId, message.offer);
        break;
        
      case 'answer':
        this.handleAnswer(message.fromPeerId, message.answer);
        break;
        
      case 'ice-candidate':
        this.handleIceCandidate(message.fromPeerId, message.candidate);
        break;
        
      case 'chat':
        this.addChatMessage(message);
        break;
        
      case 'peer-list':
        message.peers.forEach(peer => {
          if (!this.peers.has(peer.peerId)) {
            this.peers.set(peer.peerId, peer);
          } else {
            this.peers.get(peer.peerId).username = peer.username;
          }
        });
        this.updatePeerList();
        break;
    }
  }
  
  // WebRTC Connection Management
  async createPeerConnection(peerId, initiator) {
    console.log(`Creating peer connection to ${peerId}, initiator: ${initiator}`);
    
    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);
    
    // Create data channel if initiator
    if (initiator) {
      const dc = pc.createDataChannel('data');
      this.setupDataChannel(peerId, dc);
    }
    
    // Handle incoming data channel
    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: 'ice-candidate',
          targetPeerId: peerId,
          candidate: event.candidate
        }));
      }
    };
    
    // Connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.updatePeerList();
      }
    };
    
    // Create and send offer if initiator
    if (initiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        this.ws.send(JSON.stringify({
          type: 'offer',
          targetPeerId: peerId,
          offer: pc.localDescription
        }));
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }
    
    return pc;
  }
  
  setupDataChannel(peerId, dc) {
    dc.onopen = () => {
      console.log(`Data channel with ${peerId} opened`);
      this.dataChannels.set(peerId, dc);
      this.updatePeerList();
    };
    
    dc.onclose = () => {
      console.log(`Data channel with ${peerId} closed`);
      this.dataChannels.delete(peerId);
      this.updatePeerList();
    };
    
    dc.onmessage = (event) => {
      this.handleDataChannelMessage(peerId, event.data);
    };
    
    dc.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
    };
  }
  
  async handleOffer(fromPeerId, offer) {
    let pc = this.peerConnections.get(fromPeerId);
    
    if (!pc) {
      pc = await this.createPeerConnection(fromPeerId, false);
    }
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      this.ws.send(JSON.stringify({
        type: 'answer',
        targetPeerId: fromPeerId,
        answer: pc.localDescription
      }));
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  }
  
  async handleAnswer(fromPeerId, answer) {
    const pc = this.peerConnections.get(fromPeerId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    }
  }
  
  async handleIceCandidate(fromPeerId, candidate) {
    const pc = this.peerConnections.get(fromPeerId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  }
  
  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
  }
  
  // Data Channel Messages
  handleDataChannelMessage(peerId, data) {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'file-info') {
        // Incoming file transfer
        this.receiveFile(peerId, message);
      } else if (message.type === 'file-chunk') {
        this.receiveFileChunk(peerId, message);
      } else if (message.type === 'direct-message') {
        // Direct P2P message
        this.addChatMessage({
          fromPeerId: peerId,
          username: this.peers.get(peerId)?.username || peerId,
          message: `[P2P] ${message.content}`,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('Error parsing data channel message:', err);
    }
  }
  
  // Chat
  sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    
    this.ws.send(JSON.stringify({
      type: 'chat',
      message: text
    }));
    
    this.chatInput.value = '';
  }
  
  addChatMessage(message) {
    const isOwn = message.fromPeerId === this.peerId;
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    div.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${isOwn ? 'You' : message.username}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${this.escapeHtml(message.message)}</div>
    `;
    
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }
  
  addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="message-content">${text}</div>`;
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }
  
  // File Transfer
  handleFiles(files) {
    if (!files.length) return;
    
    // Get all connected peers
    const connectedPeers = Array.from(this.dataChannels.keys());
    
    if (connectedPeers.length === 0) {
      this.addSystemMessage('No peers with direct P2P connection available for file transfer');
      return;
    }
    
    for (const file of files) {
      this.sendFile(file, connectedPeers);
    }
  }
  
  async sendFile(file, peerIds) {
    const chunkSize = 16384; // 16KB chunks
    const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create transfer UI
    const transferId = this.addTransferItem(file.name, 'upload', 0);
    
    // Send file info to all peers
    const fileInfo = {
      type: 'file-info',
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    };
    
    for (const peerId of peerIds) {
      const dc = this.dataChannels.get(peerId);
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(fileInfo));
      }
    }
    
    // Read and send file in chunks
    const arrayBuffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
      const chunk = arrayBuffer.slice(start, end);
      
      const chunkData = {
        type: 'file-chunk',
        fileId,
        chunkIndex: i,
        totalChunks,
        data: this.arrayBufferToBase64(chunk)
      };
      
      for (const peerId of peerIds) {
        const dc = this.dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
          dc.send(JSON.stringify(chunkData));
        }
      }
      
      // Update progress
      const progress = ((i + 1) / totalChunks) * 100;
      this.updateTransferProgress(transferId, progress);
      
      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.addSystemMessage(`File "${file.name}" sent to ${peerIds.length} peer(s)`);
  }
  
  // File receiving state
  incomingFiles = new Map();
  
  receiveFile(peerId, info) {
    this.incomingFiles.set(info.fileId, {
      fileName: info.fileName,
      fileSize: info.fileSize,
      fileType: info.fileType,
      chunks: [],
      totalChunks: null,
      transferId: this.addTransferItem(info.fileName, 'download', 0)
    });
    
    this.addSystemMessage(`Receiving file "${info.fileName}" from ${this.peers.get(peerId)?.username || peerId}`);
  }
  
  receiveFileChunk(peerId, chunk) {
    const file = this.incomingFiles.get(chunk.fileId);
    if (!file) return;
    
    file.totalChunks = chunk.totalChunks;
    file.chunks[chunk.chunkIndex] = this.base64ToArrayBuffer(chunk.data);
    
    // Update progress
    const receivedChunks = file.chunks.filter(c => c !== undefined).length;
    const progress = (receivedChunks / chunk.totalChunks) * 100;
    this.updateTransferProgress(file.transferId, progress);
    
    // Check if complete
    if (receivedChunks === chunk.totalChunks) {
      this.completeFileDownload(chunk.fileId);
    }
  }
  
  completeFileDownload(fileId) {
    const file = this.incomingFiles.get(fileId);
    if (!file) return;
    
    // Combine chunks
    const totalLength = file.chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of file.chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    
    // Create download
    const blob = new Blob([combined], { type: file.fileType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.incomingFiles.delete(fileId);
    this.addSystemMessage(`File "${file.fileName}" downloaded`);
  }
  
  // Transfer UI
  addTransferItem(fileName, direction, progress) {
    const id = `transfer-${Date.now()}`;
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.id = id;
    div.innerHTML = `
      <div class="transfer-filename">${this.escapeHtml(fileName)}</div>
      <div class="transfer-info">${direction === 'upload' ? '↑ Sending' : '↓ Receiving'}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
    `;
    this.transferList.appendChild(div);
    return id;
  }
  
  updateTransferProgress(transferId, progress) {
    const div = document.getElementById(transferId);
    if (div) {
      div.querySelector('.progress-fill').style.width = `${progress}%`;
      if (progress >= 100) {
        setTimeout(() => div.remove(), 2000);
      }
    }
  }
  
  // UI Updates
  updateConnectionStatus(connected) {
    this.statusDot.classList.toggle('disconnected', !connected);
    this.statusText.textContent = connected ? 'Connected' : 'Disconnected';
  }
  
  updatePeerList() {
    const count = this.peers.size;
    this.peerCount.textContent = count;
    
    if (count === 0) {
      this.peerList.innerHTML = '<div class="empty-peers">No peers connected yet.<br>Share your server URL!</div>';
      return;
    }
    
    this.peerList.innerHTML = '';
    
    for (const [peerId, peer] of this.peers) {
      const hasDirectConnection = this.dataChannels.has(peerId);
      const div = document.createElement('div');
      div.className = 'peer-item';
      div.innerHTML = `
        <div class="peer-avatar">${(peer.username || peerId).charAt(0).toUpperCase()}</div>
        <div class="peer-info">
          <div class="peer-name">${peer.username || peerId}</div>
          <div class="peer-status">${hasDirectConnection ? 'P2P Connected' : 'Via Server'}</div>
        </div>
      `;
      this.peerList.appendChild(div);
    }
  }
  
  // Helpers
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// Initialize
const p2p = new P2PClient();
