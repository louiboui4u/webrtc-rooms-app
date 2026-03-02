import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';

const socket = io();

// UI Elements
const lobbyView = document.getElementById('lobby-view');
const roomView = document.getElementById('room-view');
const roomList = document.getElementById('room-list');
const videoGrid = document.getElementById('video-grid');
const currentRoomName = document.getElementById('current-room-name');

// Modals
const createRoomModal = new bootstrap.Modal(document.getElementById('createRoomModal'));
const passwordModal = new bootstrap.Modal(document.getElementById('passwordModal'));
const usernameModal = new bootstrap.Modal(document.getElementById('usernameModal'));

// State
let localStream;
let processedStream;
let audioContext;
let rnnoiseWasmBinary;
let peers = {}; // socketId -> RTCPeerConnection
let peerUsernames = {}; // socketId -> username
let currentRoomId = null;
let pendingJoinRoomId = null;
let currentUsername = localStorage.getItem('username') || '';

// Settings
const noisetorchToggle = document.getElementById('noisetorch-toggle');
const isNoiseTorchEnabled = localStorage.getItem('noisetorch') === 'true';

// We do NOT disable browser filters anymore because RNNoise runs better alongside basic echo cancellation
function getAudioConstraints() {
    return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    };
}

noisetorchToggle.checked = isNoiseTorchEnabled;

noisetorchToggle.addEventListener('change', (e) => {
    const enable = e.target.checked;
    localStorage.setItem('noisetorch', enable);
    
    // Restart mic test if it is running
    if (micTestStream) {
        stopMicTest();
        setTimeout(toggleMicTest, 500); 
    }
    
    // If in a room, we should ideally re-process the stream, but for simplicity we rely on next join
});

// Audio Processing setup
async function setupAudioProcessing(rawStream) {
    const useNoiseTorch = localStorage.getItem('noisetorch') === 'true';
    if (!useNoiseTorch) return rawStream;

    try {
        if (!audioContext) {
            audioContext = new AudioContext({ sampleRate: 48000 });
            rnnoiseWasmBinary = await loadRnnoise({ 
                url: '/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm',
                simdUrl: '/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise_simd.wasm'
            });
            await audioContext.audioWorklet.addModule('/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js');
        }

        const source = audioContext.createMediaStreamSource(rawStream);
        const rnnoise = new RnnoiseWorkletNode(audioContext, {
            wasmBinary: rnnoiseWasmBinary,
            maxChannels: 1
        });
        const destination = audioContext.createMediaStreamDestination();

        source.connect(rnnoise);
        rnnoise.connect(destination);

        // Merge processed audio with raw video
        const processedAudioTracks = destination.stream.getAudioTracks();
        const videoTracks = rawStream.getVideoTracks();
        
        return new MediaStream([...videoTracks, ...processedAudioTracks]);
    } catch (e) {
        console.error("Failed to setup in-app RNNoise processing:", e);
        return rawStream; // fallback
    }
}

// Mic Test Logic
let micTestStream = null;
const micTestBtn = document.getElementById('mic-test-btn');
const micTestAudio = document.getElementById('mic-test-audio');
const settingsModal = document.getElementById('settingsModal');

async function toggleMicTest() {
    if (!micTestStream) {
        try {
            const rawStream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints() });
            micTestStream = await setupAudioProcessing(rawStream);
            micTestAudio.srcObject = micTestStream;
            micTestBtn.textContent = 'Stop Mic Test';
            micTestBtn.classList.remove('btn-outline-primary');
            micTestBtn.classList.add('btn-danger');
        } catch (err) {
            alert('Could not access microphone for testing: ' + err.message);
        }
    } else {
        stopMicTest();
    }
}

function stopMicTest() {
    if (micTestStream) {
        micTestStream.getTracks().forEach(track => track.stop());
        micTestStream = null;
        micTestAudio.srcObject = null;
        micTestBtn.textContent = 'Start Mic Test';
        micTestBtn.classList.remove('btn-danger');
        micTestBtn.classList.add('btn-outline-primary');
    }
}

micTestBtn.addEventListener('click', toggleMicTest);

// Stop mic test when settings modal is closed
settingsModal.addEventListener('hidden.bs.modal', stopMicTest);

// Username Logic
if (!currentUsername) {
    usernameModal.show();
} else {
    socket.emit('set-username', currentUsername);
}

document.getElementById('save-username-btn').addEventListener('click', () => {
    const name = document.getElementById('username-input').value.trim();
    if (name) {
        currentUsername = name;
        localStorage.setItem('username', name);
        socket.emit('set-username', name);
        usernameModal.hide();
    }
});

