import { RnnoiseWorkletNode, NoiseGateWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import { joinRoom as tryJoinRoom } from 'https://esm.run/trystero/torrent';

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
let audioContext;
let rnnoiseWasmBinary;
let peerUsernames = {}; // peerId -> username
let currentRoomId = null;
let pendingJoinRoomId = null;
let currentUsername = localStorage.getItem('username') || '';
let currentCallRoom = null; // Trystero Room instance for the call

// --- Settings ---
const noisetorchToggle = document.getElementById('noisetorch-toggle');
const vadThresholdSlider = document.getElementById('vad-threshold');
const vadThresholdVal = document.getElementById('vad-threshold-val');

const isNoiseTorchEnabled = localStorage.getItem('noisetorch') === 'true';
let currentVadThreshold = parseFloat(localStorage.getItem('vadThreshold')) || -50;

noisetorchToggle.checked = isNoiseTorchEnabled;
vadThresholdSlider.value = currentVadThreshold;
vadThresholdVal.textContent = currentVadThreshold;

function getAudioConstraints() {
    return {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    };
}

noisetorchToggle.addEventListener('change', (e) => {
    localStorage.setItem('noisetorch', e.target.checked);
    if (micTestStream) {
        stopMicTest();
        setTimeout(toggleMicTest, 500);
    }
});

vadThresholdSlider.addEventListener('input', (e) => {
    currentVadThreshold = parseFloat(e.target.value);
    vadThresholdVal.textContent = currentVadThreshold;
});

vadThresholdSlider.addEventListener('change', (e) => {
    localStorage.setItem('vadThreshold', currentVadThreshold);
    if (micTestStream) {
        stopMicTest();
        setTimeout(toggleMicTest, 500);
    }
});

// --- Audio Processing pipeline ---
async function setupAudioProcessing(rawStream) {
    const useNoiseTorch = localStorage.getItem('noisetorch') === 'true';

    try {
        if (!audioContext) {
            audioContext = new AudioContext({ sampleRate: 48000 });
            rnnoiseWasmBinary = await loadRnnoise({
                url: '/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm',
                simdUrl: '/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise_simd.wasm'
            });
            await audioContext.audioWorklet.addModule('/node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js');
            await audioContext.audioWorklet.addModule('/node_modules/@sapphi-red/web-noise-suppressor/dist/noiseGate/workletProcessor.js');
        }

        const source = audioContext.createMediaStreamSource(rawStream);
        let lastNode = source;

        if (useNoiseTorch) {
            const rnnoise = new RnnoiseWorkletNode(audioContext, {
                wasmBinary: rnnoiseWasmBinary,
                maxChannels: 1
            });
            lastNode.connect(rnnoise);
            lastNode = rnnoise;
        }

        const noiseGate = new NoiseGateWorkletNode(audioContext, {
            openThreshold: currentVadThreshold,
            closeThreshold: currentVadThreshold - 5,
            holdMs: 300,
            maxChannels: 1
        });

        lastNode.connect(noiseGate);
        lastNode = noiseGate;
        
        const merger = audioContext.createChannelMerger(2);
        lastNode.connect(merger, 0, 0); 
        lastNode.connect(merger, 0, 1); 

        const destination = audioContext.createMediaStreamDestination();
        merger.connect(destination);

        const processedAudioTracks = destination.stream.getAudioTracks();
        const videoTracks = rawStream.getVideoTracks();
        
        return new MediaStream([...videoTracks, ...processedAudioTracks]);
    } catch (e) {
        console.error("Failed to setup audio processing:", e);
        return rawStream;
    }
}

// --- Mic Test Logic ---
let micTestStream = null;
const micTestBtn = document.getElementById('mic-test-btn');
const micTestAudio = document.getElementById('mic-test-audio');
const settingsModal = document.getElementById('settingsModal');

let meterAnimationId = null;
let meterAudioContext = null;
let meterAnalyser = null;
let meterSource = null;
const volumeMeter = document.getElementById('volume-meter');
const currentVolumeVal = document.getElementById('current-volume-val');

function startVolumeMeter(stream) {
    if (!meterAudioContext) meterAudioContext = new AudioContext();
    meterAnalyser = meterAudioContext.createAnalyser();
    meterAnalyser.fftSize = 512;
    meterAnalyser.smoothingTimeConstant = 0.5;
    
    meterSource = meterAudioContext.createMediaStreamSource(stream);
    meterSource.connect(meterAnalyser);

    const dataArray = new Float32Array(meterAnalyser.fftSize);

    function updateMeter() {
        if (!meterAnalyser) return;
        meterAnalyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0.0;
        for (const amplitude of dataArray) sumSquares += amplitude * amplitude;
        const rms = Math.sqrt(sumSquares / dataArray.length);
        
        let volumeDb = 20 * Math.log10(rms);
        if (!isFinite(volumeDb) || volumeDb < -100) volumeDb = -100;
        if (volumeDb > 0) volumeDb = 0;

        currentVolumeVal.textContent = Math.round(volumeDb);
        const percent = Math.max(0, 100 + volumeDb);
        volumeMeter.style.width = percent + '%';

        if (volumeDb >= currentVadThreshold) {
            volumeMeter.classList.remove('bg-secondary');
            volumeMeter.classList.add('bg-success');
        } else {
            volumeMeter.classList.remove('bg-success');
            volumeMeter.classList.add('bg-secondary');
        }

        meterAnimationId = requestAnimationFrame(updateMeter);
    }
    updateMeter();
}

function stopVolumeMeter() {
    if (meterAnimationId) {
        cancelAnimationFrame(meterAnimationId);
        meterAnimationId = null;
    }
    if (meterSource) {
        meterSource.disconnect();
        meterSource = null;
    }
    if (meterAnalyser) {
        meterAnalyser.disconnect();
        meterAnalyser = null;
    }
    volumeMeter.style.width = '0%';
    currentVolumeVal.textContent = '-100';
}

async function toggleMicTest() {
    if (!micTestStream) {
        try {
            const rawStream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints() });
            startVolumeMeter(rawStream);
            micTestStream = await setupAudioProcessing(rawStream);
            micTestAudio.srcObject = micTestStream;
            micTestBtn.textContent = 'Stop Mic Test';
            micTestBtn.classList.remove('btn-outline-primary');
            micTestBtn.classList.add('btn-danger');
        } catch (err) {
            alert('Could not access microphone: ' + err.message);
        }
    } else {
        stopMicTest();
    }
}

