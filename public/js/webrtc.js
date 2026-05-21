const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const cameraSelect = document.getElementById("cameraSelect");
const microphoneSelect = document.getElementById("microphoneSelect");

const micStatusText = document.getElementById("micStatusText");
const cameraStatusText = document.getElementById("cameraStatusText");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");

let localStream = null;
let currentRoomId = null;
let currentRole = null;
let myPlayerNumberRTC = null;

let micEnabled = true;
let cameraEnabled = true;

let selectedCameraId = localStorage.getItem("magicSelectedCamera") || "";
let selectedMicrophoneId = localStorage.getItem("magicSelectedMicrophone") || "";

const peerConnections = {};
const peerInfo = {};
const remoteStreams = {};
const pendingCandidates = {};

const servers = {
    iceServers: [

        {
            urls: "stun:stun.l.google.com:19302"
        },

        {
            urls: "stun:global.stun.twilio.com:3478"
        },

        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },

        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },

        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }

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

        const currentValue = selectedCameraId || cameraSelect.value;

        cameraSelect.innerHTML = "";

        cameras.forEach((camera, index) => {

            const option = document.createElement("option");

            option.value = camera.deviceId;
            option.text = camera.label || `Câmera ${index + 1}`;

            if (camera.deviceId === currentValue) {
                option.selected = true;
            }

            cameraSelect.appendChild(option);

        });

        if (!selectedCameraId && cameras[0]) {

            selectedCameraId = cameras[0].deviceId;

            cameraSelect.value = selectedCameraId;

            localStorage.setItem(
                "magicSelectedCamera",
                selectedCameraId
            );
        }
    }

    if (microphoneSelect) {

        const currentValue =
            selectedMicrophoneId || microphoneSelect.value;

        microphoneSelect.innerHTML = "";

        microphones.forEach((mic, index) => {

            const option = document.createElement("option");

            option.value = mic.deviceId;
            option.text = mic.label || `Microfone ${index + 1}`;

            if (mic.deviceId === currentValue) {
                option.selected = true;
            }

            microphoneSelect.appendChild(option);

        });

        if (!selectedMicrophoneId && microphones[0]) {

            selectedMicrophoneId = microphones[0].deviceId;

            microphoneSelect.value = selectedMicrophoneId;

            localStorage.setItem(
                "magicSelectedMicrophone",
                selectedMicrophoneId
            );
        }
    }
}

function updateMediaStatus() {

    if (micStatusText) {
        micStatusText.innerText =
            micEnabled ? "Ativado" : "Desativado";
    }

    if (cameraStatusText) {
        cameraStatusText.innerText =
            cameraEnabled ? "Ativada" : "Desativada";
    }
}

/* =========================
   WEBCAM
========================= */

async function startWebcam(
    cameraId = selectedCameraId,
    microphoneId = selectedMicrophoneId
) {

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {

        video: cameraId
            ? { deviceId: { exact: cameraId } }
            : true,

        audio: microphoneId
            ? { deviceId: { exact: microphoneId } }
            : true
    };

    try {

        localStream =
            await navigator.mediaDevices.getUserMedia(
                constraints
            );

    } catch (err) {

        console.warn(
            "Falha com dispositivo salvo. Tentando padrão.",
            err
        );

        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
    }

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micEnabled;
    });

    localStream.getVideoTracks().forEach(track => {
        track.enabled = cameraEnabled;
    });

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

        selectedCameraId =
            settings.deviceId || selectedCameraId;

        localStorage.setItem(
            "magicSelectedCamera",
            selectedCameraId
        );

        if (cameraSelect) {
            cameraSelect.value = selectedCameraId;
        }
    }

    if (audioTrack) {

        const settings = audioTrack.getSettings();

        selectedMicrophoneId =
            settings.deviceId || selectedMicrophoneId;

        localStorage.setItem(
            "magicSelectedMicrophone",
            selectedMicrophoneId
        );

        if (microphoneSelect) {
            microphoneSelect.value = selectedMicrophoneId;
        }
    }

    updateMediaStatus();
}

