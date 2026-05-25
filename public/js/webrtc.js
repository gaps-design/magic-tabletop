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
let lastJoinPayload = null;
let allowRoomReconnect = true;

let micEnabled = true;
let cameraEnabled = true;

let selectedCameraId = localStorage.getItem("magicSelectedCamera") || "";
let selectedMicrophoneId = localStorage.getItem("magicSelectedMicrophone") || "";

const peerConnections = {};
const peerInfo = {};
const remoteStreams = {};
const pendingCandidates = {};
const reconnectAttempts = {};
const reconnectTimers = {};
const makingOffer = {};

const RTC_DEBUG = true;

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
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
            localStorage.setItem("magicSelectedCamera", selectedCameraId);
        }
    }

    if (microphoneSelect) {
        const currentValue = selectedMicrophoneId || microphoneSelect.value;

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
            localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);
        }
    }
}

function updateMediaStatus() {
    if (micStatusText) {
        micStatusText.innerText = localStream?.getAudioTracks().length
            ? (micEnabled ? "Ativado" : "Desativado")
            : "Sem microfone";
    }

    if (cameraStatusText) {
        cameraStatusText.innerText = localStream?.getVideoTracks().length
            ? (cameraEnabled ? "Ativada" : "Desativada")
            : "Sem câmera";
    }
}

function isMissingMediaDeviceError(error) {
    const name = error?.name || "";
    const message = String(error?.message || "").toLowerCase();

    return (
        name === "NotFoundError" ||
        name === "DevicesNotFoundError" ||
        name === "OverconstrainedError" ||
        message.includes("requested device not found") ||
        message.includes("device not found") ||
        message.includes("not found")
    );
}

function clearSavedMediaDevices({ camera = false, microphone = false } = {}) {
    if (camera) {
        selectedCameraId = "";
        localStorage.removeItem("magicSelectedCamera");

        if (cameraSelect) {
            cameraSelect.value = "";
        }
    }

    if (microphone) {
        selectedMicrophoneId = "";
        localStorage.removeItem("magicSelectedMicrophone");

        if (microphoneSelect) {
            microphoneSelect.value = "";
        }
    }
}

async function getUserMediaWithDeviceFallback(constraints, fallbackConstraints, resetOptions) {
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        if (!isMissingMediaDeviceError(error)) {
            throw error;
        }

        console.warn("Dispositivo salvo não encontrado. Tentando dispositivo padrão.", error);
        clearSavedMediaDevices(resetOptions);

        return await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }
}

async function getOptionalRoomMedia(constraints, resetOptions) {
    try {
        return await getUserMediaWithDeviceFallback(
            constraints,
            {
                video: true,
                audio: true
            },
            resetOptions
        );
    } catch (videoError) {
        console.warn("Falha ao acessar câmera. Tentando somente áudio.", videoError);
        clearSavedMediaDevices({ camera: true });

        try {
            return await getUserMediaWithDeviceFallback(
                {
                    video: false,
                    audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true
                },
                {
                    video: false,
                    audio: true
                },
                {
                    microphone: !!selectedMicrophoneId
                }
            );
        } catch (audioError) {
            console.warn("Falha ao acessar áudio. Entrando sem câmera/microfone.", audioError);
            clearSavedMediaDevices({ camera: true, microphone: true });
            return null;
        }
    }
}

/* =========================
   WEBCAM
========================= */

