const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const cameraSelect = document.getElementById("cameraSelect");
const microphoneSelect = document.getElementById("microphoneSelect");

let localStream = null;
let currentRoomId = null;
let currentRole = null;
let selectedCameraId = localStorage.getItem("magicSelectedCamera") || "";
let selectedMicrophoneId = localStorage.getItem("magicSelectedMicrophone") || "";

const peerConnections = {};

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

async function getDevices() {
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
        video: cameraId
            ? { deviceId: { exact: cameraId } }
            : true,
        audio: microphoneId
            ? { deviceId: { exact: microphoneId } }
            : true
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
        console.warn("Falha com dispositivo exato. Tentando padrão.", err);

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
    }

    peer.ontrack = (event) => {
        const stream = event.streams[0];

        if (remoteVideo) {
            remoteVideo.srcObject = stream;
            remoteVideo.playsInline = true;
            remoteVideo.play().catch(() => {});
        }
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
        if (
            peer.connectionState === "disconnected" ||
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
        ) {
            peer.close();
            delete peerConnections[targetId];
        }
    };

    return peer;
}

async function createOffer(targetId) {
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

socket.on("existing-peers", async ({ peers }) => {
    for (const peerData of peers) {
        if (!peerData.socketId) continue;

        if (
            currentRole === "spectator" &&
            peerData.role === "spectator"
        ) {
            continue;
        }

        await createOffer(peerData.socketId);
    }
});

socket.on("user-connected", async (data) => {
    const targetId = data.socketId || data;
    if (!targetId) return;

    if (
        currentRole === "spectator" &&
        data.role === "spectator"
    ) {
        return;
    }

    await createOffer(targetId);
});

socket.on("offer", async ({ offer, sender }) => {
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
    if (peerConnections[socketId]) {
        peerConnections[socketId].close();
        delete peerConnections[socketId];
    }
});

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