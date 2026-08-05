/* app.js - Core WebRTC & Socket.IO Room Coordinator and Event Orchestrator */

// Parse Room Query parameters
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId');
const userId = urlParams.get('userId');
const username = urlParams.get('username') || 'ناشناس';
const roomType = urlParams.get('roomType') || 'stream'; // 'stream' | 'conference' | 'call'
const isBroadcaster = urlParams.get('isBroadcaster') === 'true';
let currentProfileName = urlParams.get('profile') || 'low';

// Escape user-controlled values before inserting them into HTML templates.
function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// App state
let socket = null;
let localStream = null;
let currentFacingMode = 'user'; // 'user' | 'environment'
const peerConnections = new Map(); // targetSocketId -> { pc, stream, statsIntervalId }
let myActiveSocketId = null;
let roomParticipants = {};

// Extended features state
let isScreenSharing = false;
let screenStream = null;
let isWhiteboardActive = false;
let isDrawing = false;
let currentColor = '#ef4444'; // Red default
let currentBrushSize = 3; // Thin default
let currentTool = 'pen'; // 'pen' | 'eraser'
let lastX = 0;
let lastY = 0;

// DOM Elements
const videoArena = document.getElementById('videoArena');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const leaveBtn = document.getElementById('leaveBtn');
const roomTitle = document.getElementById('roomTitle');
const roomBadge = document.getElementById('roomBadge');
const viewerCountContainer = document.getElementById('viewerCountContainer');
const viewerCount = document.getElementById('viewerCount');
const selfUsernameTag = document.getElementById('selfUsernameTag');
const selfRoleTag = document.getElementById('selfRoleTag');

// Sidebar Tabs & Panels
const tabChatBtn = document.getElementById('tabChatBtn');
const tabPeersBtn = document.getElementById('tabPeersBtn');
const panelChat = document.getElementById('panelChat');
const panelPeers = document.getElementById('panelPeers');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const participantList = document.getElementById('participantList');

// Tuning Controls
const tuningToggleBtn = document.getElementById('tuningToggleBtn');
const tuningPanel = document.getElementById('tuningPanel');
const qualityProfileSelect = document.getElementById('qualityProfileSelect');
const cameraFacingSelect = document.getElementById('cameraFacingSelect');
const networkSpeedIndicator = document.getElementById('networkSpeedIndicator');
const networkQualityLabel = document.getElementById('networkQualityLabel');

// Live tuning stats
const statLatency = document.getElementById('statLatency');
const statPacketLoss = document.getElementById('statPacketLoss');
const statDownload = document.getElementById('statDownload');
const statUpload = document.getElementById('statUpload');
const statResolution = document.getElementById('statResolution');

// Pre-init state variables
let isMicMuted = false;
let isCamMuted = false;

// 1. Initialize Application
async function init() {
  if (!roomId || !userId) {
    window.location.href = '/';
    return;
  }

  setupUI();
  setupSidebarTabs();

  // Establish local media stream if authorized to publish stream
  const needsPublishing = (roomType === 'conference' || roomType === 'call' || (roomType === 'stream' && isBroadcaster));
  
  if (needsPublishing) {
    try {
      localStream = await WebRTCHelper.getUserMedia(currentProfileName, currentFacingMode);
      
      // If we joined with audio-only, reflect camera state
      if (currentProfileName === 'audio') {
        isCamMuted = true;
        toggleCamBtn.classList.add('active');
        toggleCamBtn.querySelector('i').className = 'fa-solid fa-video-slash';
      }

      // Create Local Video Card
      createVideoCard(null, `${username} (شما)`, true, currentProfileName === 'audio');
    } catch (err) {
      console.error('[Init] Error getting user media:', err);
      alert('خطا در دسترسی به دوربین یا میکروفون. در حالت فقط دریافت متصل می‌شوید.');
      localStream = null;
    }
  } else {
    // Viewer Mode (One-to-Many stream)
    // Deactivate local media buttons since viewer is download-only
    toggleMicBtn.style.display = 'none';
    toggleCamBtn.style.display = 'none';
    
    // Create placeholder showing viewer mode in video arena
    videoArena.innerHTML = `
      <div class="video-placeholder" id="viewerWaitingPlaceholder">
        <div class="placeholder-avatar" style="background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
        </div>
        <div class="placeholder-text" style="font-size: 1.1rem; font-weight: 500; color: white;" id="viewerWaitingStatus">در حال اتصال به پخش زنده...</div>
        <div class="placeholder-text" style="margin-bottom: 10px;">منتظر شروع دریافت جریان ویدئویی هستیم...</div>
        <button class="btn btn-secondary" onclick="openWebRTCHelpModal()" style="font-size: 0.8rem; padding: 6px 15px; border-color: var(--accent-blue); background: rgba(6, 182, 212, 0.1); cursor: pointer;">
          <i class="fa-solid fa-circle-question" style="color: var(--accent-blue);"></i> راهنمای عدم دریافت تصویر
        </button>
      </div>
    `;
  }

  // Setup Extended Features (whiteboard, screen sharing, mobile sidebar, etc.)
  setupExtendedFeatures();

  // Connect to Signaling Server
  connectToSignalingServer();
}

// 2. Set Up UI Elements & Metadata
function setupUI() {
  roomTitle.innerText = `اتاق ${roomId}`;
  selfUsernameTag.innerText = username;
  
  // Quality Profile dropdown sync
  qualityProfileSelect.value = currentProfileName;
  
  // Setup Room badge styles
  if (roomType === 'stream') {
    roomBadge.innerText = isBroadcaster ? 'پخش‌کننده (Broadcaster)' : 'تماشاکننده (Viewer)';
    roomBadge.className = 'room-badge badge-stream';
    selfRoleTag.innerText = isBroadcaster ? 'استریمر' : 'تماشاگر';
    if (!isBroadcaster) {
      viewerCountContainer.style.display = 'inline-flex';
    }
  } else if (roomType === 'conference') {
    roomBadge.innerText = 'کنفرانس گروهی';
    roomBadge.className = 'room-badge badge-conference';
    selfRoleTag.innerText = 'شرکت‌کننده';
  } else {
    roomBadge.innerText = 'تماس دو نفره';
    roomBadge.className = 'room-badge badge-call';
    selfRoleTag.innerText = 'تماس‌گیرنده';
  }

  // Add click events to mic/camera controls
  toggleMicBtn.addEventListener('click', toggleMicrophone);
  toggleCamBtn.addEventListener('click', toggleCamera);
  leaveBtn.addEventListener('click', leaveRoom);

  // Bandwidth Tuning Panel toggler
  tuningToggleBtn.addEventListener('click', () => {
    tuningPanel.classList.toggle('active');
    tuningToggleBtn.classList.toggle('active');
  });

  // Handle Quality Profile selection changed
  qualityProfileSelect.addEventListener('change', changeQualityProfile);

  // Handle Camera Facing selection changed
  if (cameraFacingSelect) {
    cameraFacingSelect.value = currentFacingMode;
    cameraFacingSelect.addEventListener('change', changeFacingMode);
  }
}

