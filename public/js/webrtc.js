const socket = io();

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const cameraSelect = document.getElementById('cameraSelect');

let localStream;
let peerConnection;
let currentTarget;
let currentRoomId;
let currentRole;

const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function getCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === 'videoinput');

    cameraSelect.innerHTML = '';

    cameras.forEach((camera, index) => {
        const option = document.createElement('option');
        option.value = camera.deviceId;
        option.text = camera.label || `Câmera ${index + 1}`;
        cameraSelect.appendChild(option);
    });
}

async function startWebcam(deviceId = null) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: true
    });

    localVideo.srcObject = localStream;

    await getCameras();
}

function createPeerConnection(targetId) {
    currentTarget = targetId;

    peerConnection = new RTCPeerConnection(servers);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: currentTarget,
                candidate: event.candidate
            });
        }
    };
}

async function joinRoom(roomId, user) {
    currentRoomId = roomId;
    currentRole = user.role;

    if (user.role === 'player') {
        await startWebcam();
    }

    socket.emit('join-room', {
        roomId,
        user
    });
}

socket.on('user-connected', async (userId) => {
    if (currentRole !== 'player') return;

    createPeerConnection(userId);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('offer', {
        target: userId,
        offer
    });
});

socket.on('offer', async ({ offer, sender }) => {
    if (currentRole !== 'player') return;

    createPeerConnection(sender);

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', {
        target: sender,
        answer
    });
});

socket.on('answer', async ({ answer }) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('ice-candidate', async ({ candidate }) => {
    if (peerConnection && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

cameraSelect.addEventListener('change', async () => {
    await startWebcam(cameraSelect.value);

    if (peerConnection && localStream) {
        const newVideoTrack = localStream.getVideoTracks()[0];

        const sender = peerConnection
            .getSenders()
            .find(s => s.track && s.track.kind === 'video');

        if (sender && newVideoTrack) {
            sender.replaceTrack(newVideoTrack);
        }
    }
});