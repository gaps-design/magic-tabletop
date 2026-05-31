const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const cameraSelect = document.getElementById("cameraSelect");
const microphoneSelect = document.getElementById("microphoneSelect");
const spectatorMicrophoneSelect = document.getElementById("spectatorMicrophoneSelect");
const reconnectMediaBtn = document.getElementById("reconnectMediaBtn");

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
let selectedSpectatorMicrophoneId = localStorage.getItem("magicSelectedSpectatorMicrophone") || "";

const peerConnections = {};
const peerInfo = {};
const remoteStreams = {};
const pendingCandidates = {};
const reconnectAttempts = {};
const reconnectTimers = {};
const makingOffer = {};
const faceCamPeerConnections = {};
const faceCamPendingCandidates = {};
const faceCamSources = {};
const remoteFaceCamStreams = {};
let localFaceCamStream = null;
let localFaceCamMeta = null;
let cameraWakeLock = null;
let cameraRecoveryInProgress = false;
let cameraRecoveryTimer = null;
let lastConnectionToastAt = 0;

const RTC_DEBUG = true;
let lastMediaAccessError = null;
let mediaErrorAlertShown = false;

const servers = {
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
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

warnIfBraveBrowser();

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

    populateSpectatorMicrophones(microphones);
}

function populateSpectatorMicrophones(microphones = []) {
    if (!spectatorMicrophoneSelect) return;

    const currentValue = selectedSpectatorMicrophoneId || spectatorMicrophoneSelect.value;
    spectatorMicrophoneSelect.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.text = "PadrÃ£o do navegador";
    spectatorMicrophoneSelect.appendChild(defaultOption);

    microphones.forEach((mic, index) => {
        const option = document.createElement("option");
        option.value = mic.deviceId;
        option.text = mic.label || `Microfone ${index + 1}`;
        spectatorMicrophoneSelect.appendChild(option);
    });

    if (currentValue && microphones.some(mic => mic.deviceId === currentValue)) {
        selectedSpectatorMicrophoneId = currentValue;
        spectatorMicrophoneSelect.value = currentValue;
    } else {
        selectedSpectatorMicrophoneId = "";
        spectatorMicrophoneSelect.value = "";
        localStorage.removeItem("magicSelectedSpectatorMicrophone");
    }

    console.log("[AUDIO][SPECTATOR] devices loaded", {
        count: microphones.length,
        selectedDeviceId: selectedSpectatorMicrophoneId || "default"
    });
}

async function refreshSpectatorMicrophones() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    populateSpectatorMicrophones(devices.filter(device => device.kind === "audioinput"));
}

function getSpectatorAudioConstraints() {
    return selectedSpectatorMicrophoneId
        ? { deviceId: { exact: selectedSpectatorMicrophoneId } }
        : true;
}

function updateMediaStatus() {
    const hasActiveMic = !!localStream?.getAudioTracks().length && micEnabled;

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

    if (currentRole === "player" && typeof window.setLocalMutedIconState === "function") {
        window.setLocalMutedIconState(hasActiveMic);
    }
}

function getMediaErrorInfo(error) {
    const name = error?.name || "UnknownError";
    const constraint = error?.constraint || error?.constraintName || "";

    const messages = {
        NotAllowedError: "Permissao de camera/microfone bloqueada. Libere o acesso no navegador e tente novamente.",
        PermissionDeniedError: "Permissao de camera/microfone bloqueada. Libere o acesso no navegador e tente novamente.",
        NotFoundError: "Camera ou microfone nao encontrado. Verifique se o dispositivo esta conectado.",
        DevicesNotFoundError: "Camera ou microfone nao encontrado. Verifique se o dispositivo esta conectado.",
        NotReadableError: "Camera ou microfone em uso por outro aplicativo. Feche outros apps e tente novamente.",
        TrackStartError: "Camera ou microfone em uso por outro aplicativo. Feche outros apps e tente novamente.",
        OverconstrainedError: `Configuracao de midia nao suportada${constraint ? ` (${constraint})` : ""}. Tentando dispositivo padrao.`,
        ConstraintNotSatisfiedError: `Configuracao de midia nao suportada${constraint ? ` (${constraint})` : ""}. Tentando dispositivo padrao.`,
        SecurityError: "O navegador bloqueou o acesso a camera/microfone. Verifique HTTPS e permissoes do site."
    };

    return {
        name,
        message: error?.message || "",
        constraint,
        userMessage: messages[name] || "Nao foi possivel acessar camera/microfone. Verifique permissoes e dispositivos."
    };
}

function showCriticalMediaAlert(error) {
    const info = getMediaErrorInfo(error);

    if (!info.userMessage || mediaErrorAlertShown) return;

    mediaErrorAlertShown = true;
    alert(info.userMessage);
}