// 3. Setup Socket.IO Events
function connectToSignalingServer() {
  socket = io();

  socket.on('connect', () => {
    console.log(`[Socket] Connected to signaling. ID: ${socket.id}`);
    myActiveSocketId = socket.id;

    // Join room
    socket.emit('join-room', {
      roomId,
      userId,
      username,
      roomType,
      isBroadcaster: (roomType === 'stream' && isBroadcaster)
    });
  });

  // Room join confirmation
  socket.on('room-joined', ({ roomId, roomType, participants, yourSocketId }) => {
    console.log(`[Socket] Successfully joined room: ${roomId}`, participants);
    roomParticipants = participants;
    updateParticipantsList();

    // Welcome toast notification
    showWelcomeToast('به اتاق گفت‌وگو خوش آمدید! ارتباط شما برقرار شد.', 'خوش‌آمدگویی');

    // If there are other participants, we can connect
    // In Mesh RTC: The newly joining peer waits for others to offer. Or vice versa.
    // In our plan: Existing peers will call createPeerConnection and send an Offer to this newly joined peer.
    // So this new peer doesn't need to do anything but wait for incoming offers.
    // Except in one-to-one or stream rooms where things are straightforward:
    // If we are a streamer, viewers will join, and we will initiate connection.
    if (roomType === 'stream' && isBroadcaster) {
      Object.values(participants).forEach(p => {
        if (p.socketId !== yourSocketId) {
          console.log(`[Socket] Broadcaster joined second. Initiating connection to existing viewer: ${p.username} (${p.socketId})`);
          initiateWebRTCConnection(p.socketId, p.username);
        }
      });
    }
  });

  // Room is full (for 1-to-1)
  socket.on('room-full', ({ message }) => {
    document.getElementById('modalErrorMessage').innerText = message;
    document.getElementById('roomFullModal').style.display = 'flex';
  });

  // Peer joined: Trigger connection
  socket.on('peer-joined', ({ socketId, userId, username: peerUsername, isBroadcaster: peerBroadcaster, participants }) => {
    console.log(`[Socket] Peer joined: ${peerUsername} (${socketId})`);
    roomParticipants = participants;
    updateParticipantsList();

    // Welcome toast notification
    showWelcomeToast(`کاربر ${peerUsername} وارد اتاق شد.`, 'ورود کاربر');

    // Establish connection based on room rules:
    // 1. In conference or call: The EXISTING peer (us) initiates Offer to the JOINING peer.
    // 2. In stream: The BROADCASTER (if us) initiates Offer to the JOINING viewer.
    // This protocol prevents dual offer collisions.
    const shouldInitiateOffer = 
      roomType === 'conference' || 
      roomType === 'call' || 
      (roomType === 'stream' && isBroadcaster);

    if (shouldInitiateOffer) {
      initiateWebRTCConnection(socketId, peerUsername);
    }
  });

  // Handle incoming Offer
  socket.on('receive-offer', async ({ senderSocketId, sdp }) => {
    console.log(`[WebRTC] Received Offer from ${senderSocketId}`);
    
    const peerUsername = roomParticipants[senderSocketId]?.username || 'کاربر دیگر';
    const connObj = createPeerConnection(senderSocketId, peerUsername);
    
    try {
      await connObj.pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      
      const answer = await connObj.pc.createAnswer();
      
      // Inject bandwidth optimization caps in SDP before setting local description
      const profile = WebRTCHelper.PROFILES[currentProfileName];
      const optimizedSdp = WebRTCHelper.applyBandwidthLimits(answer.sdp, profile.videoBitrate, profile.audioBitrate);
      
      await connObj.pc.setLocalDescription({ type: 'answer', sdp: optimizedSdp });
      
      socket.emit('send-answer', {
        targetSocketId: senderSocketId,
        sdp: optimizedSdp
      });
      console.log(`[WebRTC] Answer generated and sent to ${senderSocketId}`);
    } catch (err) {
      console.error('[WebRTC] Error handling SDP Offer:', err);
    }
  });

  // Handle incoming Answer
  socket.on('receive-answer', async ({ senderSocketId, sdp }) => {
    console.log(`[WebRTC] Received Answer from ${senderSocketId}`);
    const conn = peerConnections.get(senderSocketId);
    if (conn) {
      try {
        await conn.pc.setRemoteDescription({ type: 'answer', sdp: sdp });
        console.log(`[WebRTC] Remote description applied successfully.`);
      } catch (err) {
        console.error('[WebRTC] Error setting remote description Answer:', err);
      }
    }
  });

  // Handle incoming ICE Candidate
  socket.on('receive-ice-candidate', async ({ senderSocketId, candidate }) => {
    const conn = peerConnections.get(senderSocketId);
    if (conn) {
      try {
        await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding received ICE candidate:', err);
      }
    }
  });

  // Real-time Comments
  socket.on('receive-chat-message', ({ senderSocketId, username: msgUsername, message, timestamp }) => {
    addChatMessage(msgUsername, message, senderSocketId === socket.id, timestamp);
  });

  // Peer Media states (for reflecting mic/cam mute icons in UI)
  socket.on('peer-media-state-changed', ({ socketId, audioMuted, videoMuted }) => {
    updatePeerMediaStatus(socketId, audioMuted, videoMuted);
  });

  // Peer Left
  socket.on('peer-left', ({ socketId, username: leftUsername, isBroadcaster: leftBroadcaster }) => {
    console.log(`[Socket] Peer left: ${leftUsername}`);
    
    // Welcome toast notification
    showWelcomeToast(`کاربر ${leftUsername} از اتاق خارج شد.`, 'خروج کاربر');

    // Terminate WebRTC peer connection
    closePeerConnection(socketId);
    
    // Remove participant from state
    delete roomParticipants[socketId];
    updateParticipantsList();

    // If stream mode and broadcaster left, notify viewers
    if (roomType === 'stream' && leftBroadcaster) {
      alert('استریمر از اتاق خارج شد و پخش زنده پایان یافت.');
      window.location.href = '/';
    }
  });

  // Whiteboard drawing synchronization
  socket.on('receive-whiteboard-draw', ({ x0, y0, x1, y1, color, size, isEraser }) => {
    if (!isWhiteboardActive) {
      isWhiteboardActive = true;
      const whiteboardContainer = document.getElementById('whiteboardContainer');
      const toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
      if (whiteboardContainer) whiteboardContainer.style.display = 'flex';
      if (toggleWhiteboardBtn) {
        toggleWhiteboardBtn.classList.add('active');
        toggleWhiteboardBtn.style.color = 'var(--accent-pink)';
        toggleWhiteboardBtn.style.borderColor = 'rgba(236, 72, 153, 0.4)';
      }
      setTimeout(resizeCanvas, 50);
      showWelcomeToast('تخته رسم زنده توسط شرکت‌کنندگان فعال شد.', 'تخته رسم');
    }
    drawReceivedSegment(x0, y0, x1, y1, color, size, isEraser);
  });

  socket.on('receive-whiteboard-clear', () => {
    clearLocalCanvas();
    showWelcomeToast('تخته رسم توسط یکی از شرکت‌کنندگان پاکسازی شد.', 'پاکسازی تخته');
  });
}

