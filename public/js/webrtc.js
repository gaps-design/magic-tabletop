const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const cameraSelect = document.getElementById("cameraSelect");
const microphoneSelect = document.getElementById("microphoneSelect");

let localStream = null;
let currentRoomId = null;
let currentRole = null;
let myPlayerNumberRTC = null;

let selectedCameraId = localStorage.getItem("magicSelectedCamera") || "";
let selectedMicrophoneId = localStorage.getItem("magicSelectedMicrophone") || "";

const peerConnections = {};
const peerInfo = {};
const remoteStreams = {};

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

/* =========================
   DISPOSITIVOS
========================= */

async function getDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();

    const cameras = devices.filter(device => device.kind === "videoinput");
    const microphones = devices.filter(device => device.kind === "audioinput");

    if (cameraSelect) {
        cameraSelect.innerHTML = "";

        cameras.forEach((camera, index) => {
            const option = document.createElement("option");
            option.value = camera.deviceId;
            option.text = camera.label || `Câmera ${index + 1}`;

            if (camera.deviceId === selectedCameraId) {
                option.selected = true;
            }

            cameraSelect.appendChild(option);
        });

        if (!selectedCameraId && cameras[0]) {
            selectedCameraId = cameras[0].deviceId;
            cameraSelect.value = selectedCameraId;
        }
    }

    if (microphoneSelect) {
        microphoneSelect.innerHTML = "";

        microphones.forEach((mic, index) => {
            const option = document.createElement("option");
            option.value = mic.deviceId;
            option.text = mic.label || `Microfone ${index + 1}`;

            if (mic.deviceId === selectedMicrophoneId) {
                option.selected = true;
            }

            microphoneSelect.appendChild(option);
        });

        if (!selectedMicrophoneId && microphones[0]) {
            selectedMicrophoneId = microphones[0].deviceId;
            microphoneSelect.value = selectedMicrophoneId;
        }
    }
}

async function startWebcam(cameraId = selectedCameraId, microphoneId = selectedMicrophoneId) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
        console.warn("Falha com dispositivo salvo. Tentando padrão.", err);

        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
    }

    if (localVideo) {
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        localVideo.playsInline = true;
        await localVideo.play().catch(() => {});
    }

    await getDevices();

    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];

    if (videoTrack) {
        const settings = videoTrack.getSettings();
        selectedCameraId = settings.deviceId || selectedCameraId;
        localStorage.setItem("magicSelectedCamera", selectedCameraId);

        if (cameraSelect) cameraSelect.value = selectedCameraId;
    }

    if (audioTrack) {
        const settings = audioTrack.getSettings();
        selectedMicrophoneId = settings.deviceId || selectedMicrophoneId;
        localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);

        if (microphoneSelect) microphoneSelect.value = selectedMicrophoneId;
    }

    replaceTracksOnPeers();
}

/* =========================
   ROTAS DE VÍDEO
========================= */

function savePeerInfo(socketId, data = {}) {
    if (!socketId) return;

    peerInfo[socketId] = {
        ...(peerInfo[socketId] || {}),
        ...data
    };

    routeAllStreams();
}

function setVideoStream(videoElement, stream, muted = false) {
    if (!videoElement || !stream) return;

    if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
    }

    videoElement.muted = muted;
    videoElement.playsInline = true;
    videoElement.play().catch(() => {});
}

function clearVideoIfStream(videoElement, stream) {
    if (!videoElement || !stream) return;

    if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
    }
}