async function startWebcam(
    cameraId = selectedCameraId,
    microphoneId = selectedMicrophoneId
) {
    rtcLog(null, "starting local media", {
        hasSavedCamera: !!cameraId,
        hasSavedMicrophone: !!microphoneId
    });

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true
    };

    localStream = await getOptionalRoomMedia(
        constraints,
        {
            camera: !!cameraId,
            microphone: !!microphoneId
        }
    );

    if (!localStream) {
        if (localVideo) {
            localVideo.srcObject = null;
        }

        rtcLog(null, "local media unavailable");
        await getDevices();
        updateMediaStatus();
        return;
    }

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micEnabled;
    });

    localStream.getVideoTracks().forEach(track => {
        track.enabled = cameraEnabled;
    });

    routeLocalPreview();

    await getDevices();

    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];

    rtcLog(null, "local media ready", {
        tracks: localStream.getTracks().map(track => ({
            id: track.id,
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
        }))
    });

    if (videoTrack) {
        const settings = videoTrack.getSettings();
        selectedCameraId = settings.deviceId || selectedCameraId;
        localStorage.setItem("magicSelectedCamera", selectedCameraId);

        if (cameraSelect) {
            cameraSelect.value = selectedCameraId;
        }
    }

    if (audioTrack) {
        const settings = audioTrack.getSettings();
        selectedMicrophoneId = settings.deviceId || selectedMicrophoneId;
        localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);

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
    localStorage.setItem("magicSelectedCamera", selectedCameraId);

    const newStream = await getUserMediaWithDeviceFallback(
        {
            video: {
                deviceId: { exact: selectedCameraId }
            },
            audio: false
        },
        {
            video: true,
            audio: false
        },
        {
            camera: true
        }
    );

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) return;

    const videoSettings = newVideoTrack.getSettings();
    selectedCameraId = videoSettings.deviceId || selectedCameraId;

    if (selectedCameraId) {
        localStorage.setItem("magicSelectedCamera", selectedCameraId);
    }

    if (cameraSelect && selectedCameraId) {
        cameraSelect.value = selectedCameraId;
    }

    newVideoTrack.enabled = cameraEnabled;

    if (!localStream) {
        localStream = new MediaStream();
    }

    localStream.getVideoTracks().forEach(track => {
        track.stop();
        localStream.removeTrack(track);
    });

    localStream.addTrack(newVideoTrack);

    routeLocalPreview();

    replaceTrackOnPeers("video", newVideoTrack);
    updateMediaStatus();
}

/* =========================
   TROCAR MICROFONE
========================= */

async function switchMicrophone(microphoneId) {
    if (!microphoneId) return;

    selectedMicrophoneId = microphoneId;
    localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);

    const newStream = await getUserMediaWithDeviceFallback(
        {
            video: false,
            audio: {
                deviceId: { exact: selectedMicrophoneId }
            }
        },
        {
            video: false,
            audio: true
        },
        {
            microphone: true
        }
    );

    const newAudioTrack = newStream.getAudioTracks()[0];
    if (!newAudioTrack) return;

    const audioSettings = newAudioTrack.getSettings();
    selectedMicrophoneId = audioSettings.deviceId || selectedMicrophoneId;

    if (selectedMicrophoneId) {
        localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);
    }

    if (microphoneSelect && selectedMicrophoneId) {
        microphoneSelect.value = selectedMicrophoneId;
    }

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
        const sender = peer.getSenders().find(
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
        rtcLog(null, "attaching stream to video element", {
            videoId: videoElement.id,
            muted,
            streamId: stream.id,
            tracks: stream.getTracks().map(track => ({
                id: track.id,
                kind: track.kind,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            }))
        });

        videoElement.srcObject = stream;
    }

    videoElement.muted = muted;
    videoElement.playsInline = true;
    videoElement.autoplay = true;

    const playPromise = videoElement.play();

    if (playPromise?.catch) {
        playPromise.catch(error => {
            rtcLog(null, "video autoplay blocked or delayed", {
                videoId: videoElement.id,
                muted,
                errorName: error?.name,
                errorMessage: error?.message
            });
        });
    }

    videoElement.onloadedmetadata = () => {
        videoElement.play().catch(error => {
            rtcLog(null, "video play after metadata failed", {
                videoId: videoElement.id,
                errorName: error?.name,
                errorMessage: error?.message
            });
        });
    };
}

function clearVideoIfStream(videoElement, stream) {
    if (!videoElement || !stream) return;

    if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
    }
}

function getVideoElementForPlayer(playerNumber) {
    const normalizedPlayer = Number(playerNumber);

    if (![1, 2].includes(normalizedPlayer)) return null;

    return normalizedPlayer === 1 ? localVideo : remoteVideo;
}

function routeLocalPreview() {
    if (!localStream || currentRole !== "player") return;

    const videoElement = getVideoElementForPlayer(myPlayerNumberRTC);
    if (!videoElement) return;

    const otherElement = Number(myPlayerNumberRTC) === 1 ? remoteVideo : localVideo;
    clearVideoIfStream(otherElement, localStream);

    setVideoStream(videoElement, localStream, true);
}