// 4. Create peer connections & Negotiate
function initiateWebRTCConnection(targetSocketId, targetUsername) {
  console.log(`[WebRTC] Initiating connection with ${targetUsername} (${targetSocketId})`);
  const connObj = createPeerConnection(targetSocketId, targetUsername);

  // Create Offer
  connObj.pc.createOffer()
    .then(async (offer) => {
      // Apply strict bandwidth caps on local SDP
      const profile = WebRTCHelper.PROFILES[currentProfileName];
      const optimizedSdp = WebRTCHelper.applyBandwidthLimits(offer.sdp, profile.videoBitrate, profile.audioBitrate);
      
      await connObj.pc.setLocalDescription({ type: 'offer', sdp: optimizedSdp });
      
      socket.emit('send-offer', {
        targetSocketId,
        sdp: optimizedSdp
      });
      console.log(`[WebRTC] Offer sent to ${targetUsername}`);
    })
    .catch((err) => {
      console.error('[WebRTC] Error generating SDP Offer:', err);
    });
}

// Help Modal Controls
function openWebRTCHelpModal() {
  const modal = document.getElementById('webrtcHelpModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeWebRTCHelpModal() {
  const modal = document.getElementById('webrtcHelpModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Make them globally accessible for onclick handlers
window.openWebRTCHelpModal = openWebRTCHelpModal;
window.closeWebRTCHelpModal = closeWebRTCHelpModal;

// Update card UI based on WebRTC connection state
function handlePeerConnectionStateChange(targetSocketId, targetUsername, pc) {
  const state = pc.connectionState || pc.iceConnectionState;
  console.log(`[WebRTC] Connection state with ${targetUsername} (${targetSocketId}) -> ${state}`);
  
  const cardId = `video-card-${targetSocketId}`;
  const card = document.getElementById(cardId);
  const statusText = document.getElementById(`status-text-${cardId}`);
  
  if (!card) return;

  if (state === 'connecting' || state === 'checking') {
    card.classList.add('connecting');
    card.classList.remove('connected', 'failed');
    if (statusText) {
      statusText.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--accent-blue);"></i> در حال اتصال به ${targetUsername}...`;
    }
  } else if (state === 'connected') {
    card.classList.add('connected');
    card.classList.remove('connecting', 'failed');
    if (statusText) {
      statusText.innerText = targetUsername;
    }
    updateNetworkIndicator('good', 'اتصال برقرار شد');
  } else if (state === 'failed' || state === 'disconnected') {
    card.classList.add('failed');
    card.classList.remove('connecting', 'connected');
    if (statusText) {
      statusText.innerHTML = `
        <div class="connection-error-content" style="cursor: pointer; text-align: center; padding: 10px;" onclick="openWebRTCHelpModal()">
          <i class="fa-solid fa-circle-exclamation text-danger" style="font-size: 1.8rem; display: block; margin-bottom: 8px; color: var(--danger);"></i>
          <span style="color: var(--danger); font-weight: bold; font-size: 0.9rem; display: block;">خطا در برقراری ارتباط</span>
          <span style="font-size: 0.72rem; display: block; margin-top: 5px; color: var(--accent-blue); text-decoration: underline;">چکار کنم؟ (راهنمای رفع مشکل)</span>
        </div>
      `;
    }
    updateNetworkIndicator('poor', 'خطا در اتصال');
  }
}

function createPeerConnection(targetSocketId, targetUsername) {
  // Check if connection already exists
  if (peerConnections.has(targetSocketId)) {
    return peerConnections.get(targetSocketId);
  }

  const pc = new RTCPeerConnection(WebRTCHelper.ICE_CONFIG);
  const connObj = { pc, stream: null, statsIntervalId: null };
  peerConnections.set(targetSocketId, connObj);

  // Add our local tracks if we are streaming/publishing
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
    console.log(`[WebRTC] Added local media tracks to PeerConnection for ${targetUsername}`);
  }

  // Create the video card immediately in connecting state!
  const isPeerAudioOnly = roomParticipants[targetSocketId]?.isAudioOnly || false;
  createVideoCard(targetSocketId, targetUsername, false, isPeerAudioOnly, null);

  // Set initial state to connecting
  setTimeout(() => handlePeerConnectionStateChange(targetSocketId, targetUsername, pc), 50);

  // Handle Candidate exchange
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('send-ice-candidate', {
        targetSocketId,
        candidate: event.candidate
      });
    }
  };

  // Handle incoming Remote media stream tracks
  pc.ontrack = (event) => {
    console.log(`[WebRTC] Received remote stream track from ${targetUsername}`);
    
    // In Stream mode, remove waiting viewer placeholder when broadcaster stream arrives
    const waitingPlaceholder = document.getElementById('viewerWaitingPlaceholder');
    if (waitingPlaceholder) {
      waitingPlaceholder.remove();
    }

    if (!connObj.stream) {
      connObj.stream = event.streams[0];
      
      const cardId = `video-card-${targetSocketId}`;
      const card = document.getElementById(cardId);
      if (card) {
        let videoElem = card.querySelector('video');
        if (!videoElem) {
          videoElem = document.createElement('video');
          videoElem.autoplay = true;
          videoElem.playsinline = true;
          card.insertBefore(videoElem, card.firstChild);
        }
        videoElem.srcObject = connObj.stream;
        card.classList.add('video-on');
      }
    }
  };

  // Track WebRTC Connection state to alert user of network issues
  pc.onconnectionstatechange = () => {
    handlePeerConnectionStateChange(targetSocketId, targetUsername, pc);
  };

  pc.oniceconnectionstatechange = () => {
    handlePeerConnectionStateChange(targetSocketId, targetUsername, pc);
  };

  // Start real-time WebRTC Network Performance Metrics
  connObj.statsIntervalId = WebRTCHelper.monitorStats(pc, (stats) => {
    updateLiveStatsUI(stats);
  });

  return connObj;
}