/* =========================
   TROCAR CÂMERA
========================= */

async function switchCamera(cameraId) {

    if (!cameraId) return;

    selectedCameraId = cameraId;

    localStorage.setItem(
        "magicSelectedCamera",
        selectedCameraId
    );

    const newStream =
        await navigator.mediaDevices.getUserMedia({

            video: {
                deviceId: { exact: selectedCameraId }
            },

            audio: false
        });

    const newVideoTrack =
        newStream.getVideoTracks()[0];

    if (!newVideoTrack) return;

    newVideoTrack.enabled = cameraEnabled;

    if (!localStream) {
        localStream = new MediaStream();
    }

    localStream.getVideoTracks().forEach(track => {

        track.stop();
        localStream.removeTrack(track);

    });

    localStream.addTrack(newVideoTrack);

    if (localVideo) {

        localVideo.srcObject = localStream;
        localVideo.muted = true;
        localVideo.playsInline = true;

        await localVideo.play().catch(() => {});
    }

    replaceTrackOnPeers("video", newVideoTrack);

    updateMediaStatus();
}

/* =========================
   TROCAR MICROFONE
========================= */

async function switchMicrophone(microphoneId) {

    if (!microphoneId) return;

    selectedMicrophoneId = microphoneId;

    localStorage.setItem(
        "magicSelectedMicrophone",
        selectedMicrophoneId
    );

    const newStream =
        await navigator.mediaDevices.getUserMedia({

            video: false,

            audio: {
                deviceId: { exact: selectedMicrophoneId }
            }
        });

    const newAudioTrack =
        newStream.getAudioTracks()[0];

    if (!newAudioTrack) return;

    newAudioTrack.enabled = micEnabled;

    if (!localStream) {
        localStream = new MediaStream();
    }

    localStream.getAudioTracks().forEach(track => {

        track.stop();
        localStream.removeTrack(track);

    });

    localStream.addTrack(newAudioTrack);

    replaceTrackOnPeers("audio", newAudioTrack);

    updateMediaStatus();
}

function replaceTrackOnPeers(kind, newTrack) {

    Object.values(peerConnections).forEach(peer => {

        const sender =
            peer.getSenders().find(
                s => s.track && s.track.kind === kind
            );

        if (sender) {
            sender.replaceTrack(newTrack);
        }

    });
}

/* =========================
   ROTEAMENTO
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

    /* =========================
       ESPECTADOR
    ========================= */

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

            const hasCameraP1 =
                Object.values(peerInfo).some(peer =>
                    peer.role === "camera" &&
                    Number(peer.linkedPlayer) === 1
                );

            const hasCameraP2 =
                Object.values(peerInfo).some(peer =>
                    peer.role === "camera" &&
                    Number(peer.linkedPlayer) === 2
                );

            if (
                Number(info.playerNumber) === 1 &&
                !hasCameraP1
            ) {
                setVideoStream(localVideo, stream, false);
            }

            if (
                Number(info.playerNumber) === 2 &&
                !hasCameraP2
            ) {
                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }
    }

    /* =========================
       PLAYER
    ========================= */

    if (currentRole === "player") {

        if (info.role === "camera") {

            if (
                Number(info.linkedPlayer) ===
                Number(myPlayerNumberRTC)
            ) {

                setVideoStream(localVideo, stream, true);

            } else {

                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }

        if (info.role === "player") {

            if (
                Number(info.playerNumber) !==
                Number(myPlayerNumberRTC)
            ) {

                setVideoStream(remoteVideo, stream, false);
            }

            return;
        }
    }
}