function hasActiveCameraForPlayer(playerNumber) {
    return Object.entries(peerInfo).some(([socketId, peer]) =>
        peer.role === "camera" &&
        Number(peer.linkedPlayer) === Number(playerNumber) &&
        !!remoteStreams[socketId]
    );
}

function routeStream(socketId, stream) {
    if (!socketId || !stream) return;
    if (currentRole === "camera") return;

    const info = peerInfo[socketId] || {};
    const isLocalPlayerStream =
        info.role === "player" &&
        Number(info.playerNumber) === Number(myPlayerNumberRTC);

    if (isLocalPlayerStream) return;

    rtcLog(socketId, "routing remote stream", {
        currentRole,
        remoteRole: info.role,
        playerNumber: info.playerNumber,
        linkedPlayer: info.linkedPlayer,
        streamId: stream.id,
        tracks: stream.getTracks().map(track => ({
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
        }))
    });

    if (currentRole === "spectator") {
        if (info.role === "camera") {
            setVideoStream(
                getVideoElementForPlayer(info.linkedPlayer),
                stream,
                false
            );

            return;
        }

        if (info.role === "player") {
            if (!hasActiveCameraForPlayer(info.playerNumber)) {
                setVideoStream(
                    getVideoElementForPlayer(info.playerNumber),
                    stream,
                    false
                );
            }

            return;
        }
    }

    if (currentRole === "player") {
        if (info.role === "camera") {
            setVideoStream(
                getVideoElementForPlayer(info.linkedPlayer),
                stream,
                Number(info.linkedPlayer) === Number(myPlayerNumberRTC)
            );

            return;
        }

        if (info.role === "player") {
            if (
                Number(info.playerNumber) !== Number(myPlayerNumberRTC) &&
                !hasActiveCameraForPlayer(info.playerNumber)
            ) {
                setVideoStream(
                    getVideoElementForPlayer(info.playerNumber),
                    stream,
                    false
                );
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

/* =========================
   WEBRTC
========================= */

function createPeerConnection(targetId) {
    if (peerConnections[targetId]) {
        return peerConnections[targetId];
    }

    const peer = new RTCPeerConnection(servers);
    peerConnections[targetId] = peer;
    rtcLog(targetId, "peer created", {
        iceServers: servers.iceServers.map(server => server.urls)
    });

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
            rtcLog(targetId, "local track added", {
                kind: track.kind,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            });
        });
    } else {
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
        rtcLog(targetId, "recvonly transceivers added");
    }

    peer.ontrack = (event) => {
        let stream = event.streams[0];

        rtcLog(targetId, "remote track received", {
            kind: event.track?.kind,
            muted: event.track?.muted,
            readyState: event.track?.readyState,
            streamId: stream?.id,
            streamTrackCount: stream?.getTracks?.().length || 0
        });

        event.track.onunmute = () => {
            rtcLog(targetId, "remote track unmuted", {
                kind: event.track.kind,
                readyState: event.track.readyState
            });
            routeStream(targetId, remoteStreams[targetId] || stream);
        };

        event.track.onended = () => {
            rtcLog(targetId, "remote track ended", {
                kind: event.track.kind
            });
        };

        if (!stream) {
            if (!remoteStreams[targetId]) {
                remoteStreams[targetId] = new MediaStream();
            }

            if (!remoteStreams[targetId].getTracks().some(track => track.id === event.track.id)) {
                remoteStreams[targetId].addTrack(event.track);
            }
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
            rtcLog(targetId, "sending ICE candidate", summarizeCandidate(event.candidate));
            socket.emit("ice-candidate", {
                target: targetId,
                candidate: event.candidate
            });
        } else {
            rtcLog(targetId, "ICE gathering complete");
        }
    };

    peer.oniceconnectionstatechange = () => {
        rtcLog(targetId, "ice connection state changed", {
            iceConnectionState: peer.iceConnectionState,
            iceGatheringState: peer.iceGatheringState,
            signalingState: peer.signalingState
        });
    };

    peer.onicegatheringstatechange = () => {
        rtcLog(targetId, "ice gathering state changed", {
            iceGatheringState: peer.iceGatheringState
        });
    };

    peer.onsignalingstatechange = () => {
        rtcLog(targetId, "signaling state changed", {
            signalingState: peer.signalingState
        });
    };

    peer.onconnectionstatechange = () => {
        rtcLog(targetId, "connection state changed", {
            connectionState: peer.connectionState
        });

        if (peer.connectionState === "connected") {
            reconnectAttempts[targetId] = 0;
            routeAllStreams();
            logSelectedCandidatePair(targetId, peer);
        }

        if (peer.connectionState === "failed") {
            schedulePeerReconnect(targetId);
        }

        if (peer.connectionState === "disconnected") {
            schedulePeerReconnect(targetId, 5000);
        }

        if (peer.connectionState === "closed") {
            cleanupPeer(targetId);
        }
    };

    return peer;
}

function schedulePeerReconnect(targetId, baseDelay = 1200) {
    const info = peerInfo[targetId];
    if (!info || !currentRoomId) return;
    if (reconnectTimers[targetId]) return;

    reconnectAttempts[targetId] = (reconnectAttempts[targetId] || 0) + 1;
    if (reconnectAttempts[targetId] > 3) return;

    rtcLog(targetId, "scheduling peer reconnect", {
        attempt: reconnectAttempts[targetId],
        baseDelay
    });

    reconnectTimers[targetId] = setTimeout(async () => {
        delete reconnectTimers[targetId];
        if (!peerInfo[targetId]) return;

        cleanupPeer(targetId);
        savePeerInfo(targetId, info);

        if (currentRole === "camera" && info.role === "camera") return;
        if (info.role === "spectator") return;

        try {
            await createOffer(targetId, info);
        } catch (error) {
            console.warn("Falha ao renegociar WebRTC:", error);
        }
    }, baseDelay * reconnectAttempts[targetId]);
}

function cleanupPeer(socketId) {
    const info = peerInfo[socketId] || {};
    const stream = remoteStreams[socketId];
    const peerConnection = peerConnections[socketId];

    delete peerConnections[socketId];
    delete makingOffer[socketId];

    if (reconnectTimers[socketId]) {
        clearTimeout(reconnectTimers[socketId]);
        delete reconnectTimers[socketId];
    }

    if (peerConnection) {
        peerConnection.close();
    }

    clearVideoIfStream(localVideo, stream);
    clearVideoIfStream(remoteVideo, stream);

    delete remoteStreams[socketId];
    delete pendingCandidates[socketId];

    if (info.role === "camera") {
        Object.entries(remoteStreams).forEach(([id, playerStream]) => {
            const peer = peerInfo[id];

            if (!peer) return;
            if (peer.role !== "player") return;

            if (
                Number(info.linkedPlayer) ===
                Number(peer.playerNumber)
            ) {
                setVideoStream(
                    getVideoElementForPlayer(peer.playerNumber),
                    playerStream,
                    Number(peer.playerNumber) === Number(myPlayerNumberRTC)
                );
            }
        });
    }

    delete peerInfo[socketId];
}

window.shutdownRoomConnection = function() {
    allowRoomReconnect = false;
    lastJoinPayload = null;
    currentRoomId = null;
    currentRole = null;
    myPlayerNumberRTC = null;

    Object.keys(peerConnections).forEach(cleanupPeer);

    Object.keys(peerInfo).forEach(socketId => {
        delete peerInfo[socketId];
    });

    Object.keys(remoteStreams).forEach(socketId => {
        delete remoteStreams[socketId];
    });

    Object.keys(pendingCandidates).forEach(socketId => {
        delete pendingCandidates[socketId];
    });

    Object.keys(reconnectAttempts).forEach(socketId => {
        delete reconnectAttempts[socketId];
    });

    Object.keys(reconnectTimers).forEach(socketId => {
        clearTimeout(reconnectTimers[socketId]);
        delete reconnectTimers[socketId];
    });

    Object.keys(makingOffer).forEach(socketId => {
        delete makingOffer[socketId];
    });

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
};

function rtcLog(targetId, message, details = {}) {
    if (!RTC_DEBUG) return;

    console.log(`[RTC${targetId ? `:${targetId}` : ""}] ${message}`, {
        socketId: socket.id,
        roomId: currentRoomId,
        role: currentRole,
        ...details
    });
}

function peerSnapshot(peer) {
    if (!peer) return {};

    return {
        signalingState: peer.signalingState,
        iceConnectionState: peer.iceConnectionState,
        iceGatheringState: peer.iceGatheringState,
        connectionState: peer.connectionState
    };
}

function describeDescription(description) {
    return {
        type: description?.type,
        hasSdp: !!description?.sdp,
        sdpLength: description?.sdp?.length || 0
    };
}

async function setLoggedLocalDescription(targetId, peer, description, reason) {
    rtcLog(targetId, "setLocalDescription start", {
        reason,
        description: describeDescription(description),
        before: peerSnapshot(peer)
    });

    await peer.setLocalDescription(description);

    rtcLog(targetId, "setLocalDescription done", {
        reason,
        localDescription: describeDescription(peer.localDescription),
        after: peerSnapshot(peer)
    });
}

async function setLoggedRemoteDescription(targetId, peer, description, reason) {
    rtcLog(targetId, "setRemoteDescription start", {
        reason,
        description: describeDescription(description),
        before: peerSnapshot(peer)
    });

    await peer.setRemoteDescription(description);

    rtcLog(targetId, "setRemoteDescription done", {
        reason,
        remoteDescription: describeDescription(peer.remoteDescription),
        after: peerSnapshot(peer)
    });
}

function summarizeCandidate(candidate) {
    const raw = candidate?.candidate || "";

    return {
        type: candidate?.type || raw.match(/ typ (\w+)/)?.[1] || "unknown",
        protocol: candidate?.protocol || raw.match(/ (udp|tcp) /i)?.[1] || "unknown",
        address: candidate?.address || candidate?.ip || raw.match(/candidate:\S+ \d+ \S+ \d+ ([^\s]+)/)?.[1] || "",
        port: candidate?.port || raw.match(/candidate:\S+ \d+ \S+ \d+ [^\s]+ (\d+)/)?.[1] || ""
    };
}

function isPolitePeer(targetId) {
    if (!socket.id || !targetId) return true;
    return socket.id.localeCompare(targetId) > 0;
}

async function logSelectedCandidatePair(targetId, peer) {
    try {
        const stats = await peer.getStats();
        let selectedPair = null;

        stats.forEach(report => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
                selectedPair = stats.get(report.selectedCandidatePairId);
            }

            if (report.type === "candidate-pair" && report.selected) {
                selectedPair = report;
            }
        });

        if (!selectedPair) return;

        const local = stats.get(selectedPair.localCandidateId);
        const remote = stats.get(selectedPair.remoteCandidateId);

        rtcLog(targetId, "selected ICE candidate pair", {
            localType: local?.candidateType,
            localProtocol: local?.protocol,
            localAddress: local?.address || local?.ip,
            localPort: local?.port,
            remoteType: remote?.candidateType,
            remoteProtocol: remote?.protocol,
            remoteAddress: remote?.address || remote?.ip,
            remotePort: remote?.port
        });
    } catch (error) {
        rtcLog(targetId, "failed to read ICE stats", {
            errorName: error?.name,
            errorMessage: error?.message
        });
    }
}