// 5. Clean up connection
function closePeerConnection(socketId) {
  const conn = peerConnections.get(socketId);
  if (conn) {
    console.log(`[WebRTC] Closing peer connection for socket: ${socketId}`);
    
    // Stop stats timer
    if (conn.statsIntervalId) {
      clearInterval(conn.statsIntervalId);
    }
    
    // Close connection
    conn.pc.close();
    peerConnections.delete(socketId);

    // Remove video element from DOM
    const videoCard = document.getElementById(`video-card-${socketId}`);
    if (videoCard) {
      videoCard.remove();
    }
    
    reorganizeVideoArenaGrid();
  }
}

// 6. Interactive Video Cards Injection
function createVideoCard(socketId, label, isLocal, isAudioOnly = false, stream = null) {
  const cardId = isLocal ? 'video-card-local' : `video-card-${socketId}`;
  const safeLabel = escapeHTML(label);
  
  // Avoid duplicate card creation
  if (document.getElementById(cardId)) return;

  const card = document.createElement('div');
  card.id = cardId;
  const isVideoOn = !isAudioOnly && (isLocal || stream !== null);
  card.className = `video-card ${isLocal ? '' : 'remote-video'} ${isVideoOn ? 'video-on' : ''}`;

  // Get user initials for placeholder avatar
  const initials = escapeHTML(label.charAt(0) || 'U');

  card.innerHTML = `
    <!-- Video element -->
    ${isAudioOnly ? '' : '<video autoplay playsinline></video>'}

    <!-- Profile placeholder when camera is closed or connecting -->
    <div class="video-placeholder">
      <div class="placeholder-avatar" id="avatar-${cardId}">${initials}</div>
       <div class="placeholder-text" id="status-text-${cardId}">${safeLabel}</div>
    </div>

    <!-- Details Overlay -->
    <div class="video-overlay">
      <div class="overlay-user">
         <span class="username-tag">${safeLabel}</span>
      </div>
      <div class="media-badges">
        <span class="media-badge" id="mic-status-${cardId}"><i class="fa-solid fa-microphone"></i></span>
        <span class="media-badge" id="cam-status-${cardId}"><i class="fa-solid fa-video"></i></span>
      </div>
    </div>
  `;

  videoArena.appendChild(card);

  // Set up src stream
  if (!isAudioOnly && (isLocal || stream)) {
    const videoElem = card.querySelector('video');
    if (isLocal && localStream) {
      videoElem.srcObject = localStream;
      videoElem.muted = true; // Mute local video element to prevent feedback echo loop
    } else if (stream) {
      videoElem.srcObject = stream;
    }
  }

  // If local card, reflect state immediately
  if (isLocal) {
    updatePeerMediaStatus(null, isMicMuted, isCamMuted);
  }

  reorganizeVideoArenaGrid();
}

function reorganizeVideoArenaGrid() {
  const cards = videoArena.querySelectorAll('.video-card');
  const count = cards.length;

  // Clear previous grid classes
  videoArena.className = 'video-arena';

  if (roomType === 'stream' && !isBroadcaster) {
    // Viewer doesn't display local camera card, only broadcaster stream card
    videoArena.classList.add('stream-grid');
  } else {
    // Apply responsive grid layout depending on connection count
    if (count <= 1) {
      videoArena.classList.add('grid-1');
    } else if (count === 2) {
      videoArena.classList.add('grid-2');
    } else if (count === 3) {
      videoArena.classList.add('grid-3');
    } else if (count === 4) {
      videoArena.classList.add('grid-4');
    } else {
      videoArena.classList.add('grid-multi');
    }
  }
}

// 7. Quality Profile Dynamic Tuner (Adaptive Bitrate Controls)
async function changeQualityProfile(event) {
  const selectedProfile = event.target.value;
  if (selectedProfile === currentProfileName) return;

  console.log(`[Tuner] Changing camera capture quality profile to: ${selectedProfile}`);
  currentProfileName = selectedProfile;

  if (!localStream) return;

  try {
    // 1. Get new media stream corresponding to the new profile
    const newStream = await WebRTCHelper.getUserMedia(selectedProfile, currentFacingMode);
    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];

    // 2. Replace tracks on all active peer connections
    peerConnections.forEach(({ pc }) => {
      // Find senders
      const senders = pc.getSenders();
      
      // Update Video track
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && newVideoTrack) {
        videoSender.replaceTrack(newVideoTrack);
        console.log(`[Tuner] Successfully replaced video track on RTCPeerConnection.`);
      } else if (videoSender && !newVideoTrack) {
        // Switch to audio-only: stop video sender completely
        pc.removeTrack(videoSender);
      }

      // Update Audio track
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender && newAudioTrack) {
        audioSender.replaceTrack(newAudioTrack);
      }
    });

    // 3. Stop old local media tracks to free hardware webcam
    localStream.getTracks().forEach(track => track.stop());

    // 4. Assign new stream to active local stream reference
    localStream = newStream;

    // 5. Update local view
    const localVideoCard = document.getElementById('video-card-local');
    if (localVideoCard) {
      const oldVideoElem = localVideoCard.querySelector('video');
      
      if (selectedProfile === 'audio') {
        localVideoCard.classList.remove('video-on');
        if (oldVideoElem) oldVideoElem.remove();
        isCamMuted = true;
      } else {
        localVideoCard.classList.add('video-on');
        let videoElem = oldVideoElem;
        if (!videoElem) {
          videoElem = document.createElement('video');
          videoElem.autoplay = true;
          videoElem.playsinline = true;
          videoElem.muted = true;
          localVideoCard.insertBefore(videoElem, localVideoCard.firstChild);
        }
        videoElem.srcObject = localStream;
        isCamMuted = false;
      }
    }

    // 6. Notify peers about our new camera mute state
    socket.emit('media-state-changed', {
      roomId,
      audioMuted: isMicMuted,
      videoMuted: isCamMuted
    });
    
    // Reflect locally
    updatePeerMediaStatus(null, isMicMuted, isCamMuted);

    console.log(`[Tuner] Live quality transition completed smoothly!`);
  } catch (err) {
    console.error('[Tuner] Error transitioning local stream quality:', err);
    alert('انتقال با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
  }
}