function routeAllStreams() {

    Object.entries(remoteStreams).forEach(
        ([socketId, stream]) => {

            routeStream(socketId, stream);

        }
    );
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

        peer.addTransceiver("video", {
            direction: "recvonly"
        });

        peer.addTransceiver("audio", {
            direction: "recvonly"
        });
    }

    peer.ontrack = (event) => {

        let stream = event.streams[0];

        if (!stream) {

            if (!remoteStreams[targetId]) {
                remoteStreams[targetId] = new MediaStream();
            }

            remoteStreams[targetId]
                .addTrack(event.track);

            stream = remoteStreams[targetId];

        } else {

            remoteStreams[targetId] = stream;
        }

        routeStream(targetId, stream);

        setTimeout(() => {
            routeStream(targetId, stream);
        }, 500);
    };

    peer.onicecandidate = (event) => {

        if (event.candidate) {

            socket.emit("ice-candidate", {

                target: targetId,
                candidate: event.candidate

            });
        }
    };

    peer.onconnectionstatechange = () => {

        if (peer.connectionState === "connected") {
            routeAllStreams();
        }

        if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
        ) {

            cleanupPeer(targetId);
        }
    };

    return peer;
}

function cleanupPeer(socketId) {

    const info = peerInfo[socketId] || {};
    const stream = remoteStreams[socketId];

    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
    }

    clearVideoIfStream(localVideo, stream);
    clearVideoIfStream(remoteVideo, stream);

    delete peerConnections[socketId];
    delete remoteStreams[socketId];
    delete pendingCandidates[socketId];

    if (info.role === "camera") {

        Object.entries(remoteStreams).forEach(
            ([id, playerStream]) => {

                const peer = peerInfo[id];

                if (!peer) return;

                if (peer.role !== "player") return;

                if (
                    Number(info.linkedPlayer) === 1 &&
                    Number(peer.playerNumber) === 1
                ) {
                    setVideoStream(localVideo, playerStream, false);
                }

                if (
                    Number(info.linkedPlayer) === 2 &&
                    Number(peer.playerNumber) === 2
                ) {
                    setVideoStream(remoteVideo, playerStream, false);
                }

            }
        );
    }

    delete peerInfo[socketId];
}

async function createOffer(targetId, data = {}) {

    savePeerInfo(targetId, data);

    const peer = createPeerConnection(targetId);

    if (peer.signalingState !== "stable") {
        return;
    }

    const offer = await peer.createOffer();

    await peer.setLocalDescription(offer);

    socket.emit("offer", {
        target: targetId,
        offer
    });
}

async function flushPendingCandidates(sender) {

    const peer = peerConnections[sender];

    if (!peer) return;

    if (!pendingCandidates[sender]) return;

    for (const candidate of pendingCandidates[sender]) {

        try {

            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        } catch (err) {

            console.error(
                "Erro ICE pendente:",
                err
            );
        }
    }

    delete pendingCandidates[sender];
}

/* =========================
   ENTRAR NA SALA
========================= */

async function joinRoom(roomId, user) {

    currentRoomId = roomId;
    currentRole = user.role;

    if (
        user.role === "player" ||
        user.role === "camera"
    ) {

        await startWebcam();

    } else {

        await getDevices();
    }
const loggedUser = await window.waitForLogin();

if (!loggedUser) {
  alert("Você precisa entrar com Google.");
  window.location.href = "/";
  return;
}
    socket.emit("join-room", {

        roomId,
user: {
  uid: loggedUser.uid,
  name: loggedUser.displayName,
  email: loggedUser.email,
  photo: loggedUser.photoURL
},
        role: user.role,
        name: user.name,
        deck: user.deck,
        guild: user.guild,
        linkedPlayer: user.linkedPlayer,
        format: user.format
    });
}

/* =========================
   SOCKETS
========================= */

socket.on("assigned-role", (data) => {

    currentRole = data.role;

    if (data.playerNumber) {
        myPlayerNumberRTC =
            Number(data.playerNumber);
    }

    routeAllStreams();
});