async function createOffer(targetId, data = {}) {
    savePeerInfo(targetId, data);

    const peer = createPeerConnection(targetId);

    if (makingOffer[targetId] || peer.signalingState !== "stable") {
        rtcLog(targetId, "offer skipped", {
            makingOffer: !!makingOffer[targetId],
            signalingState: peer.signalingState
        });
        return;
    }

    try {
        makingOffer[targetId] = true;
        rtcLog(targetId, "creating offer");

        const offer = await peer.createOffer();
        rtcLog(targetId, "createOffer done", {
            offer: describeDescription(offer),
            peer: peerSnapshot(peer)
        });

        await setLoggedLocalDescription(targetId, peer, offer, "local-offer");
        rtcLog(targetId, "sending offer", {
            signalingState: peer.signalingState
        });

        socket.emit("offer", {
            target: targetId,
            offer
        });
    } finally {
        makingOffer[targetId] = false;
    }
}

async function flushPendingCandidates(sender) {
    const peer = peerConnections[sender];

    if (!peer) return;
    if (!pendingCandidates[sender]) return;

    for (const candidate of pendingCandidates[sender]) {
        try {
            rtcLog(sender, "adding pending ICE candidate", summarizeCandidate(candidate));
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("Erro ICE pendente:", err);
        }
    }

    delete pendingCandidates[sender];
}