function stopMicTest() {
    stopVolumeMeter();
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
settingsModal.addEventListener('hidden.bs.modal', stopMicTest);


// --- Username Logic ---
if (!currentUsername) {
    usernameModal.show();
}

document.getElementById('save-username-btn').addEventListener('click', () => {
    const name = document.getElementById('username-input').value.trim();
    if (name) {
        currentUsername = name;
        localStorage.setItem('username', name);
        usernameModal.hide();
    }
});

document.getElementById('change-username-btn').addEventListener('click', () => {
    document.getElementById('username-input').value = currentUsername;
    usernameModal.show();
});

// --- Decentralized Global Lobby ---
const APP_ID = 'webrtc-rooms-louis-v1';
const globalLobby = tryJoinRoom({ appId: APP_ID }, 'global-lobby');
const [sendRooms, getRooms] = globalLobby.makeAction('rooms');

let activeRooms = {}; // { roomId: { id, name, hasPassword } }
let knownRoomsByPeer = {}; // { peerId: { roomId: { ... } } }

function updateLobbyUI() {
    roomList.innerHTML = '';
    const allRoomsMap = { ...activeRooms };
    
    Object.values(knownRoomsByPeer).forEach(peerRooms => {
        Object.assign(allRoomsMap, peerRooms);
    });
    
    const rooms = Object.values(allRoomsMap);

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
                        <small>🟢 Click to join</small>
                    </p>
                </div>
            </div>
        `;
        roomList.appendChild(card);
    });
}

function broadcastMyRooms(targetPeer = null) {
    if (Object.keys(activeRooms).length > 0) {
        sendRooms(activeRooms, targetPeer);
    }
}

globalLobby.onPeerJoin(peerId => {
    broadcastMyRooms(peerId);
});

globalLobby.onPeerLeave(peerId => {
    delete knownRoomsByPeer[peerId];
    updateLobbyUI();
});

getRooms((rooms, peerId) => {
    knownRoomsByPeer[peerId] = rooms;
    updateLobbyUI();
});

// Initial render
updateLobbyUI();

// --- Room Creation & Joining ---
document.getElementById('create-room-btn').addEventListener('click', () => {
    if(!currentUsername) {
        alert("Please set your name first.");
        createRoomModal.hide();
        usernameModal.show();
        return;
    }

    const name = document.getElementById('new-room-name').value.trim();
    const password = document.getElementById('new-room-password').value;
    
    if (!name) return alert('Room name is required');

    const roomId = 'room_' + Math.random().toString(36).substring(2, 11);
    
    createRoomModal.hide();
    document.getElementById('new-room-name').value = '';
    document.getElementById('new-room-password').value = '';
    
    joinVideoRoom(roomId, password, name);
});

window.attemptJoinRoom = (roomId, hasPassword, roomName) => {
    if(!currentUsername) {
        alert("Please set your name first.");
        usernameModal.show();
        return;
    }

    if (hasPassword) {
        pendingJoinRoomId = roomId;
        document.getElementById('join-room-password').value = '';
        document.getElementById('passwordModal').querySelector('.modal-title').textContent = `Join "${roomName}"`;
        passwordModal.show();
    } else {
        joinVideoRoom(roomId, null, roomName);
    }
};

document.getElementById('join-room-btn').addEventListener('click', () => {
    const password = document.getElementById('join-room-password').value;
    const roomName = document.getElementById('passwordModal').querySelector('.modal-title').textContent.replace('Join "', '').replace('"', '');
    passwordModal.hide();
    joinVideoRoom(pendingJoinRoomId, password, roomName);
});

// --- WebRTC Video Room Logic (Powered by Trystero) ---
let sendNameMeta, getNameMeta;

async function joinVideoRoom(roomId, password, roomName) {
    let rawStream;
    try {
        rawStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: getAudioConstraints() });
    } catch (err) {
        try {
            rawStream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null) 
                          || await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints() }).catch(() => null);
            if (!rawStream) throw new Error(err.message);
            alert(`Warning: Could only access partial media.\nError: ${err.message}`);
        } catch (fallbackErr) {
            alert(`Could not access camera/microphone.\nEnsure your devices are plugged in.`);
            return;
        }
    }

    localStream = await setupAudioProcessing(rawStream);

    // Join room via Trystero
    const roomConfig = { appId: APP_ID };
    if (password) roomConfig.password = password; // Trystero uses this to encrypt WebRTC SDP
    
    currentCallRoom = tryJoinRoom(roomConfig, roomId);
    [sendNameMeta, getNameMeta] = currentCallRoom.makeAction('meta');

    // Broadcast that we are keeping this room alive to the global lobby
    activeRooms[roomId] = { id: roomId, name: roomName, hasPassword: !!password };
    broadcastMyRooms();
    updateLobbyUI();

    currentRoomId = roomId;
    currentRoomName.textContent = roomName;
    
    lobbyView.classList.add('d-none');
    roomView.classList.remove('d-none');
    
    addVideoStream('local-video', localStream, true, currentUsername + ' (You)');

    // Listen for new peers
    currentCallRoom.onPeerJoin(peerId => {
        // Send our local stream to the new peer
        currentCallRoom.addStream(localStream, peerId);
        // Send our name to the new peer
        sendNameMeta({ username: currentUsername }, peerId);
    });

    // Receive other peers' streams
    currentCallRoom.onPeerStream((stream, peerId) => {
        addVideoStream(`video-${peerId}`, stream, false, peerUsernames[peerId] || 'Connecting...');
    });

    // Receive other peers' usernames
    getNameMeta((meta, peerId) => {
        peerUsernames[peerId] = meta.username;
        // Update badge if video element already exists
        const badge = document.getElementById(`badge-${peerId}`);
        if (badge) badge.textContent = meta.username;
    });

    // Handle peer leaving
    currentCallRoom.onPeerLeave(peerId => {
        removeVideoStream(`video-${peerId}`);
        delete peerUsernames[peerId];
    });
}

document.getElementById('leave-room-btn').addEventListener('click', () => {
    if (currentCallRoom) {
        currentCallRoom.leave();
        currentCallRoom = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (currentRoomId) {
        delete activeRooms[currentRoomId];
        broadcastMyRooms();
        updateLobbyUI();
    }

    peerUsernames = {};
    videoGrid.innerHTML = '';
    
    roomView.classList.add('d-none');
    lobbyView.classList.remove('d-none');
    currentRoomId = null;
    pendingJoinRoomId = null;
});

// --- UI Controls ---
function addVideoStream(id, stream, isLocal, username = '') {
    if (document.getElementById(id)) return;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `container-${id}`;

    const video = document.createElement('video');
    video.id = id;
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
        video.muted = true;
    }

    container.appendChild(video);

    const badge = document.createElement('div');
    badge.className = 'username-badge';
    badge.id = `badge-${id.replace('video-', '')}`;
    badge.textContent = username;
    container.appendChild(badge);

    videoGrid.appendChild(container);
}

function removeVideoStream(id) {
    const container = document.getElementById(`container-${id}`);
    if (container) container.remove();
}

let audioEnabled = true;
let videoEnabled = true;

document.getElementById('toggle-audio').addEventListener('click', (e) => {
    audioEnabled = !audioEnabled;
    const audioTrack = localStream.getAudioTracks()[0];
    if(audioTrack) audioTrack.enabled = audioEnabled;
    e.target.textContent = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
    e.target.classList.toggle('btn-outline-light');
    e.target.classList.toggle('btn-danger');
});

document.getElementById('toggle-video').addEventListener('click', (e) => {
    videoEnabled = !videoEnabled;
    const videoTrack = localStream.getVideoTracks()[0];
    if(videoTrack) videoTrack.enabled = videoEnabled;
    e.target.textContent = videoEnabled ? 'Stop Video' : 'Start Video';
    e.target.classList.toggle('btn-outline-light');
    e.target.classList.toggle('btn-danger');
});

// --- Screen Share Logic ---
let screenStream = null;

document.getElementById('share-screen').addEventListener('click', async (e) => {
    if (!screenStream && currentCallRoom) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                const audioTracks = localStream.getAudioTracks();
                const tracks = [screenTrack];
                if (audioTracks.length > 0) tracks.push(audioTracks[0]);
                localVideo.srcObject = new MediaStream(tracks);
            }

            // Replace track via Trystero
            const oldVideoTrack = localStream.getVideoTracks()[0];
            if (oldVideoTrack) {
                currentCallRoom.replaceTrack(oldVideoTrack, screenTrack);
            } else {
                currentCallRoom.addTrack(screenTrack, localStream);
            }
            
            e.target.textContent = 'Stop Sharing';
            e.target.classList.remove('btn-outline-info');
            e.target.classList.add('btn-info', 'text-white');

            screenTrack.onended = () => stopScreenShare(e.target);
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    } else {
        stopScreenShare(e.target);
    }
});

function stopScreenShare(button) {
    if (screenStream && currentCallRoom) {
        const screenTrack = screenStream.getVideoTracks()[0];
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        const videoTrack = localStream.getVideoTracks()[0];
        
        const localVideo = document.getElementById('local-video');
        if (localVideo) localVideo.srcObject = localStream;

        if (videoTrack && screenTrack) {
            currentCallRoom.replaceTrack(screenTrack, videoTrack);
        }
        
        button.textContent = 'Share Screen';
        button.classList.remove('btn-info', 'text-white');
        button.classList.add('btn-outline-info');
    }
}