// 7.5 Camera Facing Mode Switcher (Front vs Back camera switching)
async function changeFacingMode(event) {
  const selectedFacingMode = event.target.value;
  if (selectedFacingMode === currentFacingMode) return;

  console.log(`[Tuner] Changing camera facing mode to: ${selectedFacingMode}`);
  currentFacingMode = selectedFacingMode;

  if (!localStream) return;

  try {
    // 1. Get new media stream with the new facing mode and existing quality profile
    const newStream = await WebRTCHelper.getUserMedia(currentProfileName, currentFacingMode);
    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];

    // 2. Replace tracks on all active peer connections
    peerConnections.forEach(({ pc }) => {
      const senders = pc.getSenders();
      
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && newVideoTrack) {
        videoSender.replaceTrack(newVideoTrack);
      }
      
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender && newAudioTrack) {
        audioSender.replaceTrack(newAudioTrack);
      }
    });

    // 3. Stop old local tracks
    localStream.getTracks().forEach(track => track.stop());

    // 4. Assign new stream reference
    localStream = newStream;

    // 5. Update local view
    const localVideoCard = document.getElementById('video-card-local');
    if (localVideoCard) {
      const oldVideoElem = localVideoCard.querySelector('video');
      if (currentProfileName === 'audio') {
        localVideoCard.classList.remove('video-on');
        if (oldVideoElem) oldVideoElem.remove();
        isCamMuted = true;
      } else {
        localVideoCard.classList.add('video-on');
        let videoElem = oldVideoElem;
        if (!videoElem) {
          videoElem = document.createElement('video');
          videoElem.autoplay = true;
          videoElem.playsinline = true;
          videoElem.muted = true;
          localVideoCard.insertBefore(videoElem, localVideoCard.firstChild);
        }
        videoElem.srcObject = localStream;
        isCamMuted = false;
      }
    }

    // 6. Notify peers
    socket.emit('media-state-changed', {
      roomId,
      audioMuted: isMicMuted,
      videoMuted: isCamMuted
    });
    
    updatePeerMediaStatus(null, isMicMuted, isCamMuted);
    console.log(`[Tuner] Facing mode transition completed successfully.`);
  } catch (err) {
    console.error('[Tuner] Error transitioning camera facing mode:', err);
    alert('تغییر دوربین با خطا مواجه شد. شاید این دوربین توسط برنامه دیگری در حال استفاده است یا پشتیبانی نمی‌شود.');
    if (cameraFacingSelect) {
      cameraFacingSelect.value = currentFacingMode;
    }
  }
}

// 8. Live UI Updates (Stats & Signal)
function updateLiveStatsUI(stats) {
  // Update floating panel items
  statLatency.innerText = `${stats.latency} ms`;
  statPacketLoss.innerText = `${stats.packetLoss}%`;
  statDownload.innerText = `${stats.downloadSpeed} kbps`;
  statUpload.innerText = `${stats.uploadSpeed} kbps`;
  statResolution.innerText = stats.videoResolution;

  // Auto fallback to protect connection on massive packet loss
  if (stats.packetLoss > 10 && currentProfileName === 'high') {
    console.warn('[AutoTuner] High packet loss detected. Dropping to low resolution profile to prevent connection crash!');
    qualityProfileSelect.value = 'low';
    qualityProfileSelect.dispatchEvent(new Event('change'));
    addChatMessage('سامانه هوشمند', 'کاهش خودکار کیفیت دوربین به علت افت سرعت اینترنت شما انجام شد.', false, 'سیستم');
  }

  // Update top bar connection signal icon
  updateNetworkIndicator(stats.qualityStatus, stats.qualityStatus === 'good' ? 'اتصال عالی' : stats.qualityStatus === 'medium' ? 'اتصال متوسط' : 'اینترنت ضعیف');
}

function updateNetworkIndicator(status, text) {
  networkSpeedIndicator.className = `network-indicator-bar signal-${status}`;
  networkQualityLabel.innerText = text;
}

// Update participant microphone or video icon mutes in overlay badges
function updatePeerMediaStatus(socketId, audioMuted, videoMuted) {
  const cardId = socketId === null ? 'video-card-local' : `video-card-${socketId}`;
  const card = document.getElementById(cardId);
  if (!card) return;

  const micBadge = document.getElementById(`mic-status-${cardId}`);
  const camBadge = document.getElementById(`cam-status-${cardId}`);

  if (micBadge) {
    if (audioMuted) {
      micBadge.className = 'media-badge muted';
      micBadge.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    } else {
      micBadge.className = 'media-badge';
      micBadge.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    }
  }

  if (camBadge) {
    if (videoMuted) {
      camBadge.className = 'media-badge muted';
      camBadge.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
      card.classList.remove('video-on');
    } else {
      camBadge.className = 'media-badge';
      camBadge.innerHTML = '<i class="fa-solid fa-video"></i>';
      card.classList.add('video-on');
    }
  }
}

// 9. Hardware controls togglers
function toggleMicrophone() {
  if (!localStream) return;
  
  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach(track => track.enabled = !isMicMuted);
  
  if (isMicMuted) {
    toggleMicBtn.classList.add('active');
    toggleMicBtn.querySelector('i').className = 'fa-solid fa-microphone-slash';
  } else {
    toggleMicBtn.classList.remove('active');
    toggleMicBtn.querySelector('i').className = 'fa-solid fa-microphone';
  }

  // Broadcast state
  socket.emit('media-state-changed', {
    roomId,
    audioMuted: isMicMuted,
    videoMuted: isCamMuted
  });

  // Reflect locally
  updatePeerMediaStatus(null, isMicMuted, isCamMuted);
}