/* =========================
   ENTRAR NA SALA
========================= */

async function joinRoom(roomId, user) {
    allowRoomReconnect = true;
    currentRoomId = roomId;
    currentRole = user.role;

    const isCameraMode = user.role === "camera";

    if (user.role === "player" || user.role === "camera") {
        await startWebcam();
    } else {
        await getDevices();
    }

    let loggedUser = null;

    if (!isCameraMode) {
        loggedUser = await window.waitForLogin();

        if (!loggedUser) {
            alert("Você precisa entrar com Google.");
            window.location.href = "/";
            return;
        }
    }

    const profile = user.profile || {};
    const loggedName = profile.name ||
        loggedUser?.displayName ||
        (loggedUser?.email ? loggedUser.email.split("@")[0] : "") ||
        "Usuario";
    const loggedPhoto = profile.photo || loggedUser?.photoURL || "/assets/default-avatar.png";

    lastJoinPayload = {
        roomId,

        user: isCameraMode
            ? {}
            : {
                uid: profile.uid || loggedUser.uid,
                name: loggedName,
                email: profile.email || loggedUser.email || "",
                photo: loggedPhoto
            },

        role: user.role,

        name: isCameraMode
            ? user.name
            : (user.name || loggedName),

        deck: user.deck,
        guild: user.guild,
        linkedPlayer: user.linkedPlayer,
        cameraKey: user.cameraKey,
        format: user.format
    };

    socket.emit("join-room", lastJoinPayload);
}