socket.on("existing-peers", async ({ peers }) => {

    for (const peerData of peers) {

        if (!peerData.socketId) continue;

        savePeerInfo(
            peerData.socketId,
            peerData
        );

        if (peerData.role === "spectator") {
            continue;
        }

        if (
            currentRole === "camera" &&
            peerData.role === "camera"
        ) {
            continue;
        }

        await createOffer(
            peerData.socketId,
            peerData
        );
    }
});

socket.on("user-connected", (data) => {

    if (!data.socketId) return;

    savePeerInfo(data.socketId, data);

    if (
        currentRole === "spectator" &&
        data.role !== "spectator"
    ) {

        createOffer(data.socketId, data);
    }
});

socket.on(
    "offer",
    async ({ offer, sender, senderInfo }) => {

        if (!sender || !offer) return;

        if (senderInfo) {
            savePeerInfo(sender, senderInfo);
        }

        let peer = peerConnections[sender];

        if (!peer) {
            peer = createPeerConnection(sender);
        }

        if (peer.signalingState !== "stable") {

            peer.close();

            delete peerConnections[sender];

            peer = createPeerConnection(sender);
        }

        await peer.setRemoteDescription(
            new RTCSessionDescription(offer)
        );

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        socket.emit("answer", {
            target: sender,
            answer
        });

        await flushPendingCandidates(sender);
    }
);

socket.on(
    "answer",
    async ({ answer, sender }) => {

        const peer = peerConnections[sender];

        if (!peer || !answer) return;

        if (peer.signalingState === "stable") return;

        await peer.setRemoteDescription(
            new RTCSessionDescription(answer)
        );

        await flushPendingCandidates(sender);
    }
);

socket.on(
    "ice-candidate",
    async ({ candidate, sender }) => {

        if (!candidate || !sender) return;

        const peer = peerConnections[sender];

        if (!peer || !peer.remoteDescription) {

            if (!pendingCandidates[sender]) {
                pendingCandidates[sender] = [];
            }

            pendingCandidates[sender].push(candidate);

            return;
        }

        try {

            await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
            );

        } catch (err) {

            console.error("Erro ICE:", err);
        }
    }
);

socket.on("user-disconnected", (socketId) => {
    cleanupPeer(socketId);
});

/* =========================
   DISPOSITIVOS
========================= */

if (cameraSelect) {

    cameraSelect.addEventListener(
        "change",
        async () => {

            try {

                await switchCamera(
                    cameraSelect.value
                );

            } catch (err) {

                console.error(
                    "Erro ao trocar câmera:",
                    err
                );

                alert("Erro ao trocar câmera.");
            }
        }
    );
}

if (microphoneSelect) {

    microphoneSelect.addEventListener(
        "change",
        async () => {

            try {

                await switchMicrophone(
                    microphoneSelect.value
                );

            } catch (err) {

                console.error(
                    "Erro ao trocar microfone:",
                    err
                );

                alert(
                    "Erro ao trocar microfone."
                );
            }
        }
    );
}

/* =========================
   MICROFONE
========================= */

window.toggleMicrophone = function() {

    if (!localStream) return;

    micEnabled = !micEnabled;

    localStream
        .getAudioTracks()
        .forEach(track => {

            track.enabled = micEnabled;

        });

    updateMediaStatus();
};

/* =========================
   CÂMERA
========================= */

window.toggleCamera = function() {

    if (!localStream) return;

    cameraEnabled = !cameraEnabled;

    localStream
        .getVideoTracks()
        .forEach(track => {

            track.enabled = cameraEnabled;

        });

    updateMediaStatus();
};

if (toggleMicBtn) {

    toggleMicBtn.addEventListener(
        "click",
        () => {

            window.toggleMicrophone();

        }
    );
}

if (toggleCameraBtn) {

    toggleCameraBtn.addEventListener(
        "click",
        () => {

            window.toggleCamera();

        }
    );
}

navigator.mediaDevices?.addEventListener?.(
    "devicechange",
    async () => {

        await getDevices();

    }
);

updateMediaStatus();