function toggleCamera() {
  if (!localStream || currentProfileName === 'audio') return;

  isCamMuted = !isCamMuted;
  localStream.getVideoTracks().forEach(track => track.enabled = !isCamMuted);

  if (isCamMuted) {
    toggleCamBtn.classList.add('active');
    toggleCamBtn.querySelector('i').className = 'fa-solid fa-video-slash';
  } else {
    toggleCamBtn.classList.remove('active');
    toggleCamBtn.querySelector('i').className = 'fa-solid fa-video';
  }

  // Broadcast state
  socket.emit('media-state-changed', {
    roomId,
    audioMuted: isMicMuted,
    videoMuted: isCamMuted
  });

  // Reflect locally
  updatePeerMediaStatus(null, isMicMuted, isCamMuted);
}

// 10. Sidebar Navigation tabs logic
function setupSidebarTabs() {
  tabChatBtn.addEventListener('click', () => {
    tabChatBtn.classList.add('active');
    tabPeersBtn.classList.remove('active');
    panelChat.classList.add('active');
    panelPeers.classList.remove('active');
  });

  tabPeersBtn.addEventListener('click', () => {
    tabPeersBtn.classList.add('active');
    tabChatBtn.classList.remove('active');
    panelPeers.classList.add('active');
    panelChat.classList.remove('active');
  });

  // Text comment input click events
  chatSendBtn.addEventListener('click', sendCommentMessage);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendCommentMessage();
    }
  });
}

// 11. Comments / Chat messages processing
function sendCommentMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit('send-chat-message', {
    roomId,
    message: text,
    username
  });

  chatInput.value = '';
}