async function warnIfBraveBrowser() {
    try {
        const isBrave = !!navigator.brave?.isBrave && await navigator.brave.isBrave();

        if (isBrave) {
            console.warn("[WEBRTC] Navegador Brave detectado. Se camera/audio falhar, desative o Shields no icone do leao.");
        }
    } catch (error) {
        mediaLog("brave detection failed", {
            errorName: error?.name,
            errorMessage: error?.message
        }, "warn");
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

function isPhoneCameraMode() {
    return currentRole === "camera";
}

async function requestCameraWakeLock() {
    if (!isPhoneCameraMode()) return;
    if (document.visibilityState !== "visible") return;
    if (cameraWakeLock) return;

    if (!navigator.wakeLock?.request) {
        cameraLog("Screen Wake Lock API indisponivel neste navegador.", {}, "warn");
        return;
    }

    try {
        cameraWakeLock = await navigator.wakeLock.request("screen");
        cameraLog("Wake Lock adquirido");

        cameraWakeLock.addEventListener("release", () => {
            cameraWakeLock = null;
            cameraLog("Wake Lock perdido", {
                visibilityState: document.visibilityState
            }, "warn");
        });
    } catch (error) {
        cameraLog("Falha ao adquirir Wake Lock", {
            errorName: error?.name,
            errorMessage: error?.message
        }, "warn");
    }
}

async function releaseCameraWakeLock() {
    if (!cameraWakeLock) return;

    try {
        await cameraWakeLock.release();
    } catch (error) {
        cameraLog("Falha ao liberar Wake Lock", {
            errorName: error?.name,
            errorMessage: error?.message
        }, "warn");
    } finally {
        cameraWakeLock = null;
    }
}

function replaceLocalTracksOnPeers() {
    if (!localStream) return;

    ["video", "audio"].forEach(kind => {
        const track = localStream.getTracks().find(item => item.kind === kind);
        if (track) {
            replaceTrackOnPeers(kind, track);
        }
    });
}

function monitorCameraModeTrack(stream = localStream) {
    if (!isPhoneCameraMode() || !stream) return;

    stream.getVideoTracks().forEach(track => {
        track.onended = () => {
            cameraLog("Camera track encerrada", {
                trackId: track.id,
                readyState: track.readyState
            }, "warn");
            scheduleCameraModeRecovery("track-ended");
        };
    });
}

function hasLiveCameraModeTrack() {
    const videoTrack = localStream?.getVideoTracks?.()[0];
    return !!videoTrack && videoTrack.readyState === "live";
}

function scheduleCameraModeRecovery(reason = "unknown", delay = 600) {
    if (!isPhoneCameraMode()) return;
    if (cameraRecoveryTimer) return;

    cameraLog("Reconexão iniciada", { reason });

    cameraRecoveryTimer = setTimeout(() => {
        cameraRecoveryTimer = null;
        recoverCameraModeMedia(reason).catch(error => {
            cameraLog("Reconexão da câmera falhou", {
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
    }, delay);
}

async function recoverCameraModeMedia(reason = "manual") {
    if (!isPhoneCameraMode()) return;
    if (cameraRecoveryInProgress) return;

    cameraRecoveryInProgress = true;

    try {
        await requestCameraWakeLock();

        if (hasLiveCameraModeTrack()) {
            routeLocalPreview();
            replaceLocalTracksOnPeers();
            cameraLog("Reconexão concluída", {
                reason,
                status: "camera-track-live"
            });
            return;
        }

        await startWebcam();
        replaceLocalTracksOnPeers();
        routeAllStreams();

        cameraLog("Reconexão concluída", {
            reason,
            hasVideoTrack: !!localStream?.getVideoTracks?.().length,
            peerCount: Object.keys(peerConnections).length
        });
    } finally {
        cameraRecoveryInProgress = false;
    }
}

function refreshCameraModeResilience(reason = "refresh") {
    if (!isPhoneCameraMode()) return;

    requestCameraWakeLock();
    monitorCameraModeTrack();

    if (!hasLiveCameraModeTrack()) {
        scheduleCameraModeRecovery(reason);
    }
}

async function getUserMediaWithDeviceFallback(constraints, fallbackConstraints, resetOptions) {
    if (!navigator.mediaDevices?.getUserMedia) {
        const error = new Error("navigator.mediaDevices.getUserMedia indisponivel.");
        error.name = "SecurityError";
        throw error;
    }

    try {
        mediaLog("requesting local media", { constraints });
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        lastMediaAccessError = error;

        if (!isMissingMediaDeviceError(error)) {
            mediaLog("local media request failed", {
                ...getMediaErrorInfo(error),
                constraints
            }, "warn");
            throw error;
        }

        console.warn("Dispositivo salvo não encontrado. Tentando dispositivo padrão.", error);
        mediaLog("saved media device not found, trying default device", {
            ...getMediaErrorInfo(error),
            constraints,
            fallbackConstraints
        }, "warn");
        clearSavedMediaDevices(resetOptions);

        try {
            return await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        } catch (fallbackError) {
            lastMediaAccessError = fallbackError;
            mediaLog("fallback local media request failed", {
                ...getMediaErrorInfo(fallbackError),
                fallbackConstraints
            }, "warn");
            throw fallbackError;
        }
    }
}

async function getOptionalRoomMedia(constraints, resetOptions) {
    try {
        lastMediaAccessError = null;
        return await getUserMediaWithDeviceFallback(
            constraints,
            {
                video: true,
                audio: true
            },
            resetOptions
        );
    } catch (videoError) {
        lastMediaAccessError = videoError;
        mediaLog("camera access failed, trying audio only", {
            ...getMediaErrorInfo(videoError)
        }, "warn");
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
            lastMediaAccessError = audioError;
            mediaLog("audio access failed, joining without camera/microphone", {
                ...getMediaErrorInfo(audioError)
            }, "warn");
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

        if ((currentRole === "player" || currentRole === "camera") && lastMediaAccessError) {
            showCriticalMediaAlert(lastMediaAccessError);
        }

        mediaLog("joining without local media", {
            role: currentRole,
            lastError: lastMediaAccessError ? getMediaErrorInfo(lastMediaAccessError) : null
        }, "warn");
        rtcLog(null, "local media unavailable");
        await getDevices();
        updateMediaStatus();
        return;
    }

    localStream.getAudioTracks().forEach(track => {
        track.enabled = micEnabled;
    });

    mediaErrorAlertShown = false;

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

    monitorCameraModeTrack(localStream);
    requestCameraWakeLock();
    updateMediaStatus();
}

/* =========================
   TROCAR CÂMERA
========================= */

async function switchCamera(cameraId) {
    if (!cameraId) return;

    selectedCameraId = cameraId;
    localStorage.setItem("magicSelectedCamera", selectedCameraId);

    if (typeof window.releaseFaceCamForMainCamera === "function") {
        await window.releaseFaceCamForMainCamera(selectedCameraId);
    }

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
    monitorCameraModeTrack(localStream);
    mediaErrorAlertShown = false;
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
    mediaErrorAlertShown = false;
    updateMediaStatus();
}

function replaceTrackOnPeers(kind, newTrack) {
    Object.entries(peerConnections).forEach(([socketId, peer]) => {
        const sender = peer.getSenders().find(
            s => s.track && s.track.kind === kind
        );

        if (sender) {
            sender.replaceTrack(newTrack).catch(error => {
                rtcLog(socketId, "replaceTrack failed", {
                    kind,
                    errorName: error?.name,
                    errorMessage: error?.message
                });
            });
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
        mediaLog("attaching stream to video element", {
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
    window.applySpectatorLocalAudioMute?.();
    videoElement.playsInline = true;
    videoElement.autoplay = true;

    const playPromise = videoElement.play();

    if (playPromise?.catch) {
        playPromise.catch(error => {
            audioLog("remote/local video autoplay blocked or delayed", {
                videoId: videoElement.id,
                muted,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
    }

    videoElement.onloadedmetadata = () => {
        videoElement.play().catch(error => {
            audioLog("video play after metadata failed", {
                videoId: videoElement.id,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
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

        if (
            !peer.__resenhaClosing &&
            ["failed", "disconnected"].includes(peer.iceConnectionState)
        ) {
            notifyConnectionUnstable(targetId, `ice-${peer.iceConnectionState}`);
            schedulePeerReconnect(targetId, peer.iceConnectionState === "disconnected" ? 5000 : 1200);
        }

        if (
            isPhoneCameraMode() &&
            !peer.__resenhaClosing &&
            peer.iceConnectionState === "closed"
        ) {
            schedulePeerReconnect(targetId, peer.iceConnectionState === "disconnected" ? 5000 : 1200);
        }
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
            if (isPhoneCameraMode() && reconnectAttempts[targetId] > 0) {
                cameraLog("Reconexão concluída", {
                    targetId,
                    connectionState: peer.connectionState
                });
            }
            reconnectAttempts[targetId] = 0;
            routeAllStreams();
            logSelectedCandidatePair(targetId, peer);
        }

        if (peer.connectionState === "failed") {
            notifyConnectionUnstable(targetId, "connection-failed");
            schedulePeerReconnect(targetId);
        }

        if (peer.connectionState === "disconnected") {
            notifyConnectionUnstable(targetId, "connection-disconnected");
            schedulePeerReconnect(targetId, 5000);
        }

        if (isPhoneCameraMode() && peer.connectionState === "closed" && !peer.__resenhaClosing) {
            schedulePeerReconnect(targetId, 1200);
            return;
        }

        if (peer.connectionState === "closed") {
            cleanupPeer(targetId);
        }
    };

    return peer;
}

function faceCamKey(socketId, side) {
    return `${socketId}:${side}`;
}

function getFaceCamPlayerInfo(socketId, fallback = {}) {
    return faceCamSources[socketId] || peerInfo[socketId] || fallback || {};
}

function createFaceCamSenderPeer(receiverId) {
    const key = faceCamKey(receiverId, "send");

    if (faceCamPeerConnections[key]) {
        faceCamPeerConnections[key].close();
        delete faceCamPeerConnections[key];
    }

    const peer = new RTCPeerConnection(servers);
    faceCamPeerConnections[key] = peer;

    if (localFaceCamStream) {
        localFaceCamStream.getVideoTracks().forEach(track => {
            console.log("[FACECAM] track added", {
                target: receiverId,
                trackId: track.id
            });
            peer.addTrack(track, localFaceCamStream);
        });
    }

    peer.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit("facecam-ice-candidate", {
            target: receiverId,
            candidate: event.candidate,
            side: "send"
        });
    };

    peer.onconnectionstatechange = () => {
        rtcLog(receiverId, "facecam sender connection state", {
            state: peer.connectionState,
            side: "send"
        });

        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
            if (peer.connectionState === "failed") {
                cleanupFaceCamPeer(receiverId, { removeRemote: false });
            }
        }
    };

    return peer;
}

function createFaceCamReceiverPeer(sourceId, sourceInfo = {}) {
    const key = faceCamKey(sourceId, "recv");

    if (faceCamPeerConnections[key]) {
        return faceCamPeerConnections[key];
    }

    const peer = new RTCPeerConnection(servers);
    faceCamPeerConnections[key] = peer;
    faceCamSources[sourceId] = {
        ...(faceCamSources[sourceId] || {}),
        ...sourceInfo,
        socketId: sourceId,
        mediaType: "facecam"
    };

    peer.addTransceiver("video", { direction: "recvonly" });

    peer.ontrack = (event) => {
        let stream = event.streams[0];

        if (!stream) {
            if (!remoteFaceCamStreams[sourceId]) {
                remoteFaceCamStreams[sourceId] = new MediaStream();
            }

            if (!remoteFaceCamStreams[sourceId].getTracks().some(track => track.id === event.track.id)) {
                remoteFaceCamStreams[sourceId].addTrack(event.track);
            }

            stream = remoteFaceCamStreams[sourceId];
        } else {
            remoteFaceCamStreams[sourceId] = stream;
        }

        const info = getFaceCamPlayerInfo(sourceId, sourceInfo);

        window.updateRemoteFaceCam?.(info.playerNumber, stream, {
            ...info,
            socketId: sourceId
        });
    };

    peer.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit("facecam-ice-candidate", {
            target: sourceId,
            candidate: event.candidate,
            side: "recv"
        });
    };

    peer.onconnectionstatechange = () => {
        rtcLog(sourceId, "facecam receiver connection state", {
            state: peer.connectionState,
            side: "recv"
        });
    };

    return peer;
}

async function requestFaceCamSource(sourceInfo = {}) {
    const sourceId = sourceInfo.socketId;

    if (!sourceId || sourceId === socket.id) return;
    if (currentRole === "camera") return;

    if (faceCamPeerConnections[faceCamKey(sourceId, "recv")]) return;

    faceCamSources[sourceId] = {
        ...(faceCamSources[sourceId] || {}),
        ...sourceInfo,
        mediaType: "facecam"
    };

    const peer = createFaceCamReceiverPeer(sourceId, sourceInfo);

    if (peer.signalingState !== "stable") return;

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log("[FACECAM] renegotiation started", {
        target: sourceId,
        side: "recv"
    });

    socket.emit("facecam-offer", {
        target: sourceId,
        offer
    });
}

function cleanupFaceCamPeer(socketId, { removeRemote = true } = {}) {
    ["send", "recv"].forEach(side => {
        const key = faceCamKey(socketId, side);
        const peer = faceCamPeerConnections[key];

        if (peer) {
            peer.close();
            delete faceCamPeerConnections[key];
        }

        delete faceCamPendingCandidates[key];
    });

    if (removeRemote) {
        const info = faceCamSources[socketId] || {};
        delete remoteFaceCamStreams[socketId];
        delete faceCamSources[socketId];
        window.removeRemoteFaceCam?.(info.playerNumber || socketId);
    }
}

async function flushFaceCamCandidates(key) {
    const peer = faceCamPeerConnections[key];
    const queued = faceCamPendingCandidates[key] || [];

    if (!peer || !peer.remoteDescription) return;

    while (queued.length) {
        await peer.addIceCandidate(new RTCIceCandidate(queued.shift()));
    }

    delete faceCamPendingCandidates[key];
}

window.startFaceCamBroadcast = function(stream, meta = {}) {
    if (!stream || currentRole !== "player" || !currentRoomId) return;

    localFaceCamStream = stream;
    localFaceCamMeta = {
        ...meta,
        roomId: currentRoomId,
        playerNumber: meta.playerNumber || myPlayerNumberRTC,
        mediaType: "facecam"
    };

    socket.emit("facecam-started", {
        roomId: currentRoomId,
        playerNumber: localFaceCamMeta.playerNumber
    });
    console.log("[FACECAM] renegotiation started", {
        roomId: currentRoomId,
        playerNumber: localFaceCamMeta.playerNumber,
        reason: "facecam-started"
    });
};

window.stopFaceCamBroadcast = function({ roomId } = {}) {
    const hadStream = !!localFaceCamStream;

    localFaceCamStream = null;
    localFaceCamMeta = null;

    Object.keys(faceCamPeerConnections)
        .filter(key => key.endsWith(":send"))
        .forEach(key => {
            faceCamPeerConnections[key].close();
            delete faceCamPeerConnections[key];
        });

    if (hadStream && (roomId || currentRoomId)) {
        socket.emit("facecam-stopped", {
            roomId: roomId || currentRoomId
        });
    }
};

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
    if (isPhoneCameraMode()) {
        cameraLog("Reconexão iniciada", {
            targetId,
            attempt: reconnectAttempts[targetId],
            baseDelay,
            remoteRole: info.role
        });
    }

    reconnectTimers[targetId] = setTimeout(async () => {
        delete reconnectTimers[targetId];
        if (!peerInfo[targetId]) return;

        if (currentRole === "camera" && info.role === "camera") return;
        if (info.role === "spectator") return;

        try {
            const existingPeer = peerConnections[targetId];

            if (
                existingPeer &&
                !existingPeer.__resenhaClosing &&
                existingPeer.signalingState === "stable" &&
                typeof existingPeer.restartIce === "function"
            ) {
                rtcLog(targetId, "restarting ICE on existing peer", {
                    attempt: reconnectAttempts[targetId],
                    peer: peerSnapshot(existingPeer)
                });
                existingPeer.restartIce();
                await createOffer(targetId, info, { iceRestart: true });
                return;
            }

            cleanupPeer(targetId);
            savePeerInfo(targetId, info);
            await createOffer(targetId, info);
        } catch (error) {
            console.warn("Falha ao renegociar WebRTC:", error);
            if (isPhoneCameraMode()) {
                cameraLog("Reconexão falhou", {
                    targetId,
                    errorName: error?.name,
                    errorMessage: error?.message
                }, "warn");
            }
        }
    }, baseDelay * reconnectAttempts[targetId]);
}

function cleanupPeer(socketId) {
    const info = peerInfo[socketId] || {};
    const stream = remoteStreams[socketId];
    const peerConnection = peerConnections[socketId];

    rtcLog(socketId, "cleaning peer connection", {
        remoteRole: info.role,
        playerNumber: info.playerNumber,
        linkedPlayer: info.linkedPlayer,
        hasRemoteStream: !!stream,
        hasPeerConnection: !!peerConnection,
        peer: peerSnapshot(peerConnection)
    });

    delete peerConnections[socketId];
    delete makingOffer[socketId];

    if (reconnectTimers[socketId]) {
        clearTimeout(reconnectTimers[socketId]);
        delete reconnectTimers[socketId];
    }

    if (peerConnection) {
        peerConnection.__resenhaClosing = true;
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

async function reconnectAllMediaPeers(reason = "manual") {
    if (!currentRoomId) return;

    socketLog("manual media reconnect started", {
        reason,
        peers: Object.keys(peerInfo)
    });
    window.showRoomToast?.("Tentando reconectar áudio/vídeo...");

    for (const [socketId, info] of Object.entries(peerInfo)) {
        if (!info) continue;
        if (currentRole === "camera" && info.role === "camera") continue;
        if (info.role === "spectator") continue;

        try {
            const peer = peerConnections[socketId];

            if (
                peer &&
                !peer.__resenhaClosing &&
                peer.signalingState === "stable" &&
                typeof peer.restartIce === "function"
            ) {
                peer.restartIce();
                await createOffer(socketId, info, { iceRestart: true });
            } else {
                cleanupPeer(socketId);
                savePeerInfo(socketId, info);
                await createOffer(socketId, info);
            }
        } catch (error) {
            rtcLog(socketId, "manual media reconnect failed", {
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        }
    }

    socketLog("manual media reconnect finished", { reason });
}

window.reconnectRoomMedia = reconnectAllMediaPeers;

if (reconnectMediaBtn) {
    reconnectMediaBtn.addEventListener("click", () => {
        reconnectAllMediaPeers("button");
    });
}

window.shutdownRoomConnection = function() {
    const shutdownRoomId = currentRoomId;

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

    window.stopFaceCamBroadcast?.({ roomId: shutdownRoomId });

    Object.keys(faceCamPeerConnections).forEach(key => {
        faceCamPeerConnections[key].close();
        delete faceCamPeerConnections[key];
    });

    Object.keys(faceCamPendingCandidates).forEach(key => {
        delete faceCamPendingCandidates[key];
    });

    Object.keys(faceCamSources).forEach(socketId => {
        delete faceCamSources[socketId];
        window.removeRemoteFaceCam?.(socketId);
    });

    Object.keys(remoteFaceCamStreams).forEach(socketId => {
        delete remoteFaceCamStreams[socketId];
    });

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    releaseCameraWakeLock();

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
};

function rtcLog(targetId, message, details = {}) {
    if (!RTC_DEBUG) return;

    console.log(`[WEBRTC${targetId ? `:${targetId}` : ""}] ${message}`, {
        socketId: socket.id,
        roomId: currentRoomId,
        role: currentRole,
        ...details
    });
}

function scopedLog(scope, message, details = {}, level = "log") {
    if (!RTC_DEBUG) return;

    const logger = typeof console[level] === "function" ? console[level] : console.log;

    logger.call(console, `[${scope}] ${message}`, {
        socketId: socket.id,
        roomId: currentRoomId,
        role: currentRole,
        ...details
    });
}

function mediaLog(message, details = {}, level = "log") {
    scopedLog("MEDIA", message, details, level);
}

function socketLog(message, details = {}, level = "log") {
    scopedLog("SOCKET", message, details, level);
}

function spectatorLog(message, details = {}, level = "log") {
    scopedLog("SPECTATOR", message, details, level);
}

function cameraLog(message, details = {}, level = "log") {
    scopedLog("CAMERA", message, details, level);
}

function audioLog(message, details = {}, level = "log") {
    scopedLog("AUDIO", message, details, level);
}

function notifyConnectionUnstable(targetId, reason = "unknown") {
    const now = Date.now();

    if (now - lastConnectionToastAt < 12000) return;

    lastConnectionToastAt = now;
    const message = "Conexão instável detectada. Tentando reconectar áudio/vídeo...";

    rtcLog(targetId, "connection unstable notification", { reason }, "warn");
    window.showRoomToast?.(message);
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

async function createOffer(targetId, data = {}, options = {}) {
    savePeerInfo(targetId, data);

    const peer = createPeerConnection(targetId);

    if (options.waitForStable && peer.signalingState !== "stable") {
        await new Promise(resolve => {
            const startedAt = Date.now();
            const wait = () => {
                if (peer.signalingState === "stable" || Date.now() - startedAt > 2200) {
                    resolve();
                    return;
                }
                setTimeout(wait, 120);
            };
            wait();
        });
    }

    if (makingOffer[targetId] || peer.signalingState !== "stable") {
        rtcLog(targetId, "offer skipped", {
            makingOffer: !!makingOffer[targetId],
            signalingState: peer.signalingState
        });
        return;
    }

    try {
        makingOffer[targetId] = true;
        rtcLog(targetId, "creating offer", {
            iceRestart: !!options.iceRestart
        });

        const offer = await peer.createOffer(options.iceRestart ? { iceRestart: true } : {});
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

    if (isCameraMode) {
        refreshCameraModeResilience("join-room");
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
        decklistUrl: user.decklistUrl || "",
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

    if (data.role === "camera") {
        refreshCameraModeResilience("assigned-role");
    }
});

socket.on("connect", async () => {
    socketLog("socket connected", {
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
        refreshCameraModeResilience("socket-reconnect");
        socket.emit("join-room", lastJoinPayload);
    } catch (error) {
        console.warn("Falha ao restaurar sala após reconexão:", error);
    }
});

socket.on("disconnect", (reason) => {
    socketLog("socket disconnected", {
        reason,
        peerCount: Object.keys(peerConnections).length,
        peers: Object.keys(peerConnections)
    });
});

socket.on("connect_error", (error) => {
    socketLog("socket connect error", {
        errorMessage: error?.message,
        errorDescription: error?.description,
        errorContext: error?.context
    }, "warn");
});

socket.io?.on?.("reconnect_attempt", (attempt) => {
    socketLog("socket reconnect attempt", {
        attempt,
        peerCount: Object.keys(peerConnections).length
    });

    if (isPhoneCameraMode()) {
        cameraLog("Reconexão iniciada", {
            reason: "socket-reconnect",
            attempt
        });
    }
});

socket.io?.on?.("reconnect", (attempt) => {
    socketLog("socket reconnected", {
        attempt,
        socketId: socket.id,
        peerCount: Object.keys(peerConnections).length
    });

    if (isPhoneCameraMode()) {
        cameraLog("Reconexão concluída", {
            reason: "socket-reconnect",
            attempt
        });
    }
});

socket.io?.on?.("reconnect_error", (error) => {
    socketLog("socket reconnect error", {
        errorMessage: error?.message
    }, "warn");
});

socket.io?.on?.("reconnect_failed", () => {
    socketLog("socket reconnect failed", {
        peerCount: Object.keys(peerConnections).length
    }, "warn");
});

socket.on("existing-peers", async ({ peers }) => {
    socketLog("existing peers received", {
        count: peers?.length || 0,
        peers: (peers || []).map(peer => ({
            socketId: peer.socketId,
            role: peer.role,
            playerNumber: peer.playerNumber,
            linkedPlayer: peer.linkedPlayer
        }))
    });

    for (const peerData of peers) {
        if (!peerData.socketId) continue;

        savePeerInfo(peerData.socketId, peerData);

        if (peerData.role === "spectator") {
            spectatorLog("skipping offer to spectator peer", {
                target: peerData.socketId
            });
            continue;
        }

        if (currentRole === "camera" && peerData.role === "camera") {
            cameraLog("skipping camera to camera peer offer", {
                target: peerData.socketId
            });
            continue;
        }

        await createOffer(peerData.socketId, peerData);
    }
});

socket.on("user-connected", (data) => {
    if (!data.socketId) return;

    socketLog("user connected to room", {
        socketId: data.socketId,
        role: data.role,
        playerNumber: data.playerNumber,
        linkedPlayer: data.linkedPlayer
    });

    savePeerInfo(data.socketId, data);

    if (data.role === "overlay" && (currentRole === "player" || currentRole === "camera")) {
        rtcLog(data.socketId, "creating offer to OBS overlay", {
            remoteRole: data.role
        });
        createOffer(data.socketId, data);
        return;
    }

    if (currentRole === "spectator" && data.role !== "spectator") {
        spectatorLog("spectator creating offer to new media sender", {
            target: data.socketId,
            remoteRole: data.role
        });
        createOffer(data.socketId, data);
    }
});

socket.on("room-state", ({ faceCams = [] } = {}) => {
    faceCams.forEach(source => {
        if (!source?.socketId || source.socketId === socket.id) return;
        requestFaceCamSource(source).catch(error => {
            console.warn("Falha ao solicitar FaceCam ativa:", error);
        });
    });
});

socket.on("facecam-list", ({ faceCams = [] } = {}) => {
    faceCams.forEach(source => {
        if (!source?.socketId || source.socketId === socket.id) return;
        requestFaceCamSource(source).catch(error => {
            console.warn("Falha ao solicitar FaceCam:", error);
        });
    });
});

socket.on("facecam-started", (source = {}) => {
    if (!source.socketId || source.socketId === socket.id) return;

    requestFaceCamSource(source).catch(error => {
        console.warn("Falha ao conectar FaceCam:", error);
    });
});

socket.on("facecam-stopped", ({ socketId, playerNumber }) => {
    if (!socketId) return;

    cleanupFaceCamPeer(socketId);
    window.removeRemoteFaceCam?.(playerNumber || socketId);
});

socket.on("facecam-offer", async ({ offer, sender, senderInfo }) => {
    if (!sender || !offer || !localFaceCamStream) return;

    try {
        const peer = createFaceCamSenderPeer(sender);

        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        console.log("[FACECAM] renegotiation started", {
            target: sender,
            side: "send"
        });

        socket.emit("facecam-answer", {
            target: sender,
            answer
        });

        await flushFaceCamCandidates(faceCamKey(sender, "send"));
    } catch (error) {
        console.error("Erro ao processar offer da FaceCam:", error);
    }
});

socket.on("facecam-answer", async ({ answer, sender, senderInfo }) => {
    if (!sender || !answer) return;

    if (senderInfo) {
        faceCamSources[sender] = {
            ...(faceCamSources[sender] || {}),
            ...senderInfo,
            socketId: sender,
            mediaType: "facecam"
        };
    }

    const key = faceCamKey(sender, "recv");
    const peer = faceCamPeerConnections[key];

    if (!peer) return;

    try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        await flushFaceCamCandidates(key);
    } catch (error) {
        console.error("Erro ao processar answer da FaceCam:", error);
    }
});

socket.on("facecam-ice-candidate", async ({ candidate, sender, side }) => {
    if (!candidate || !sender) return;

    const localSide = side === "recv" ? "send" : "recv";
    const key = faceCamKey(sender, localSide);
    const peer = faceCamPeerConnections[key];

    if (!peer || !peer.remoteDescription) {
        faceCamPendingCandidates[key] = faceCamPendingCandidates[key] || [];
        faceCamPendingCandidates[key].push(candidate);
        return;
    }

    try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
        console.error("Erro ICE FaceCam:", error);
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
    socketLog("user disconnected from room", {
        socketId,
        knownPeer: !!peerConnections[socketId]
    });
    cleanupPeer(socketId);
    cleanupFaceCamPeer(socketId);
});

socket.on("camera-replaced", () => {
    cameraLog("camera connection replaced", {}, "warn");
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
    cameraLog("camera connection rejected", { message }, "warn");
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
            cameraLog("camera switch failed", {
                ...getMediaErrorInfo(err)
            }, "warn");
            showCriticalMediaAlert(err);
        }
    });
}

if (microphoneSelect) {
    microphoneSelect.addEventListener("change", async () => {
        try {
            await switchMicrophone(microphoneSelect.value);
        } catch (err) {
            console.error("Erro ao trocar microfone:", err);
            audioLog("microphone switch failed", {
                ...getMediaErrorInfo(err)
            }, "warn");
            showCriticalMediaAlert(err);
        }
    });
}

if (spectatorMicrophoneSelect) {
    spectatorMicrophoneSelect.addEventListener("change", async () => {
        selectedSpectatorMicrophoneId = spectatorMicrophoneSelect.value || "";

        if (selectedSpectatorMicrophoneId) {
            localStorage.setItem("magicSelectedSpectatorMicrophone", selectedSpectatorMicrophoneId);
        } else {
            localStorage.removeItem("magicSelectedSpectatorMicrophone");
        }

        console.log("[AUDIO][SPECTATOR] device selected", {
            selectedDeviceId: selectedSpectatorMicrophoneId || "default"
        });

        if (currentRole === "spectator" && micEnabled && localStream?.getAudioTracks().length) {
            console.log("[AUDIO][SPECTATOR] microphone changed", {
                selectedDeviceId: selectedSpectatorMicrophoneId || "default"
            });
            await window.enableSpectatorMicrophone?.();
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

    await refreshSpectatorMicrophones().catch(error => {
        audioLog("[SPECTATOR] devices refresh failed", {
            errorName: error?.name,
            errorMessage: error?.message
        }, "warn");
    });

    const audioConstraints = getSpectatorAudioConstraints();

    audioLog("[SPECTATOR] getUserMedia audio start", {
        selectedDeviceId: selectedSpectatorMicrophoneId || "default"
    });
    const audioStream = await getUserMediaWithDeviceFallback(
        {
            video: false,
            audio: audioConstraints
        },
        {
            video: false,
            audio: true
        },
        {
            microphone: !!selectedSpectatorMicrophoneId
        }
    );

    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) return;
    const trackSettings = audioTrack.getSettings?.() || {};
    if (trackSettings.deviceId) {
        selectedSpectatorMicrophoneId = trackSettings.deviceId;
        localStorage.setItem("magicSelectedSpectatorMicrophone", selectedSpectatorMicrophoneId);
        if (spectatorMicrophoneSelect) {
            spectatorMicrophoneSelect.value = selectedSpectatorMicrophoneId;
        }
    }

    console.log("[AUDIO][SPECTATOR] microphone started", {
        selectedDeviceId: selectedSpectatorMicrophoneId || "default",
        actualDeviceId: trackSettings.deviceId || "default"
    });

    audioLog("[SPECTATOR] getUserMedia audio success", {
        trackId: audioTrack.id,
        readyState: audioTrack.readyState,
        enabled: audioTrack.enabled
    });

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
    audioLog("[SPECTATOR] audio track added", {
        peerCount: Object.keys(peerConnections).length,
        trackId: audioTrack.id
    });

    Object.values(peerConnections).forEach(peer => {
        const sender = peer.getSenders().find(s => s.track?.kind === "audio");

        if (sender) {
            audioLog("[SPECTATOR] replacing audio sender track");
            sender.replaceTrack(audioTrack).catch(error => {
                audioLog("spectator microphone replaceTrack failed", {
                    errorName: error?.name,
                    errorMessage: error?.message
                }, "warn");
            });
        } else {
            audioLog("[SPECTATOR] adding audio sender track");
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
            audioLog("[SPECTATOR] renegotiation started", {
                target: socketId,
                role: info.role,
                playerNumber: info.playerNumber
            });
            await createOffer(socketId, info, { waitForStable: true }).catch(error => {
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
            .forEach(sender => {
                sender.replaceTrack(null).catch(error => {
                    audioLog("spectator microphone detach failed", {
                        errorName: error?.name,
                        errorMessage: error?.message
                    }, "warn");
                });
            });
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
    refreshCameraModeResilience("devicechange");
});

document.addEventListener("visibilitychange", () => {
    if (!isPhoneCameraMode()) return;

    if (document.visibilityState === "visible") {
        refreshCameraModeResilience("visibility-visible");
    }
});

window.addEventListener("pageshow", () => {
    refreshCameraModeResilience("pageshow");
});

window.addEventListener("beforeunload", () => {
    releaseCameraWakeLock();
});

updateMediaStatus();