function routeStream(socketId, stream) {
    if (!socketId || !stream) return;
    if (currentRole === "camera") return;

    const info = peerInfo[socketId] || {};

    if (currentRole === "spectator") {
        if (info.role === "camera") {
            if (Number(info.linkedPlayer) === 1) {
                setVideoStream(localVideo, stream, false);
            }

            if (Number(info.linkedPlayer) === 2) {
                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }

        if (info.role === "player") {
            if (Number(info.playerNumber) === 1) {
                setVideoStream(localVideo, stream, false);
            }

            if (Number(info.playerNumber) === 2) {
                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }

        return;
    }

    if (currentRole === "player") {
        if (info.role === "camera") {
            if (Number(info.linkedPlayer) === Number(myPlayerNumberRTC)) {
                setVideoStream(localVideo, stream, true);
                return;
            }

            setVideoStream(remoteVideo, stream, false);
            return;
        }

        if (info.role === "player") {
            if (Number(info.playerNumber) !== Number(myPlayerNumberRTC)) {
                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }
    }
}

function routeAllStreams() {
    Object.entries(remoteStreams).forEach(([socketId, stream]) => {
        routeStream(socketId, stream);
    });
}

function replaceTracksOnPeers() {
    if (!localStream) return;

    const newVideoTrack = localStream.getVideoTracks()[0];
    const newAudioTrack = localStream.getAudioTracks()[0];

    Object.values(peerConnections).forEach(peer => {
        const videoSender = peer.getSenders().find(sender =>
            sender.track && sender.track.kind === "video"
        );

        const audioSender = peer.getSenders().find(sender =>
            sender.track && sender.track.kind === "audio"
        );

        if (videoSender && newVideoTrack) {
            videoSender.replaceTrack(newVideoTrack);
        }

        if (audioSender && newAudioTrack) {
            audioSender.replaceTrack(newAudioTrack);
        }
    });
}

/* =========================
   WEBRTC
========================= */

function createPeerConnection(targetId) {
    if (peerConnections[targetId]) {
        return peerConnections[targetId];
    }

    const peer = new RTCPeerConnection(servers);
    peerConnections[targetId] = peer;

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
        });
    } else {
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
    }

    peer.ontrack = (event) => {
        const stream = event.streams[0];

        remoteStreams[targetId] = stream;
        routeStream(targetId, stream);
    };

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", {
                target: targetId,
                candidate: event.candidate
            });
        }
    };

    peer.onconnectionstatechange = async () => {
        const state = peer.connectionState;

        if (state === "failed") {
            try {
                await peer.restartIce();
            } catch (err) {
                console.warn("Falha ao reiniciar ICE:", err);
            }
        }

        if (state === "disconnected" || state === "closed") {
            cleanupPeer(targetId);
        }
    };

    return peer;
}

function cleanupPeer(socketId) {
    const stream = remoteStreams[socketId];

    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
    }

    clearVideoIfStream(localVideo, stream);
    clearVideoIfStream(remoteVideo, stream);

    delete peerConnections[socketId];
    delete peerInfo[socketId];
    delete remoteStreams[socketId];
}

async function createOffer(targetId, data = {}) {
    savePeerInfo(targetId, data);

    const peer = createPeerConnection(targetId);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("offer", {
        target: targetId,
        offer
    });
}

async function joinRoom(roomId, user) {
    currentRoomId = roomId;
    currentRole = user.role;

    if (user.role === "player" || user.role === "camera") {
        await startWebcam();
    } else {
        await getDevices();
    }

    socket.emit("join-room", {
        roomId,
        user
    });
}

/* =========================
   SOCKETS
========================= */

socket.on("assigned-role", (data) => {
    currentRole = data.role;

    if (data.playerNumber) {
        myPlayerNumberRTC = Number(data.playerNumber);
    }
});

socket.on("existing-peers", async ({ peers }) => {
    for (const peerData of peers) {
        if (!peerData.socketId) continue;

        savePeerInfo(peerData.socketId, peerData);

        if (
            currentRole === "spectator" &&
            peerData.role === "spectator"
        ) {
            continue;
        }

        if (
            currentRole === "player" &&
            peerData.role === "spectator"
        ) {
            continue;
        }

        if (
            currentRole === "camera" &&
            peerData.role === "spectator"
        ) {
            continue;
        }

        await createOffer(peerData.socketId, peerData);
    }
});

socket.on("user-connected", async (data) => {
    const targetId = data.socketId;
    if (!targetId) return;

    savePeerInfo(targetId, data);

    if (data.role === "spectator") return;

    await createOffer(targetId, data);
});

socket.on("offer", async ({ offer, sender, senderInfo }) => {
    if (senderInfo) {
        savePeerInfo(sender, senderInfo);
    }

    const peer = createPeerConnection(sender);

    await peer.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit("answer", {
        target: sender,
        answer
    });
});

socket.on("answer", async ({ answer, sender }) => {
    const peer = peerConnections[sender];
    if (!peer) return;

    await peer.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async ({ candidate, sender }) => {
    const peer = peerConnections[sender];
    if (!peer || !candidate) return;

    try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("Erro ICE:", err);
    }
});

socket.on("user-disconnected", (socketId) => {
    cleanupPeer(socketId);
});

/* =========================
   TROCA DE CÂMERA / MICROFONE
========================= */

if (cameraSelect) {
    cameraSelect.addEventListener("change", async () => {
        selectedCameraId = cameraSelect.value;
        localStorage.setItem("magicSelectedCamera", selectedCameraId);

        await startWebcam(selectedCameraId, selectedMicrophoneId);
    });
}

if (microphoneSelect) {
    microphoneSelect.addEventListener("change", async () => {
        selectedMicrophoneId = microphoneSelect.value;
        localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);

        await startWebcam(selectedCameraId, selectedMicrophoneId);
    });
}

navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    await getDevices();
});