/* =========================
   SOCKETS
========================= */

socket.on("assigned-role", async (data) => {
    currentRole = data.role;

    if (data.playerNumber) {
        myPlayerNumberRTC = Number(data.playerNumber);
    }

    if ((data.role === "player" || data.role === "camera") && !localStream) {
        try {
            await startWebcam();
        } catch (error) {
            console.warn("Falha ao iniciar mídia ao assumir papel:", error);
        }
    }

    routeLocalPreview();
    routeAllStreams();
});

socket.on("connect", async () => {
    rtcLog(null, "socket connected", {
        socketId: socket.id,
        recovered: socket.recovered,
        hasLastJoinPayload: !!lastJoinPayload,
        peerCount: Object.keys(peerConnections).length
    });

    if (!allowRoomReconnect) return;
    if (!lastJoinPayload || !currentRoomId) return;

    Object.keys(peerConnections).forEach(cleanupPeer);

    try {
        if ((currentRole === "player" || currentRole === "camera") && !localStream) {
            await startWebcam();
        }

        routeLocalPreview();
        socket.emit("join-room", lastJoinPayload);
    } catch (error) {
        console.warn("Falha ao restaurar sala após reconexão:", error);
    }
});

socket.on("disconnect", (reason) => {
    rtcLog(null, "socket disconnected", {
        reason,
        peerCount: Object.keys(peerConnections).length,
        peers: Object.keys(peerConnections)
    });
});

socket.on("connect_error", (error) => {
    rtcLog(null, "socket connect error", {
        errorMessage: error?.message,
        errorDescription: error?.description,
        errorContext: error?.context
    });
});

socket.io?.on?.("reconnect_attempt", (attempt) => {
    rtcLog(null, "socket reconnect attempt", {
        attempt,
        peerCount: Object.keys(peerConnections).length
    });
});

socket.io?.on?.("reconnect", (attempt) => {
    rtcLog(null, "socket reconnected", {
        attempt,
        socketId: socket.id,
        peerCount: Object.keys(peerConnections).length
    });
});

socket.io?.on?.("reconnect_error", (error) => {
    rtcLog(null, "socket reconnect error", {
        errorMessage: error?.message
    });
});

socket.io?.on?.("reconnect_failed", () => {
    rtcLog(null, "socket reconnect failed", {
        peerCount: Object.keys(peerConnections).length
    });
});

