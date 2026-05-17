const socket = io();

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const cameraSelect = document.getElementById('cameraSelect');

let localStream;
let currentRoomId;
let currentRole;

const peerConnections = {};

const servers = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        }
    ]
};

async function getCameras() {

    const devices =
    await navigator.mediaDevices.enumerateDevices();

    const cameras =
    devices.filter(device =>
        device.kind === 'videoinput'
    );

    cameraSelect.innerHTML = '';

    cameras.forEach((camera, index) => {

        const option =
        document.createElement('option');

        option.value = camera.deviceId;

        option.text =
        camera.label ||
        `Câmera ${index + 1}`;

        cameraSelect.appendChild(option);
    });
}

async function startWebcam(deviceId = null) {

    if (localStream) {
        localStream.getTracks()
        .forEach(track => track.stop());
    }

    localStream =
    await navigator.mediaDevices.getUserMedia({
        video: deviceId
            ? {
                deviceId: {
                    exact: deviceId
                }
            }
            : true,
        audio: true
    });

    localVideo.srcObject = localStream;

    await getCameras();
}

function createPeerConnection(targetId) {

    if (peerConnections[targetId]) {
        return peerConnections[targetId];
    }

    const peer =
    new RTCPeerConnection(servers);

    peerConnections[targetId] = peer;

    if (localStream) {

        localStream.getTracks()
        .forEach(track => {
            peer.addTrack(track, localStream);
        });
    }

    peer.ontrack = (event) => {

        remoteVideo.srcObject =
        event.streams[0];
    };

    peer.onicecandidate = (event) => {

        if (event.candidate) {

            socket.emit('ice-candidate', {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    peer.onconnectionstatechange = () => {

        if (
            peer.connectionState === 'disconnected' ||
            peer.connectionState === 'failed' ||
            peer.connectionState === 'closed'
        ) {

            delete peerConnections[targetId];
        }
    };

    return peer;
}

async function createOffer(targetId) {

    const peer =
    createPeerConnection(targetId);

    const offer =
    await peer.createOffer();

    await peer.setLocalDescription(offer);

    socket.emit('offer', {
        target: targetId,
        offer
    });
}

async function joinRoom(roomId, user) {

    currentRoomId = roomId;
    currentRole = user.role;

    if (
        user.role === 'player' ||
        user.role === 'camera'
    ) {
        await startWebcam();
    }

    socket.emit('join-room', {
        roomId,
        user
    });
}

socket.on('existing-peers', async ({ peers }) => {

    for (const peerData of peers) {

        if (!peerData.socketId) continue;

        if (
            currentRole === 'spectator' &&
            peerData.role === 'spectator'
        ) {
            continue;
        }

        await createOffer(peerData.socketId);
    }
});

socket.on('user-connected', async (data) => {

    const targetId =
    data.socketId || data;

    if (!targetId) return;

    if (
        currentRole === 'spectator' &&
        data.role === 'spectator'
    ) {
        return;
    }

    await createOffer(targetId);
});

socket.on('offer', async ({ offer, sender }) => {

    const peer =
    createPeerConnection(sender);

    await peer.setRemoteDescription(
        new RTCSessionDescription(offer)
    );

    const answer =
    await peer.createAnswer();

    await peer.setLocalDescription(answer);

    socket.emit('answer', {
        target: sender,
        answer
    });
});

socket.on('answer', async ({ answer, sender }) => {

    const peer =
    peerConnections[sender];

    if (!peer) return;

    await peer.setRemoteDescription(
        new RTCSessionDescription(answer)
    );
});

socket.on('ice-candidate', async ({ candidate, sender }) => {

    const peer =
    peerConnections[sender];

    if (!peer || !candidate) return;

    try {

        await peer.addIceCandidate(
            new RTCIceCandidate(candidate)
        );

    } catch (err) {

        console.error(
            'Erro ICE:',
            err
        );
    }
});

socket.on('user-disconnected', (socketId) => {

    if (peerConnections[socketId]) {

        peerConnections[socketId].close();

        delete peerConnections[socketId];
    }
});

cameraSelect.addEventListener(
    'change',
    async () => {

        await startWebcam(
            cameraSelect.value
        );

        const newVideoTrack =
        localStream
        .getVideoTracks()[0];

        Object.values(peerConnections)
        .forEach(peer => {

            const sender =
            peer.getSenders()
            .find(s =>
                s.track &&
                s.track.kind === 'video'
            );

            if (
                sender &&
                newVideoTrack
            ) {

                sender.replaceTrack(
                    newVideoTrack
                );
            }
        });
    }
);