document.getElementById('change-username-btn').addEventListener('click', () => {
    document.getElementById('username-input').value = currentUsername;
    usernameModal.show();
});

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- Lobby Logic ---

socket.on('update-rooms', (rooms) => {
    roomList.innerHTML = '';
    if (rooms.length === 0) {
        roomList.innerHTML = '<div class="col-12 text-center text-muted mt-5"><h5>No rooms available. Be the first to create one!</h5></div>';
        return;
    }
    
    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'col-md-4 mb-4';
        card.innerHTML = `
            <div class="card room-card h-100" onclick="attemptJoinRoom('${room.id}', ${room.hasPassword}, '${room.name}')">
                <div class="card-body">
                    <h5 class="card-title d-flex justify-content-between align-items-center">
                        ${room.name}
                        <span class="badge ${room.hasPassword ? 'bg-warning text-dark' : 'bg-success'}">
                            ${room.hasPassword ? '🔒 Password' : '🔓 Public'}
                        </span>
                    </h5>
                    <p class="card-text text-muted mb-0 mt-3">
                        <small>👥 ${room.userCount} participant(s)</small>
                    </p>
                </div>
            </div>
        `;
        roomList.appendChild(card);
    });
});

document.getElementById('create-room-btn').addEventListener('click', () => {
    const name = document.getElementById('new-room-name').value.trim();
    const password = document.getElementById('new-room-password').value;
    
    if (!name) return alert('Room name is required');

    socket.emit('create-room', { name, password }, (res) => {
        if (res.success) {
            createRoomModal.hide();
            // Clear inputs for next time
            document.getElementById('new-room-name').value = '';
            document.getElementById('new-room-password').value = '';
            
            joinRoom(res.roomId, password, name);
        }
    });
});

window.attemptJoinRoom = (roomId, hasPassword, roomName) => {
    if (hasPassword) {
        pendingJoinRoomId = roomId;
        document.getElementById('join-room-password').value = '';
        document.getElementById('password-error').classList.add('d-none');
        document.getElementById('passwordModal').querySelector('.modal-title').textContent = `Join "${roomName}"`;
        passwordModal.show();
    } else {
        joinRoom(roomId, null, roomName);
    }
};

document.getElementById('join-room-btn').addEventListener('click', () => {
    const password = document.getElementById('join-room-password').value;
    const roomName = document.getElementById('passwordModal').querySelector('.modal-title').textContent.replace('Join "', '').replace('"', '');
    joinRoom(pendingJoinRoomId, password, roomName);
});

async function joinRoom(roomId, password, roomName) {
    let rawStream;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: getAudioConstraints() });
    } catch (err) {
        console.error('Failed to get local stream', err);
        
        try {
            console.log("Trying fallback to video only or audio only...");
            rawStream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null) 
                          || await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints() }).catch(() => null);
            
            if (!rawStream) throw new Error(err.message + " (Fallback also failed)");
            
            alert(`Warning: Could only access partial media. Some devices might be missing.\nOriginal error: ${err.name} - ${err.message}`);
        } catch (fallbackErr) {
            alert(`Could not access camera/microphone.\nError: ${err.name} - ${err.message}\nEnsure your devices are plugged in and not used by another app.`);
            return;
        }
    }

    localStream = await setupAudioProcessing(rawStream);

    socket.emit('join-room', { roomId, password }, (res) => {
        if (res.success) {
            if (pendingJoinRoomId) passwordModal.hide();
            
            currentRoomId = roomId;
            currentRoomName.textContent = roomName;
            
            lobbyView.classList.add('d-none');
            roomView.classList.remove('d-none');
            
            addVideoStream('local-video', localStream, true, currentUsername + ' (You)');

            // Connect to existing users
            res.users.forEach(user => {
                peerUsernames[user.id] = user.username;
                callUser(user.id);
            });
        } else {
            if (pendingJoinRoomId) {
                const errDiv = document.getElementById('password-error');
                errDiv.textContent = res.message;
                errDiv.classList.remove('d-none');
            } else {
                alert(res.message);
                // Clean up local stream if failed to join
                if(localStream) {
                    localStream.getTracks().forEach(track => track.stop());
                }
            }
        }
    });
}

// --- Room & WebRTC Logic ---

