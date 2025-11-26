// Signaling Server for WebRTC P2P connections
// This server helps peers find each other and exchange connection info

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Create HTTP server to serve static files
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);
  
  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };
  
  const contentType = contentTypes[extname] || 'text/plain';
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// WebSocket signaling server
const wss = new WebSocket.Server({ server });

// Store connected peers
const peers = new Map();

// Generate random peer ID
function generatePeerId() {
  const adjectives = ['swift', 'cyber', 'neon', 'quantum', 'shadow', 'echo', 'flux', 'nova'];
  const nouns = ['node', 'pulse', 'wave', 'core', 'link', 'nexus', 'cipher', 'ghost'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${adj}_${noun}_${num}`;
}

wss.on('connection', (ws) => {
  const peerId = generatePeerId();
  
  peers.set(peerId, {
    ws,
    peerId,
    username: null,
    connectedAt: Date.now()
  });
  
  console.log(`[+] Peer connected: ${peerId}`);
  
  // Send peer their ID and current peer list
  ws.send(JSON.stringify({
    type: 'welcome',
    peerId,
    peers: Array.from(peers.keys()).filter(id => id !== peerId)
  }));
  
  // Broadcast new peer to others
  broadcast({
    type: 'peer-joined',
    peerId
  }, peerId);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(peerId, message);
    } catch (err) {
      console.error('Invalid message:', err);
    }
  });
  
  ws.on('close', () => {
    console.log(`[-] Peer disconnected: ${peerId}`);
    peers.delete(peerId);
    
    // Broadcast peer left
    broadcast({
      type: 'peer-left',
      peerId
    });
  });
  
  ws.on('error', (err) => {
    console.error(`Peer ${peerId} error:`, err);
  });
});

function handleMessage(fromPeerId, message) {
  const peer = peers.get(fromPeerId);
  if (!peer) return;
  
  switch (message.type) {
    case 'set-username':
      peer.username = message.username;
      broadcast({
        type: 'peer-updated',
        peerId: fromPeerId,
        username: message.username
      });
      break;
      
    case 'offer':
    case 'answer':
    case 'ice-candidate':
      // Forward WebRTC signaling messages to target peer
      const targetPeer = peers.get(message.targetPeerId);
      if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
        targetPeer.ws.send(JSON.stringify({
          ...message,
          fromPeerId
        }));
      }
      break;
      
    case 'chat':
      // Broadcast chat message to all peers
      broadcast({
        type: 'chat',
        fromPeerId,
        username: peer.username || fromPeerId,
        message: message.message,
        timestamp: Date.now()
      });
      break;
      
    case 'get-peers':
      peer.ws.send(JSON.stringify({
        type: 'peer-list',
        peers: Array.from(peers.entries())
          .filter(([id]) => id !== fromPeerId)
          .map(([id, p]) => ({
            peerId: id,
            username: p.username
          }))
      }));
      break;
  }
}

function broadcast(message, excludePeerId = null) {
  const data = JSON.stringify(message);
  peers.forEach((peer, peerId) => {
    if (peerId !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  });
}

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   ██████╗██╗   ██╗███████╗██████╗                     ║
║  ██╔════╝╚██╗ ██╔╝██╔════╝██╔══██╗                    ║
║  ██║      ╚████╔╝ █████╗  ██████╔╝                    ║
║  ██║       ╚██╔╝  ██╔══╝  ██╔══██╗                    ║
║  ╚██████╗   ██║   ██║     ██║  ██║                    ║
║   ╚═════╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝                    ║
║                                                       ║
║   P2P Network Running                                 ║
║   Local:   http://localhost:${PORT}                    ║
║                                                       ║
║   Share your public URL with others to connect!       ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});
