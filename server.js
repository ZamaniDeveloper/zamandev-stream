const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware to redirect .html requests to clean URLs
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    const newPath = req.path.slice(0, -5);
    const query = req.url.slice(req.path.length); // preserve query string
    if (newPath === '/index') {
      return res.redirect(301, '/' + query);
    }
    return res.redirect(301, newPath + query);
  }
  next();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Redirect /index to /
app.get('/index', (req, res) => {
  const query = req.url.slice(req.path.length);
  res.redirect(301, '/' + query);
});

// Serve room.html without the extension
app.get('/room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});


// Keep track of active rooms and their participants
// structure: { roomId: { type: 'stream'|'conference'|'call', participants: { socketId: { userId, username, isBroadcaster } } } }
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Join Room
  socket.on('join-room', ({ roomId, userId, username, roomType, isBroadcaster }) => {
    console.log(`User ${username} (${userId}) joining room ${roomId} of type ${roomType}. Broadcaster: ${isBroadcaster}`);

    socket.join(roomId);
    
    // Initialize room if it doesn't exist
    if (!activeRooms.has(roomId)) {
      activeRooms.set(roomId, {
        type: roomType,
        participants: {}
      });
    }

    const room = activeRooms.get(roomId);

    // Enforce 1-to-1 calling limits
    if (room.type === 'call' && Object.keys(room.participants).length >= 2) {
      socket.emit('room-full', { message: 'This private call is already full.' });
      socket.leave(roomId);
      return;
    }

    // Register participant
    room.participants[socket.id] = {
      userId,
      username,
      isBroadcaster: !!isBroadcaster,
      socketId: socket.id
    };

    // Notify other peers in the room about the new participant
    socket.to(roomId).emit('peer-joined', {
      socketId: socket.id,
      userId,
      username,
      isBroadcaster: !!isBroadcaster,
      participants: room.participants
    });

    // Send the list of existing participants to the joiner
    socket.emit('room-joined', {
      roomId,
      roomType: room.type,
      participants: room.participants,
      yourSocketId: socket.id
    });

    console.log(`Room ${roomId} now has ${Object.keys(room.participants).length} participant(s).`);
  });

  // 2. WebRTC Signaling Relays
  // Relay SDP Offer to a specific peer
  socket.on('send-offer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('receive-offer', {
      senderSocketId: socket.id,
      sdp
    });
  });

  // Relay SDP Answer back to the offer sender
  socket.on('send-answer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('receive-answer', {
      senderSocketId: socket.id,
      sdp
    });
  });

  // Relay ICE Candidates
  socket.on('send-ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('receive-ice-candidate', {
      senderSocketId: socket.id,
      candidate
    });
  });

  // 3. Text Chat & Comments
  socket.on('send-chat-message', ({ roomId, message, username }) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    io.to(roomId).emit('receive-chat-message', {
      senderSocketId: socket.id,
      username,
      message,
      timestamp
    });
  });

  // Whiteboard Drawing Relay
  socket.on('whiteboard-draw', ({ roomId, x0, y0, x1, y1, color, size, isEraser }) => {
    socket.to(roomId).emit('receive-whiteboard-draw', {
      x0, y0, x1, y1, color, size, isEraser
    });
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    socket.to(roomId).emit('receive-whiteboard-clear');
  });

  // 4. Mute/Camera State Broadcasts (for reflecting changes in UI)
  socket.on('media-state-changed', ({ roomId, audioMuted, videoMuted }) => {
    socket.to(roomId).emit('peer-media-state-changed', {
      socketId: socket.id,
      audioMuted,
      videoMuted
    });
  });

  // 5. Leaving Room & Disconnection
  const handleLeave = () => {
    activeRooms.forEach((room, roomId) => {
      if (room.participants[socket.id]) {
        const p = room.participants[socket.id];
        console.log(`User ${p.username} left room ${roomId}`);
        
        // Remove from list
        delete room.participants[socket.id];
        
        // Notify others
        socket.to(roomId).emit('peer-left', {
          socketId: socket.id,
          username: p.username,
          isBroadcaster: p.isBroadcaster
        });

        // Clean up empty room
        if (Object.keys(room.participants).length === 0) {
          activeRooms.delete(roomId);
          console.log(`Room ${roomId} deleted because it is empty.`);
        }
      }
    });
  };

  socket.on('leave-room', () => {
    handleLeave();
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleLeave();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ZamanDev Stream server running on port ${PORT}`);
  console.log(`🔗 Local Access: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