document.getElementById('leave-room-btn').addEventListener('click', () => {
    socket.emit('leave-room');
    
    // Cleanup
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peers).forEach(pc => pc.close());
    peers = {};
    peerUsernames = {};
    
    videoGrid.innerHTML = '';
    
    roomView.classList.add('d-none');
    lobbyView.classList.remove('d-none');
    currentRoomId = null;
    pendingJoinRoomId = null;
});

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetId] = pc;

    // Add local tracks
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    // Handle remote tracks
    pc.ontrack = (event) => {
        addVideoStream(`video-${targetId}`, event.streams[0], false, peerUsernames[targetId] || 'Unknown User');
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetId, candidate: event.candidate });
        }
    };

    // Handle disconnects
    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            removeVideoStream(`video-${targetId}`);
            if (peers[targetId]) {
                peers[targetId].close();
                delete peers[targetId];
            }
        }
    };

    return pc;
}

async function callUser(targetId) {
    const pc = createPeerConnection(targetId);
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: targetId, caller: socket.id, sdp: offer });
    } catch(e) {
        console.error("Error creating offer:", e);
    }
}

// The new user will call us, we wait for the offer.
socket.on('user-connected', (user) => {
    console.log('User joined room:', user.id);
    peerUsernames[user.id] = user.username;
});

socket.on('user-disconnected', (userId) => {
    console.log('User left room:', userId);
    removeVideoStream(`video-${userId}`);
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
        delete peerUsernames[userId];
    }
});

socket.on('offer', async ({ caller, sdp }) => {
    const pc = createPeerConnection(caller);
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { target: caller, caller: socket.id, sdp: answer });
    } catch(e) {
        console.error("Error handling offer:", e);
    }
});

socket.on('answer', async ({ caller, sdp }) => {
    const pc = peers[caller];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch(e) {
            console.error("Error setting remote description from answer:", e);
        }
    }
});

socket.on('ice-candidate', async ({ sender, candidate }) => {
    const pc = peers[sender];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ice candidate', e);
        }
    }
});

// --- UI Controls ---

function addVideoStream(id, stream, isLocal, username = '') {
    if (document.getElementById(id)) return; // Prevent duplicates

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `container-${id}`;

    const video = document.createElement('video');
    video.id = id;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
        video.muted = true; // Mute local video to prevent echo feedback
    }

    container.appendChild(video);

    if (username) {
        const badge = document.createElement('div');
        badge.className = 'username-badge';
        badge.textContent = username;
        container.appendChild(badge);
    }

    videoGrid.appendChild(container);
}

function removeVideoStream(id) {
    const container = document.getElementById(`container-${id}`);
    if (container) {
        container.remove();
    }
}

let audioEnabled = true;
let videoEnabled = true;

document.getElementById('toggle-audio').addEventListener('click', (e) => {
    audioEnabled = !audioEnabled;
    const audioTrack = localStream.getAudioTracks()[0];
    if(audioTrack) {
        audioTrack.enabled = audioEnabled;
    }
    e.target.textContent = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
    e.target.classList.toggle('btn-outline-light');
    e.target.classList.toggle('btn-danger');
});

document.getElementById('toggle-video').addEventListener('click', (e) => {
    videoEnabled = !videoEnabled;
    const videoTrack = localStream.getVideoTracks()[0];
    if(videoTrack) {
        videoTrack.enabled = videoEnabled;
    }
    e.target.textContent = videoEnabled ? 'Stop Video' : 'Start Video';
    e.target.classList.toggle('btn-outline-light');
    e.target.classList.toggle('btn-danger');
});

// --- Screen Share Logic ---
let screenStream = null;

document.getElementById('share-screen').addEventListener('click', async (e) => {
    if (!screenStream) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track for local video element
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                // Keep local audio track
                const audioTracks = localStream.getAudioTracks();
                const tracks = [screenTrack];
                if (audioTracks.length > 0) tracks.push(audioTracks[0]);
                localVideo.srcObject = new MediaStream(tracks);
            }

            // Replace track for all peers
            for (let peerId in peers) {
                const pc = peers[peerId];
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            }
            
            e.target.textContent = 'Stop Sharing';
            e.target.classList.remove('btn-outline-info');
            e.target.classList.add('btn-info', 'text-white');

            // Handle native stop sharing button
            screenTrack.onended = () => {
                stopScreenShare(e.target);
            };
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    } else {
        stopScreenShare(e.target);
    }
});

function stopScreenShare(button) {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        const videoTrack = localStream.getVideoTracks()[0];
        
        // Revert local video
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }

        // Revert track for peers
        for (let peerId in peers) {
            const pc = peers[peerId];
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
            }
        }
        
        button.textContent = 'Share Screen';
        button.classList.remove('btn-info', 'text-white');
        button.classList.add('btn-outline-info');
    }
}