socket.on("existing-peers", async ({ peers }) => {
    for (const peerData of peers) {
        if (!peerData.socketId) continue;

        savePeerInfo(peerData.socketId, peerData);

        if (peerData.role === "spectator") continue;

        if (currentRole === "camera" && peerData.role === "camera") {
            continue;
        }

        await createOffer(peerData.socketId, peerData);
    }
});

socket.on("user-connected", (data) => {
    if (!data.socketId) return;

    savePeerInfo(data.socketId, data);

    if (currentRole === "spectator" && data.role !== "spectator") {
        createOffer(data.socketId, data);
    }
});

socket.on("offer", async ({ offer, sender, senderInfo }) => {
    if (!sender || !offer) return;

    try {
        if (senderInfo) {
            savePeerInfo(sender, senderInfo);
        }

        let peer = peerConnections[sender];

        if (!peer) {
            peer = createPeerConnection(sender);
        }

        const offerCollision = makingOffer[sender] || peer.signalingState !== "stable";
        const polite = isPolitePeer(sender);

        rtcLog(sender, "offer received", {
            offerCollision,
            polite,
            signalingState: peer.signalingState
        });

        if (offerCollision && !polite) {
            rtcLog(sender, "offer ignored due to collision");
            return;
        }

        if (offerCollision) {
            await setLoggedLocalDescription(sender, peer, { type: "rollback" }, "rollback-after-offer-collision");
            rtcLog(sender, "local offer rolled back");
        }

        await setLoggedRemoteDescription(sender, peer, new RTCSessionDescription(offer), "remote-offer");
        rtcLog(sender, "remote offer applied");

        rtcLog(sender, "creating answer", {
            peer: peerSnapshot(peer)
        });
        const answer = await peer.createAnswer();
        rtcLog(sender, "createAnswer done", {
            answer: describeDescription(answer),
            peer: peerSnapshot(peer)
        });

        await setLoggedLocalDescription(sender, peer, answer, "local-answer");
        rtcLog(sender, "sending answer", {
            signalingState: peer.signalingState
        });

        socket.emit("answer", {
            target: sender,
            answer
        });

        await flushPendingCandidates(sender);
    } catch (error) {
        console.error("Erro ao processar offer WebRTC:", error);
        rtcLog(sender, "offer handling failed", {
            errorName: error?.name,
            errorMessage: error?.message
        });
    }
});

socket.on("answer", async ({ answer, sender }) => {
    const peer = peerConnections[sender];

    if (!peer || !answer) return;
    if (peer.signalingState === "stable") {
        rtcLog(sender, "answer ignored because signaling is already stable");
        return;
    }

    try {
        rtcLog(sender, "answer received", {
            signalingState: peer.signalingState
        });
        await setLoggedRemoteDescription(sender, peer, new RTCSessionDescription(answer), "remote-answer");
        rtcLog(sender, "remote answer applied");
        await flushPendingCandidates(sender);
    } catch (error) {
        console.error("Erro ao processar answer WebRTC:", error);
        rtcLog(sender, "answer handling failed", {
            errorName: error?.name,
            errorMessage: error?.message
        });
    }
});

socket.on("ice-candidate", async ({ candidate, sender }) => {
    if (!candidate || !sender) return;

    const peer = peerConnections[sender];

    if (!peer || !peer.remoteDescription) {
        if (!pendingCandidates[sender]) {
            pendingCandidates[sender] = [];
        }

        pendingCandidates[sender].push(candidate);
        rtcLog(sender, "ICE candidate queued", summarizeCandidate(candidate));
        return;
    }

    try {
        rtcLog(sender, "adding ICE candidate", summarizeCandidate(candidate));
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.error("Erro ICE:", err);
        rtcLog(sender, "ICE candidate failed", {
            ...summarizeCandidate(candidate),
            errorName: err?.name,
            errorMessage: err?.message
        });
    }
});

socket.on("user-disconnected", (socketId) => {
    cleanupPeer(socketId);
});

socket.on("camera-replaced", () => {
    alert("Essa câmera foi substituída por outra conexão.");
    window.location.href = "/";
});

socket.on("auth-required", (data) => {
    alert(data?.message || "Você precisa entrar com Google.");
    window.location.href = "/";
});

socket.on("force-home", () => {
    window.shutdownRoomConnection?.();
    window.location.href = "/";
});