function addChatMessage(msgUsername, message, isMe, timestamp) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${isMe ? 'me' : ''}`;

  bubble.innerHTML = `
    <div class="chat-bubble-meta">
       <span style="font-weight: 600; color: ${isMe ? 'var(--accent-purple)' : 'var(--accent-blue)'};">${escapeHTML(msgUsername)}</span>
       <span>${escapeHTML(timestamp)}</span>
    </div>
    <div class="chat-bubble-body">
       ${escapeHTML(message)}
    </div>
  `;

  chatMessages.appendChild(bubble);
  // Auto scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 12. Sync active participant lists tab view
function updateParticipantsList() {
  participantList.innerHTML = '';
  
  // Count viewers for stream rooms
  let viewers = 0;

  Object.values(roomParticipants).forEach(p => {
    const isMe = p.socketId === myActiveSocketId;
    const initials = p.username.charAt(0) || 'U';
    
    // Manage viewer tally
    if (roomType === 'stream' && !p.isBroadcaster) {
      viewers++;
    }

    const item = document.createElement('div');
    item.className = 'participant-item';
    
    let roleName = 'شرکت‌کننده';
    if (roomType === 'stream') {
      roleName = p.isBroadcaster ? 'استریمر (پخش‌کننده)' : 'تماشاگر';
    }

    item.innerHTML = `
      <div class="participant-info">
         <div class="participant-avatar">${escapeHTML(initials)}</div>
        <div class="participant-name-wrapper">
           <span class="participant-name">${escapeHTML(p.username)} ${isMe ? '(شما)' : ''}</span>
          <span class="participant-role">${roleName}</span>
        </div>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-secondary);">
        ${p.isBroadcaster ? '<i class="fa-solid fa-tower-broadcast text-accent" style="color: var(--accent-pink);"></i>' : ''}
      </div>
    `;

    participantList.appendChild(item);
  });

  // Sync viewer tally display
  if (roomType === 'stream') {
    viewerCount.innerText = `${viewers} تماشاچی`;
  }
}

// 13. Teardown
function leaveRoom() {
  if (confirm('آیا مایلید از جلسه خارج شوید؟')) {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    // Stop all peer connections
    peerConnections.forEach((conn) => {
      if (conn.statsIntervalId) clearInterval(conn.statsIntervalId);
      conn.pc.close();
    });

    if (socket) {
      socket.emit('leave-room');
      socket.disconnect();
    }

    window.location.href = '/';
  }
}

// ==========================================
// 14. Extended Application Features
// ==========================================

// Setup all extended features (Whiteboard, Screen Sharing, Sidebar, Camera Flip)
function setupExtendedFeatures() {
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebarPanel = document.getElementById('sidebarPanel');
  const appLayout = document.getElementById('appLayout');
  const toggleCameraFacingBtn = document.getElementById('toggleCameraFacingBtn');
  const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
  const toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  const whiteboardCloseBtn = document.getElementById('whiteboardCloseBtn');
  const whiteboardClearBtn = document.getElementById('whiteboardClearBtn');

  // A. Responsive Sidebar
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebarPanel.classList.toggle('active');
      } else {
        appLayout.classList.toggle('sidebar-collapsed');
      }
    });
  }

  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
      sidebarPanel.classList.remove('active');
    });
  }

  // Handle window resizing
  window.addEventListener('resize', handleResize);
  handleResize();

  // B. Direct Camera Flip Button (Only show on mobile/touch screen when publishing video)
  if (toggleCameraFacingBtn) {
    const isPublishing = (roomType === 'conference' || roomType === 'call' || (roomType === 'stream' && isBroadcaster));
    if (isPublishing && ('ontouchstart' in window || window.innerWidth <= 768)) {
      toggleCameraFacingBtn.style.display = 'inline-flex';
    }
    
    toggleCameraFacingBtn.addEventListener('click', async () => {
      const targetFacing = currentFacingMode === 'user' ? 'environment' : 'user';
      
      const icon = toggleCameraFacingBtn.querySelector('i');
      if (icon) {
        icon.style.transition = 'transform 0.5s ease';
        icon.style.transform = icon.style.transform === 'rotate(180deg)' ? 'rotate(360deg)' : 'rotate(180deg)';
      }
      
      await switchCamera(targetFacing);
    });
  }

  // C. Screen Sharing Button
  if (toggleScreenShareBtn) {
    const isPublishing = (roomType === 'conference' || roomType === 'call' || (roomType === 'stream' && isBroadcaster));
    if (!isPublishing || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toggleScreenShareBtn.style.display = 'none';
    } else {
      toggleScreenShareBtn.addEventListener('click', toggleScreenShare);
    }
  }

  // D. Whiteboard Toggle and Canvas setup
  if (toggleWhiteboardBtn) {
    toggleWhiteboardBtn.addEventListener('click', toggleWhiteboard);
  }
  if (whiteboardCloseBtn) {
    whiteboardCloseBtn.addEventListener('click', closeWhiteboard);
  }

  // Whiteboard control options
  const colorDots = document.querySelectorAll('.color-dot');
  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      colorDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      currentColor = dot.getAttribute('data-color');
      selectTool('pen');
    });
  });

  const sizeThin = document.getElementById('penSizeThin');
  const sizeMedium = document.getElementById('penSizeMedium');
  const sizeThick = document.getElementById('penSizeThick');
  const sizeBtns = [sizeThin, sizeMedium, sizeThick];

  if (sizeThin) {
    sizeThin.addEventListener('click', () => {
      sizeBtns.forEach(b => b?.classList.remove('active'));
      sizeThin.classList.add('active');
      currentBrushSize = 3;
    });
  }
  if (sizeMedium) {
    sizeMedium.addEventListener('click', () => {
      sizeBtns.forEach(b => b?.classList.remove('active'));
      sizeMedium.classList.add('active');
      currentBrushSize = 6;
    });
  }
  if (sizeThick) {
    sizeThick.addEventListener('click', () => {
      sizeBtns.forEach(b => b?.classList.remove('active'));
      sizeThick.classList.add('active');
      currentBrushSize = 12;
    });
  }

  const toolPen = document.getElementById('whiteboardToolPen');
  const toolEraser = document.getElementById('whiteboardToolEraser');
  
  if (toolPen) {
    toolPen.addEventListener('click', () => selectTool('pen'));
  }
  if (toolEraser) {
    toolEraser.addEventListener('click', () => selectTool('eraser'));
  }

  if (whiteboardClearBtn) {
    whiteboardClearBtn.addEventListener('click', () => {
      if (confirm('آیا مایلید کل تخته رسم را پاک کنید؟')) {
        clearLocalCanvas();
        if (socket) {
          socket.emit('whiteboard-clear', { roomId });
        }
      }
    });
  }

  // Setup Canvas Event Listeners
  if (whiteboardCanvas) {
    whiteboardCanvas.addEventListener('mousedown', startDrawing);
    whiteboardCanvas.addEventListener('mousemove', draw);
    whiteboardCanvas.addEventListener('mouseup', stopDrawing);
    whiteboardCanvas.addEventListener('mouseout', stopDrawing);

    whiteboardCanvas.addEventListener('touchstart', (e) => {
      startDrawing(e);
    }, { passive: false });
    
    whiteboardCanvas.addEventListener('touchmove', (e) => {
      draw(e);
    }, { passive: false });
    
    whiteboardCanvas.addEventListener('touchend', stopDrawing);
  }
}

// Resize sidebar and reset styles dynamically
function handleResize() {
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebarPanel = document.getElementById('sidebarPanel');
  const appLayout = document.getElementById('appLayout');

  if (window.innerWidth <= 768) {
    if (closeSidebarBtn) closeSidebarBtn.style.display = 'block';
    if (appLayout) appLayout.classList.remove('sidebar-collapsed');
  } else {
    if (closeSidebarBtn) closeSidebarBtn.style.display = 'none';
    if (sidebarPanel) sidebarPanel.classList.remove('active');
  }
}

// Camera toggle / direct camera flip core implementation
async function switchCamera(facingMode) {
  if (facingMode === currentFacingMode) return;
  console.log(`[Tuner] Swapping camera to: ${facingMode}`);
  currentFacingMode = facingMode;

  if (!localStream) return;

  try {
    const newStream = await WebRTCHelper.getUserMedia(currentProfileName, currentFacingMode);
    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];

    peerConnections.forEach(({ pc }) => {
      const senders = pc.getSenders();
      
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && newVideoTrack) {
        videoSender.replaceTrack(newVideoTrack);
      }
      
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      if (audioSender && newAudioTrack) {
        audioSender.replaceTrack(newAudioTrack);
      }
    });

    localStream.getTracks().forEach(track => track.stop());
    localStream = newStream;

    const localVideoCard = document.getElementById('video-card-local');
    if (localVideoCard) {
      const oldVideoElem = localVideoCard.querySelector('video');
      if (currentProfileName === 'audio') {
        localVideoCard.classList.remove('video-on');
        if (oldVideoElem) oldVideoElem.remove();
        isCamMuted = true;
      } else {
        localVideoCard.classList.add('video-on');
        let videoElem = oldVideoElem;
        if (!videoElem) {
          videoElem = document.createElement('video');
          videoElem.autoplay = true;
          videoElem.playsinline = true;
          videoElem.muted = true;
          localVideoCard.insertBefore(videoElem, localVideoCard.firstChild);
        }
        videoElem.srcObject = localStream;
        isCamMuted = false;
      }
    }

    socket.emit('media-state-changed', {
      roomId,
      audioMuted: isMicMuted,
      videoMuted: isCamMuted
    });
    
    updatePeerMediaStatus(null, isMicMuted, isCamMuted);
    
    const cameraFacingSelect = document.getElementById('cameraFacingSelect');
    if (cameraFacingSelect) {
      cameraFacingSelect.value = currentFacingMode;
    }
    
    console.log(`[Tuner] Facing mode transition completed successfully.`);
  } catch (err) {
    console.error('[Tuner] Error transitioning camera facing mode:', err);
    alert('تغییر دوربین با خطا مواجه شد. شاید این دوربین توسط برنامه دیگری در حال استفاده است یا پشتیبانی نمی‌شود.');
    const cameraFacingSelect = document.getElementById('cameraFacingSelect');
    if (cameraFacingSelect) {
      cameraFacingSelect.value = currentFacingMode;
    }
  }
}

// Screen sharing controls
async function toggleScreenShare() {
  const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
  if (!isScreenSharing) {
    try {
      console.log('[Media] Requesting getDisplayMedia for screen sharing');
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always"
        },
        audio: false
      });

      isScreenSharing = true;
      if (toggleScreenShareBtn) {
        toggleScreenShareBtn.classList.add('active');
        toggleScreenShareBtn.style.color = 'var(--accent-pink)';
        toggleScreenShareBtn.style.borderColor = 'rgba(236, 72, 153, 0.4)';
      }
      
      const screenTrack = screenStream.getVideoTracks()[0];

      peerConnections.forEach(({ pc }) => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && screenTrack) {
          videoSender.replaceTrack(screenTrack);
        }
      });

      const localVideoCard = document.getElementById('video-card-local');
      if (localVideoCard) {
        const videoElem = localVideoCard.querySelector('video');
        if (videoElem) {
          videoElem.srcObject = screenStream;
        }
      }

      screenTrack.onended = () => {
        stopScreenShare();
      };

      showWelcomeToast('اشتراک‌گذاری صفحه نمایش شما آغاز شد.', 'اشتراک صفحه');
    } catch (err) {
      console.error('[ScreenShare] Error starting screen share:', err);
      if (err.name !== 'NotAllowedError') {
        alert('خطا در شروع اشتراک‌گذاری صفحه.');
      }
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (!isScreenSharing) return;

  console.log('[ScreenShare] Stopping screen share and reverting to camera');
  isScreenSharing = false;
  
  const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
  if (toggleScreenShareBtn) {
    toggleScreenShareBtn.classList.remove('active');
    toggleScreenShareBtn.style.color = '';
    toggleScreenShareBtn.style.borderColor = '';
  }

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  if (localStream) {
    const cameraTrack = localStream.getVideoTracks()[0];
    
    peerConnections.forEach(({ pc }) => {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && cameraTrack) {
        cameraTrack.enabled = !isCamMuted;
        videoSender.replaceTrack(cameraTrack);
      }
    });

    const localVideoCard = document.getElementById('video-card-local');
    if (localVideoCard) {
      const videoElem = localVideoCard.querySelector('video');
      if (videoElem) {
        videoElem.srcObject = localStream;
      }
    }
  }

  showWelcomeToast('اشتراک‌گذاری صفحه نمایش متوقف شد.', 'اشتراک صفحه');
}

// Cooperative Whiteboard drawing methods
function toggleWhiteboard() {
  const whiteboardContainer = document.getElementById('whiteboardContainer');
  const toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
  
  if (!isWhiteboardActive) {
    isWhiteboardActive = true;
    if (whiteboardContainer) whiteboardContainer.style.display = 'flex';
    if (toggleWhiteboardBtn) {
      toggleWhiteboardBtn.classList.add('active');
      toggleWhiteboardBtn.style.color = 'var(--accent-pink)';
      toggleWhiteboardBtn.style.borderColor = 'rgba(236, 72, 153, 0.4)';
    }
    setTimeout(resizeCanvas, 50);
  } else {
    closeWhiteboard();
  }
}

function closeWhiteboard() {
  isWhiteboardActive = false;
  const whiteboardContainer = document.getElementById('whiteboardContainer');
  const toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
  
  if (whiteboardContainer) whiteboardContainer.style.display = 'none';
  if (toggleWhiteboardBtn) {
    toggleWhiteboardBtn.classList.remove('active');
    toggleWhiteboardBtn.style.color = '';
    toggleWhiteboardBtn.style.borderColor = '';
  }
}

function resizeCanvas() {
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  if (!whiteboardCanvas || whiteboardCanvas.offsetParent === null) return;

  const rect = whiteboardCanvas.parentElement.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = whiteboardCanvas.width;
  tempCanvas.height = whiteboardCanvas.height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(whiteboardCanvas, 0, 0);

  whiteboardCanvas.width = width;
  whiteboardCanvas.height = height;

  const ctx = whiteboardCanvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, width, height);
}

function selectTool(tool) {
  currentTool = tool;
  const toolPen = document.getElementById('whiteboardToolPen');
  const toolEraser = document.getElementById('whiteboardToolEraser');
  
  if (tool === 'pen') {
    toolPen?.classList.add('active');
    toolEraser?.classList.remove('active');
  } else {
    toolEraser?.classList.add('active');
    toolPen?.classList.remove('active');
  }
}

function clearLocalCanvas() {
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  if (!whiteboardCanvas) return;
  const ctx = whiteboardCanvas.getContext('2d');
  ctx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
}

function getCanvasCoords(e) {
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  const rect = whiteboardCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function startDrawing(e) {
  isDrawing = true;
  const coords = getCanvasCoords(e);
  lastX = coords.x;
  lastY = coords.y;
}

function draw(e) {
  if (!isDrawing) return;
  if (e.cancelable) e.preventDefault();

  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  const coords = getCanvasCoords(e);
  const x = coords.x;
  const y = coords.y;

  drawSegment(lastX, lastY, x, y, currentColor, currentBrushSize, currentTool === 'eraser');

  if (socket) {
    const x0Norm = lastX / whiteboardCanvas.width;
    const y0Norm = lastY / whiteboardCanvas.height;
    const x1Norm = x / whiteboardCanvas.width;
    const y1Norm = y / whiteboardCanvas.height;

    socket.emit('whiteboard-draw', {
      roomId,
      x0: x0Norm,
      y0: y0Norm,
      x1: x1Norm,
      y1: y1Norm,
      color: currentColor,
      size: currentBrushSize,
      isEraser: currentTool === 'eraser'
    });
  }

  lastX = x;
  lastY = y;
}

function stopDrawing() {
  isDrawing = false;
}

function drawSegment(x0, y0, x1, y1, color, size, isEraser) {
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  if (!whiteboardCanvas) return;
  const ctx = whiteboardCanvas.getContext('2d');
  
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  
  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = size * 3.0; // Eraser multiplier for touch screens
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
  }
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.closePath();
}

function drawReceivedSegment(x0Norm, y0Norm, x1Norm, y1Norm, color, size, isEraser) {
  const whiteboardCanvas = document.getElementById('whiteboardCanvas');
  if (!whiteboardCanvas) return;
  const x0 = x0Norm * whiteboardCanvas.width;
  const y0 = y0Norm * whiteboardCanvas.height;
  const x1 = x1Norm * whiteboardCanvas.width;
  const y1 = y1Norm * whiteboardCanvas.height;
  
  drawSegment(x0, y0, x1, y1, color, size, isEraser);
}

// Slide-in glassmorphic notification toasts
function showWelcomeToast(message, title = 'اطلاعیه') {
  const container = document.getElementById('welcomeToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'welcome-toast glass';
  
  let iconClass = 'fa-bell';
  if (title === 'خوش‌آمدگویی') iconClass = 'fa-hand-peace';
  else if (title === 'ورود کاربر') iconClass = 'fa-user-plus';
  else if (title === 'خروج کاربر') iconClass = 'fa-user-minus';
  else if (title === 'تخته رسم') iconClass = 'fa-palette';
  else if (title === 'اشتراک صفحه') iconClass = 'fa-desktop';

  toast.innerHTML = `
    <div class="toast-icon">
      <i class="fa-solid ${iconClass}"></i>
    </div>
    <div class="toast-content">
       <h4>${escapeHTML(title)}</h4>
       <p>${escapeHTML(message)}</p>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4500);
}

// Start core sequence
window.addEventListener('DOMContentLoaded', init);