socket.on("camera-error", (message) => {
    alert(message || "Não foi possível conectar a câmera.");
    window.location.href = "/";
});

socket.on("mic-status-update", ({ socketId, micEnabled, info }) => {
    if (info) {
        savePeerInfo(socketId, {
            ...info,
            micEnabled
        });
    }
});

/* =========================
   DISPOSITIVOS
========================= */

if (cameraSelect) {
    cameraSelect.addEventListener("change", async () => {
        try {
            await switchCamera(cameraSelect.value);
        } catch (err) {
            console.error("Erro ao trocar câmera:", err);
            alert("Erro ao trocar câmera.");
        }
    });
}

if (microphoneSelect) {
    microphoneSelect.addEventListener("change", async () => {
        try {
            await switchMicrophone(microphoneSelect.value);
        } catch (err) {
            console.error("Erro ao trocar microfone:", err);
            alert("Erro ao trocar microfone.");
        }
    });
}

/* =========================
   MICROFONE
========================= */

window.toggleMicrophone = function() {
    if (!localStream?.getAudioTracks().length) {
        alert("Nenhum microfone disponível.");
        return;
    }

    micEnabled = !micEnabled;

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micEnabled;
    });

    updateMediaStatus();

    if (currentRoomId) {
        socket.emit("update-mic-status", {
            roomId: currentRoomId,
            micEnabled
        });
    }
};

window.enableSpectatorMicrophone = async function() {
    if (currentRole !== "spectator") return;

    const audioStream = await getUserMediaWithDeviceFallback(
        {
            video: false,
            audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true
        },
        {
            video: false,
            audio: true
        },
        {
            microphone: !!selectedMicrophoneId
        }
    );

    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) return;

    micEnabled = true;
    audioTrack.enabled = true;

    if (!localStream) {
        localStream = new MediaStream();
    }

    localStream.getAudioTracks().forEach(track => {
        track.stop();
        localStream.removeTrack(track);
    });

    localStream.addTrack(audioTrack);

    Object.values(peerConnections).forEach(peer => {
        const sender = peer.getSenders().find(s => s.track?.kind === "audio");

        if (sender) {
            sender.replaceTrack(audioTrack);
        } else {
            peer.addTrack(audioTrack, localStream);
        }
    });

    updateMediaStatus();

    if (currentRoomId) {
        socket.emit("update-mic-status", {
            roomId: currentRoomId,
            micEnabled: true
        });
    }

    for (const [socketId, info] of Object.entries(peerInfo)) {
        if (info.role === "player" || info.role === "camera") {
            await createOffer(socketId, info).catch(error => {
                console.warn("Falha ao liberar microfone do espectador:", error);
            });
        }
    }
};

window.disableSpectatorMicrophone = async function() {
    if (currentRole !== "spectator") return;

    micEnabled = false;

    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
            track.stop();
            localStream.removeTrack(track);
        });
    }

    Object.values(peerConnections).forEach(peer => {
        peer.getSenders()
            .filter(sender => sender.track?.kind === "audio")
            .forEach(sender => sender.replaceTrack(null));
    });

    updateMediaStatus();
};

/* =========================
   CÂMERA
========================= */

window.toggleCamera = function() {
    if (!localStream?.getVideoTracks().length) {
        alert("Nenhuma câmera disponível.");
        return;
    }

    if (
        currentRoomId === "mtg-1002" &&
        currentRole === "player" &&
        cameraEnabled
    ) {
        cameraEnabled = false;
        localStream.getVideoTracks().forEach(track => {
            track.enabled = false;
        });
        updateMediaStatus();
        socket.emit("resenha-yield-seat", { roomId: currentRoomId });
        return;
    }

    cameraEnabled = !cameraEnabled;

    localStream.getVideoTracks().forEach(track => {
        track.enabled = cameraEnabled;
    });

    updateMediaStatus();
};

if (toggleMicBtn) {
    toggleMicBtn.addEventListener("click", () => {
        window.toggleMicrophone();
    });
}

if (toggleCameraBtn) {
    toggleCameraBtn.addEventListener("click", () => {
        window.toggleCamera();
    });
}

navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    await getDevices();
});

updateMediaStatus();
