const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const cameraSelect = document.getElementById("cameraSelect");
const microphoneSelect = document.getElementById("microphoneSelect");
const spectatorMicrophoneSelect = document.getElementById("spectatorMicrophoneSelect");
const reconnectMediaBtn = document.getElementById("reconnectMediaBtn");
const reloadSpectatorVideosBtn = document.getElementById("reloadSpectatorVideosBtn");

const micStatusText = document.getElementById("micStatusText");
const cameraStatusText = document.getElementById("cameraStatusText");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");

let localStream = null;
let mainLocalStream = null;
let cameraOnlyStream = null;
let spectatorAudioStream = null;
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

window.peerConnections = peerConnections;
window.webrtcDebug = {
    peerConnections,
    peerInfo,
    remoteStreams,
    pendingCandidates
};

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

function isCameraOnlyClient() {
    return currentRole === "camera" || document.body.classList.contains("camera-mode");
}

function setActiveLocalStream(stream, role = currentRole) {
    localStream = stream;

    if (role === "camera") {
        cameraOnlyStream = sanitizeTableCameraStream(stream, "set-active-camera-stream");
        localStream = cameraOnlyStream;
        return;
    }

    if (role === "spectator") {
        spectatorAudioStream = stream;
        return;
    }

    if (role === "player") {
        mainLocalStream = stream;
    }
}

function getActiveLocalStream() {
    if (currentRole === "camera") return cameraOnlyStream || localStream;
    if (currentRole === "spectator") return spectatorAudioStream || localStream;
    if (currentRole === "player") return mainLocalStream || localStream;
    return localStream;
}

function logStreamTrackSummary(label, stream, level = "log") {
    const logger = typeof console[level] === "function" ? console[level] : console.log;
    logger.call(console, `[RTC_DEBUG][MEDIA] ${label}`, {
        role: currentRole,
        streamId: stream?.id || null,
        audioTracks: stream?.getAudioTracks?.().map(track => ({
            id: track.id,
            enabled: track.enabled,
            readyState: track.readyState
        })) || [],
        videoTracks: stream?.getVideoTracks?.().map(track => ({
            id: track.id,
            enabled: track.enabled,
            readyState: track.readyState
        })) || []
    });
}

function removeAudioTracksFromCameraStream(stream, reason = "camera-stream-sanitize") {
    if (!stream?.getAudioTracks) return stream;

    stream.getAudioTracks().forEach(track => {
        audioLog("Mobile/table camera audio track removed intentionally", {
            reason,
            trackId: track.id,
            readyState: track.readyState
        }, "warn");
        track.stop();
        stream.removeTrack(track);
    });

    return stream;
}

function sanitizeTableCameraStream(stream, reason = "table-camera") {
    if (!stream) return null;

    removeAudioTracksFromCameraStream(stream, reason);
    const videoTracks = stream.getVideoTracks();
    const videoOnlyStream = new MediaStream(videoTracks);

    logStreamTrackSummary("table/mobile camera stream sanitized", videoOnlyStream);
    return videoOnlyStream;
}

function updateMediaStatus() {
    const activeStream = getActiveLocalStream();
    const isCameraOnly = isCameraOnlyClient();
    const hasActiveMic = !isCameraOnly && !!activeStream?.getAudioTracks().length && micEnabled;

    if (micStatusText) {
        if (isCameraOnly) {
            micStatusText.innerText = "Somente vídeo";
        } else {
            micStatusText.innerText = activeStream?.getAudioTracks().length
            ? (micEnabled ? "Ativado" : "Desativado")
            : "Sem microfone";
        }
    }

    if (cameraStatusText) {
        cameraStatusText.innerText = activeStream?.getVideoTracks().length
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
    const activeStream = getActiveLocalStream();
    if (!activeStream) return;

    if (currentRole === "camera") {
        removeAudioTracksFromCameraStream(activeStream, "replace-local-camera-tracks");
        const videoTrack = activeStream.getVideoTracks()[0];
        if (videoTrack) {
            replaceVideoTrackOnPeers(videoTrack, "replace-local-camera-tracks");
        }
        return;
    }

    ["video", "audio"].forEach(kind => {
        const track = activeStream.getTracks().find(item => item.kind === kind);
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
    const videoTrack = cameraOnlyStream?.getVideoTracks?.()[0];
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
    const videoOnly = constraints?.audio === false;
    const fallbackConstraints = videoOnly
        ? {
            video: true,
            audio: false
        }
        : {
            video: true,
            audio: true
        };

    try {
        lastMediaAccessError = null;
        return await getUserMediaWithDeviceFallback(
            constraints,
            fallbackConstraints,
            resetOptions
        );
    } catch (videoError) {
        lastMediaAccessError = videoError;

        if (videoOnly) {
            mediaLog("video-only media request failed; not falling back to audio", {
                ...getMediaErrorInfo(videoError)
            }, "warn");
            throw videoError;
        }

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
    const isCameraOnlyMode = currentRole === "camera";

    rtcLog(null, "starting local media", {
        role: currentRole,
        videoOnly: isCameraOnlyMode,
        hasSavedCamera: !!cameraId,
        hasSavedMicrophone: !isCameraOnlyMode && !!microphoneId
    });

    const constraints = {
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: isCameraOnlyMode
            ? false
            : (microphoneId ? { deviceId: { exact: microphoneId } } : true)
    };

    if (isCameraOnlyMode) {
        audioLog("[RTC_DEBUG][AUDIO] camera-only mode: requesting video only", {
            role: currentRole
        });
        audioLog("[RTC_DEBUG][AUDIO] camera audio intentionally disabled", {
            role: currentRole
        });
    }

    const nextStream = await getOptionalRoomMedia(
        constraints,
        {
            camera: !!cameraId,
            microphone: !isCameraOnlyMode && !!microphoneId
        }
    );

    const sanitizedNextStream = isCameraOnlyMode
        ? sanitizeTableCameraStream(nextStream, "start-webcam-camera-mode")
        : nextStream;

    logStreamTrackSummary(isCameraOnlyMode ? "mobile camera getUserMedia success" : "main room media getUserMedia success", sanitizedNextStream);

    if (!sanitizedNextStream) {
        if (localVideo && !getActiveLocalStream()) {
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

    const previousRoleStream = isCameraOnlyMode
        ? cameraOnlyStream
        : (currentRole === "player" ? mainLocalStream : getActiveLocalStream());

    if (previousRoleStream && previousRoleStream !== sanitizedNextStream) {
        previousRoleStream.getTracks().forEach(track => track.stop());
    }

    setActiveLocalStream(sanitizedNextStream, currentRole);

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

    if (isCameraOnlyMode) {
        removeAudioTracksFromCameraStream(localStream, "start-webcam-post-check");
    }

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

    if (!isCameraOnlyMode && audioTrack) {
        const settings = audioTrack.getSettings();
        selectedMicrophoneId = settings.deviceId || selectedMicrophoneId;
        localStorage.setItem("magicSelectedMicrophone", selectedMicrophoneId);
        audioLog("[RTC_DEBUG][AUDIO] local audio track ready", {
            role: currentRole,
            trackId: audioTrack.id,
            enabled: audioTrack.enabled,
            readyState: audioTrack.readyState,
            deviceId: settings.deviceId || "default"
        });
        if (currentRole === "player") {
            audioLog("[RTC_DEBUG][AUDIO] player microphone active", {
                trackId: audioTrack.id,
                enabled: audioTrack.enabled,
                readyState: audioTrack.readyState
            });
            audioLog("[RTC_DEBUG][AUDIO] player audio enabled", {
                trackId: audioTrack.id,
                enabled: audioTrack.enabled,
                readyState: audioTrack.readyState
            });
        }

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

    const videoOnlyStream = currentRole === "camera"
        ? sanitizeTableCameraStream(newStream, "switch-camera-camera-mode")
        : newStream;

    if (currentRole !== "camera") {
        removeAudioTracksFromCameraStream(videoOnlyStream, "switch-camera-video-only");
    }

    logStreamTrackSummary("camera switch stream ready", videoOnlyStream);

    const newVideoTrack = videoOnlyStream.getVideoTracks()[0];
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

    const activeStream = getActiveLocalStream() || new MediaStream();

    activeStream.getVideoTracks().forEach(track => {
        track.stop();
        activeStream.removeTrack(track);
    });

    activeStream.addTrack(newVideoTrack);

    if (currentRole === "camera") {
        removeAudioTracksFromCameraStream(activeStream, "switch-camera-active-stream");
    }

    setActiveLocalStream(activeStream, currentRole);

    routeLocalPreview();

    replaceVideoTrackOnPeers(newVideoTrack, "switch-camera");
    monitorCameraModeTrack(getActiveLocalStream());
    mediaErrorAlertShown = false;
    updateMediaStatus();
}

/* =========================
   TROCAR MICROFONE
========================= */

async function switchMicrophone(microphoneId) {
    if (!microphoneId) return;
    if (isCameraOnlyClient()) {
        audioLog("[RTC_DEBUG][AUDIO] camera-only mode: no audio sender added", {
            reason: "switch-microphone-blocked"
        });
        return;
    }

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
    setActiveLocalStream(localStream, currentRole);

    replaceTrackOnPeers("audio", newAudioTrack);
    mediaErrorAlertShown = false;
    updateMediaStatus();
}

function replaceTrackOnPeers(kind, newTrack) {
    Object.entries(peerConnections).forEach(([socketId, peer]) => {
        if (kind === "audio") {
            const changed = upsertAudioTrackForPeer(peer, newTrack, socketId, "replace-track-on-peers");
            if (changed) {
                requestRenegotiationAfterAudioUpdate(socketId, "replace-track-on-peers");
            }
            return;
        }

        const sender = findSenderByKind(peer, kind);

        if (!sender) return;

        sender.replaceTrack(newTrack).catch(error => {
            rtcLog(socketId, "replaceTrack failed", {
                kind,
                errorName: error?.name,
                errorMessage: error?.message
            });
        });
    });
}

function replaceVideoTrackOnPeers(newVideoTrack, reason = "video-replace") {
    if (!newVideoTrack || newVideoTrack.kind !== "video") return;

    Object.entries(peerConnections).forEach(([socketId, peer]) => {
        const videoSender = peer?.getSenders?.().find(sender =>
            sender.track && sender.track.kind === "video"
        );

        if (!videoSender) {
            rtcLog(socketId, "video replace skipped; no video sender", {
                reason,
                trackId: newVideoTrack.id
            }, "warn");
            return;
        }

        rtcLog(socketId, "video sender replaceTrack", {
            reason,
            previousTrackId: videoSender.track?.id || null,
            nextTrackId: newVideoTrack.id
        });

        videoSender.replaceTrack(newVideoTrack).catch(error => {
            rtcLog(socketId, "replaceTrack failed", {
                kind: "video",
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
    });
}

function findSenderByKind(peer, kind) {
    if (!peer?.getSenders) return null;

    return peer.getSenders().find(sender => sender.track?.kind === kind) || null;
}

function isRemoteCameraPeer(targetId) {
    return peerInfo[targetId]?.role === "camera";
}

function hasTransceiverByKind(peer, kind) {
    return !!peer?.getTransceivers?.().some(transceiver =>
        transceiver.sender?.track?.kind === kind ||
        transceiver.receiver?.track?.kind === kind ||
        transceiver.mid === kind
    );
}

function ensureReceiveTransceivers(peer, targetId) {
    if (!peer || currentRole === "camera") return;

    const activeStream = getActiveLocalStream();
    const hasLocalVideo = !!activeStream?.getVideoTracks?.().some(track => track.readyState === "live");
    const hasLocalAudio = !!activeStream?.getAudioTracks?.().some(track => track.readyState === "live");

    if (currentRole === "spectator" && !hasLocalVideo && !hasTransceiverByKind(peer, "video")) {
        peer.addTransceiver("video", { direction: "recvonly" });
        rtcLog(targetId, "recvonly video transceiver added for spectator");
    }

    if (!hasLocalAudio && !hasTransceiverByKind(peer, "audio")) {
        peer.addTransceiver("audio", { direction: "recvonly" });
        rtcLog(targetId, "recvonly audio transceiver added");
    }
}

function getLocalAudioTrack() {
    return getActiveLocalStream()?.getAudioTracks?.().find(track => track.readyState === "live") || null;
}

function upsertAudioTrackForPeer(peerConnection, audioTrack, targetId, reason = "audio-upsert") {
    const activeStream = getActiveLocalStream();
    if (!peerConnection || !audioTrack || !activeStream) return false;

    if (currentRole === "camera") {
        audioLog("[RTC_DEBUG][AUDIO] camera-only mode: no audio sender added", {
            targetId,
            reason,
            trackId: audioTrack.id
        });
        audioLog("[RTC_DEBUG][AUDIO] skipped audio track for camera-only client", {
            targetId,
            reason,
            localRole: currentRole,
            remoteRole: peerInfo[targetId]?.role || "unknown",
            trackId: audioTrack.id
        });
        return false;
    }

    if (isRemoteCameraPeer(targetId)) {
        audioLog("[RTC_DEBUG][AUDIO] preserving player audio sender", {
            targetId,
            reason,
            localRole: currentRole,
            remoteRole: peerInfo[targetId]?.role || "camera",
            trackId: audioTrack.id
        });
        return false;
    }

    const existingSender = findSenderByKind(peerConnection, "audio");

    if (existingSender) {
        if (existingSender.track === audioTrack) {
            rtcLog(targetId, "local audio sender already has track", {
                reason,
                trackId: audioTrack.id
            });
            return false;
        }

        audioLog("[RTC_DEBUG][AUDIO] replacing audio sender track", {
            targetId,
            reason,
            previousTrackId: existingSender.track?.id || null,
            nextTrackId: audioTrack.id
        });

        existingSender.replaceTrack(audioTrack).catch(error => {
            rtcLog(targetId, "replaceTrack failed", {
                kind: "audio",
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
        return true;
    }

    audioLog("[RTC_DEBUG][AUDIO] adding audio sender to peer", {
        targetId,
        reason,
        trackId: audioTrack.id
    });

    peerConnection.addTrack(audioTrack, activeStream);
    return true;
}

function requestRenegotiationAfterAudioUpdate(targetId, reason = "audio-update") {
    const info = peerInfo[targetId];
    const peer = peerConnections[targetId];

    if (!targetId || !peer || isPeerClosed(peer)) return;
    if (currentRole === "camera") return;
    if (info?.role === "camera") return;

    audioLog("[RTC_DEBUG][AUDIO] renegotiation requested after audio update", {
        targetId,
        reason,
        remoteRole: info?.role || "unknown",
        signalingState: peer.signalingState
    });

    createOffer(targetId, info || {}, { waitForStable: true }).catch(error => {
        rtcLog(targetId, "audio renegotiation failed", {
            reason,
            errorName: error?.name,
            errorMessage: error?.message
        }, "warn");
    });
}

function syncLocalAudioTrackToPeers(reason = "audio-sync") {
    const audioTrack = getLocalAudioTrack();
    if (!audioTrack) return;

    Object.entries(peerConnections).forEach(([socketId, peer]) => {
        const changed = upsertAudioTrackForPeer(peer, audioTrack, socketId, reason);
        if (changed) {
            requestRenegotiationAfterAudioUpdate(socketId, reason);
        }
    });
}

async function ensurePlayerVideoSentToPeer(targetId, reason = "ensure-video") {
    if (!targetId) return;
    const info = peerInfo[targetId] || {};
    const peer = createPeerConnection(targetId);
    const activeStream = getActiveLocalStream();

    if (activeStream) {
        if (currentRole === "camera") {
            removeAudioTracksFromCameraStream(activeStream, `${reason}-camera-sanitize`);
        }

        activeStream.getVideoTracks().forEach(track => {
            addOrReplaceLocalTrack(peer, targetId, track, activeStream, reason);
        });

        if (currentRole !== "camera") {
            activeStream.getAudioTracks().forEach(track => {
                addOrReplaceLocalTrack(peer, targetId, track, activeStream, reason);
            });
        }
    }

    ensureReceiveTransceivers(peer, targetId);
    logPcStateDebug(targetId, peer, `${reason}-before-offer`);

    if (peer.signalingState === "stable") {
        await createOffer(targetId, info, { waitForStable: true });
    } else {
        rtcLog(targetId, "ensurePlayerVideoSentToPeer deferred; signaling not stable", {
            reason,
            signalingState: peer.signalingState
        }, "warn");
    }
}

async function refreshSpectatorVideoPeers(reason = "manual-refresh") {
    if (currentRole !== "spectator") return;

    spectatorLog("refreshing spectator video peers", {
        reason,
        peers: Object.entries(peerInfo).map(([socketId, info]) => ({
            socketId,
            role: info.role,
            playerNumber: info.playerNumber,
            linkedPlayer: info.linkedPlayer
        }))
    });

    for (const [socketId, info] of Object.entries(peerInfo)) {
        if (!["player", "camera"].includes(info.role)) continue;
        await ensurePlayerVideoSentToPeer(socketId, `spectator-${reason}`);
    }

    routeAllStreams();
}

function addOrReplaceLocalTrack(peer, targetId, track, stream, reason = "local-track-sync") {
    if (!peer || !track || !stream) return;

    const kind = track.kind;

    if (kind === "audio") {
        if (currentRole === "camera") {
            audioLog("Mobile/table camera audio track removed intentionally", {
                reason,
                trackId: track.id,
                targetId
            }, "warn");
            track.stop();
            stream.removeTrack?.(track);
            return;
        }
        upsertAudioTrackForPeer(peer, track, targetId, reason);
        return;
    }

    const sender = findSenderByKind(peer, kind);

    if (sender) {
        if (sender.track === track) {
            rtcLog(targetId, "local sender already has track", {
                kind,
                reason,
                trackId: track.id
            });
            return;
        }

        rtcLog(targetId, "replacing existing local sender track", {
            kind,
            reason,
            previousTrackId: sender.track?.id || null,
            nextTrackId: track.id
        });

        sender.replaceTrack(track).catch(error => {
            rtcLog(targetId, "replaceTrack failed", {
                kind,
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
        return;
    }

    peer.addTrack(track, stream);
    rtcLog(targetId, "local track added", {
        kind,
        reason,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
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
        console.log("[SPECTATOR VIDEO DEBUG]", {
            event: "video-loadedmetadata",
            videoId: videoElement.id,
            muted,
            videoWidth: videoElement.videoWidth,
            videoHeight: videoElement.videoHeight,
            streamId: stream.id,
            videoTracks: stream.getVideoTracks().map(track => ({
                id: track.id,
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState
            })),
            audioTracks: stream.getAudioTracks().map(track => ({
                id: track.id,
                label: track.label,
                enabled: track.enabled,
                readyState: track.readyState
            }))
        });
        videoElement.play().catch(error => {
            audioLog("video play after metadata failed", {
                videoId: videoElement.id,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
    };

    setTimeout(() => window.ResenhaONRoomSkins?.syncRoomSkinVisuals?.(), 0);
    setTimeout(() => window.ResenhaONRoomSkins?.syncRoomSkinVisuals?.(), 300);
}

function clearVideoIfStream(videoElement, stream) {
    if (!videoElement || !stream) return;

    if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
        setTimeout(() => window.ResenhaONRoomSkins?.syncRoomSkinVisuals?.(), 0);
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

function getCameraStreamForPlayer(playerNumber) {
    const entry = Object.entries(peerInfo).find(([socketId, peer]) =>
        peer.role === "camera" &&
        Number(peer.linkedPlayer) === Number(playerNumber) &&
        !!remoteStreams[socketId]
    );

    return entry ? remoteStreams[entry[0]] : null;
}

function getPlayerMediaStreamForPlayer(playerNumber) {
    if (
        currentRole === "player" &&
        Number(playerNumber) === Number(myPlayerNumberRTC)
    ) {
        return mainLocalStream || localStream;
    }

    const entry = Object.entries(peerInfo).find(([socketId, peer]) =>
        peer.role === "player" &&
        Number(peer.playerNumber) === Number(playerNumber) &&
        !!remoteStreams[socketId]
    );

    return entry ? remoteStreams[entry[0]] : null;
}

function buildAuxCameraDisplayStream(playerNumber, cameraStream) {
    if (!cameraStream) return null;

    removeAudioTracksFromCameraStream(cameraStream, "route-aux-camera-display");

    const playerStream = getPlayerMediaStreamForPlayer(playerNumber);
    const videoTracks = cameraStream.getVideoTracks();
    const audioTracks = playerStream?.getAudioTracks?.().filter(track => track.readyState === "live") || [];
    const displayStream = new MediaStream([...videoTracks, ...audioTracks]);

    rtcLog(null, "aux camera display stream composed", {
        playerNumber,
        cameraStreamId: cameraStream.id,
        playerStreamId: playerStream?.id || null,
        videoTracks: videoTracks.map(track => ({ id: track.id, label: track.label, readyState: track.readyState })),
        audioTracks: audioTracks.map(track => ({ id: track.id, label: track.label, readyState: track.readyState }))
    });

    return displayStream;
}

function routeCameraForPlayer(playerNumber, cameraStream) {
    const videoElement = getVideoElementForPlayer(playerNumber);
    const displayStream = buildAuxCameraDisplayStream(playerNumber, cameraStream);

    if (!videoElement || !displayStream) return;

    setVideoStream(
        videoElement,
        displayStream,
        currentRole === "player" && Number(playerNumber) === Number(myPlayerNumberRTC)
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
            routeCameraForPlayer(info.linkedPlayer, stream);

            return;
        }

        if (info.role === "player") {
            const cameraStream = getCameraStreamForPlayer(info.playerNumber);
            if (cameraStream) {
                routeCameraForPlayer(info.playerNumber, cameraStream);
            } else {
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
            routeCameraForPlayer(info.linkedPlayer, stream);

            return;
        }

        if (info.role === "player") {
            const cameraStream = getCameraStreamForPlayer(info.playerNumber);
            if (
                Number(info.playerNumber) !== Number(myPlayerNumberRTC) &&
                cameraStream
            ) {
                routeCameraForPlayer(info.playerNumber, cameraStream);
            } else if (
                Number(info.playerNumber) !== Number(myPlayerNumberRTC)
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

function inferTrackSource(fromId, track) {
    const info = peerInfo[fromId] || {};
    if (info.role === "camera") return "mobileCamera";
    if (track?.kind === "audio") return "roomAudio";
    if (info.role === "player") return "tableCamera";
    return "unknown";
}

function bindIncomingVideoTrack(fromId, track, stream, source = inferTrackSource(fromId, track)) {
    if (!fromId || !track) return null;

    if (!remoteStreams[fromId]) {
        remoteStreams[fromId] = new MediaStream();
    }

    const targetStream = remoteStreams[fromId];
    const candidateTracks = stream?.getTracks?.().length ? stream.getTracks() : [track];

    candidateTracks.forEach(candidate => {
        if (!targetStream.getTracks().some(existing => existing.id === candidate.id)) {
            targetStream.addTrack(candidate);
        }
    });

    console.log("[SPECTATOR VIDEO DEBUG]", {
        fromId,
        source,
        trackKind: track.kind,
        trackId: track.id,
        trackLabel: track.label,
        peerInfo: peerInfo[fromId] || {},
        streams: (stream ? [stream] : []).map(item => ({
            id: item.id,
            videoTracks: item.getVideoTracks().map(videoTrack => ({
                id: videoTrack.id,
                label: videoTrack.label,
                enabled: videoTrack.enabled,
                readyState: videoTrack.readyState
            })),
            audioTracks: item.getAudioTracks().map(audioTrack => ({
                id: audioTrack.id,
                label: audioTrack.label,
                enabled: audioTrack.enabled,
                readyState: audioTrack.readyState
            }))
        })),
        targetStream: {
            id: targetStream.id,
            videoTracks: targetStream.getVideoTracks().map(videoTrack => ({
                id: videoTrack.id,
                label: videoTrack.label,
                enabled: videoTrack.enabled,
                readyState: videoTrack.readyState
            })),
            audioTracks: targetStream.getAudioTracks().map(audioTrack => ({
                id: audioTrack.id,
                label: audioTrack.label,
                enabled: audioTrack.enabled,
                readyState: audioTrack.readyState
            }))
        }
    });

    routeStream(fromId, targetStream);
    setTimeout(() => routeStream(fromId, targetStream), 500);
    return targetStream;
}

/* =========================
   WEBRTC
========================= */

function createPeerConnection(targetId) {
    const existingPeer = peerConnections[targetId];

    if (existingPeer && !isPeerClosed(existingPeer)) {
        rtcLog(targetId, "createPeerConnection reused existing peer", {
            peer: peerSnapshot(existingPeer)
        });
        return existingPeer;
    }

    if (existingPeer) {
        rtcLog(targetId, "createPeerConnection replacing closed peer", {
            peer: peerSnapshot(existingPeer)
        }, "warn");
        closePeerConnection(targetId, "replace-closed-peer", { removeInfo: false, removeRemote: false });
    }

    const peer = new RTCPeerConnection(servers);
    peerConnections[targetId] = peer;
    rtcLog(targetId, "createPeerConnection created peer", {
        iceServers: servers.iceServers.map(server => server.urls)
    });

    const activeStream = getActiveLocalStream();

    if (activeStream) {
        activeStream.getTracks().forEach(track => {
            addOrReplaceLocalTrack(peer, targetId, track, activeStream, "create-peer");
        });
        ensureReceiveTransceivers(peer, targetId);
    } else {
        peer.addTransceiver("video", { direction: "recvonly" });
        if (currentRole !== "camera") {
            peer.addTransceiver("audio", { direction: "recvonly" });
        }
        rtcLog(targetId, "recvonly transceivers added");
    }

    peer.ontrack = (event) => {
        let stream = event.streams[0];

        console.log("[SPECTATOR VIDEO DEBUG]", {
            fromId: targetId,
            trackKind: event.track?.kind,
            trackId: event.track?.id,
            trackLabel: event.track?.label,
            peerInfo: peerInfo[targetId] || {},
            streams: event.streams?.map(item => ({
                id: item.id,
                videoTracks: item.getVideoTracks().map(track => ({
                    id: track.id,
                    label: track.label,
                    enabled: track.enabled,
                    readyState: track.readyState
                })),
                audioTracks: item.getAudioTracks().map(track => ({
                    id: track.id,
                    label: track.label,
                    enabled: track.enabled,
                    readyState: track.readyState
                }))
            })) || []
        });

        rtcLog(targetId, "remote track received", {
            kind: event.track?.kind,
            muted: event.track?.muted,
            readyState: event.track?.readyState,
            streamId: stream?.id,
            streamTrackCount: stream?.getTracks?.().length || 0
        });

        if (event.track?.kind === "audio") {
            audioLog("[RTC_DEBUG][AUDIO] remote audio track received", {
                targetId,
                muted: event.track.muted,
                readyState: event.track.readyState,
                streamId: stream?.id || null
            });
            audioLog("[RTC_DEBUG][AUDIO] remote audio received", {
                targetId,
                muted: event.track.muted,
                readyState: event.track.readyState,
                streamId: stream?.id || null
            });
        }

        event.track.onunmute = () => {
            rtcLog(targetId, "remote track unmuted", {
                kind: event.track.kind,
                readyState: event.track.readyState
            });
            bindIncomingVideoTrack(targetId, event.track, stream);
        };

        event.track.onended = () => {
            rtcLog(targetId, "remote track ended", {
                kind: event.track.kind
            });
        };

        stream = bindIncomingVideoTrack(targetId, event.track, stream);
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

    peer.onnegotiationneeded = () => {
        if (!getLocalAudioTrack() || currentRole === "camera") return;
        requestRenegotiationAfterAudioUpdate(targetId, "negotiationneeded");
    };

    peer.oniceconnectionstatechange = () => {
        const targetInfo = peerInfo[targetId] || {};
        const isAuxCameraPeer = targetInfo.role === "camera" || currentRole === "camera";
        rtcLog(targetId, "ice connection state changed", {
            iceConnectionState: peer.iceConnectionState,
            iceGatheringState: peer.iceGatheringState,
            signalingState: peer.signalingState,
            diagnostics: peerDiagnostics(peer)
        });
        logPcStateDebug(targetId, peer, "ice-connection-state-change");

        if (
            !peer.__resenhaClosing &&
            ["failed", "disconnected"].includes(peer.iceConnectionState)
        ) {
            if (isAuxCameraPeer) {
                rtcLog(targetId, "aux camera ICE state will restart without audio cleanup", {
                    reason: `ice-${peer.iceConnectionState}`,
                    remoteRole: targetInfo.role,
                    diagnostics: peerDiagnostics(peer)
                }, "warn");
            } else {
                notifyConnectionUnstable(targetId, `ice-${peer.iceConnectionState}`);
            }
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
        const targetInfo = peerInfo[targetId] || {};
        const isAuxCameraPeer = targetInfo.role === "camera" || currentRole === "camera";
        rtcLog(targetId, "connection state changed", {
            connectionState: peer.connectionState,
            diagnostics: peerDiagnostics(peer)
        });
        logPcStateDebug(targetId, peer, "connection-state-change");

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
            if (!isAuxCameraPeer) {
                notifyConnectionUnstable(targetId, "connection-failed");
            }
            schedulePeerReconnect(targetId);
        }

        if (peer.connectionState === "disconnected") {
            if (isAuxCameraPeer) {
                rtcLog(targetId, "aux camera connection disconnected; preserving audio peer", {
                    diagnostics: peerDiagnostics(peer)
                }, "warn");
            } else {
                notifyConnectionUnstable(targetId, "connection-disconnected");
            }
            schedulePeerReconnect(targetId, 5000);
        }

        if (isPhoneCameraMode() && peer.connectionState === "closed" && !peer.__resenhaClosing) {
            schedulePeerReconnect(targetId, 1200);
            return;
        }

        if (peer.connectionState === "closed" && peer.__resenhaClosing) {
            rtcLog(targetId, "closed state observed after intentional close", {
                peer: peerSnapshot(peer)
            });
            return;
        }

        if (peer.connectionState === "closed" && isAuxCameraPeer) {
            rtcLog(targetId, "aux camera peer closed observed; no global cleanup", {
                diagnostics: peerDiagnostics(peer)
            }, "warn");
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
            const isAuxCameraPeer = info.role === "camera" || currentRole === "camera";

            if (
                existingPeer &&
                !existingPeer.__resenhaClosing &&
                typeof existingPeer.restartIce === "function"
            ) {
                rtcLog(targetId, isAuxCameraPeer ? "aux camera ICE restart on existing peer" : "restarting ICE on existing peer", {
                    attempt: reconnectAttempts[targetId],
                    peer: peerSnapshot(existingPeer),
                    diagnostics: peerDiagnostics(existingPeer)
                });
                existingPeer.restartIce();

                if (existingPeer.signalingState === "stable") {
                    await createOffer(targetId, info, { iceRestart: true });
                } else {
                    rtcLog(targetId, "ICE restart offer deferred until stable", {
                        remoteRole: info.role,
                        signalingState: existingPeer.signalingState
                    }, "warn");
                }
                return;
            }

            if (isAuxCameraPeer) {
                rtcLog(targetId, "aux camera reconnect skipped destructive cleanup", {
                    remoteRole: info.role,
                    peer: peerSnapshot(existingPeer)
                }, "warn");
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

function closePeerConnection(socketId, reason = "cleanup", options = {}) {
    const { removeInfo = true, removeRemote = true } = options;
    const peerConnection = peerConnections[socketId];

    rtcLog(socketId, "closePeerConnection requested", {
        reason,
        removeInfo,
        removeRemote,
        hasPeerConnection: !!peerConnection,
        peer: peerSnapshot(peerConnection)
    });

    if (reconnectTimers[socketId]) {
        clearTimeout(reconnectTimers[socketId]);
        delete reconnectTimers[socketId];
        rtcLog(socketId, "reconnect timer cleared", { reason });
    }

    if (peerConnection) {
        peerConnection.__resenhaClosing = true;

        try {
            rtcLog(socketId, "pc.close() called", {
                reason,
                diagnosticsBeforeClose: peerDiagnostics(peerConnection)
            }, "warn");
            peerConnection.close();
            rtcLog(socketId, "RTCPeerConnection closed", {
                reason,
                peer: peerSnapshot(peerConnection)
            });
        } catch (error) {
            rtcLog(socketId, "RTCPeerConnection close failed", {
                reason,
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        }
    }

    delete peerConnections[socketId];
    rtcLog(socketId, "delete peerConnections[id]", { reason });

    delete makingOffer[socketId];
    delete pendingCandidates[socketId];

    if (removeRemote) {
        delete remoteStreams[socketId];
    }

    if (removeInfo) {
        delete peerInfo[socketId];
    }
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

    closePeerConnection(socketId, "cleanupPeer", { removeInfo: false, removeRemote: false });

    clearVideoIfStream(localVideo, stream);
    clearVideoIfStream(remoteVideo, stream);

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

    delete remoteStreams[socketId];
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

if (reloadSpectatorVideosBtn) {
    reloadSpectatorVideosBtn.addEventListener("click", () => {
        refreshSpectatorVideoPeers("button").catch(error => {
            spectatorLog("reload spectator videos failed", {
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
    });
}

window.shutdownRoomConnection = function() {
    const shutdownRoomId = currentRoomId;

    socketLog("cleanupRoom started", {
        roomId: shutdownRoomId,
        peerCount: Object.keys(peerConnections).length,
        peers: Object.keys(peerConnections),
        reason: "shutdownRoomConnection"
    }, "warn");

    allowRoomReconnect = false;
    lastJoinPayload = null;
    currentRoomId = null;
    currentRole = null;
    myPlayerNumberRTC = null;

    Object.keys(peerConnections).forEach(socketId => {
        rtcLog(socketId, "cleanupRoom closing peer", {
            reason: "shutdownRoomConnection"
        }, "warn");
        cleanupPeer(socketId);
    });

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
    mainLocalStream = null;
    cameraOnlyStream = null;
    spectatorAudioStream = null;

    releaseCameraWakeLock();

    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    socketLog("cleanupRoom finished", {
        roomId: shutdownRoomId,
        peerCount: Object.keys(peerConnections).length
    }, "warn");
};

function rtcLog(targetId, message, details = {}, level = "log") {
    if (!RTC_DEBUG) return;

    const logger = typeof console[level] === "function" ? console[level] : console.log;

    logger.call(console, `[WEBRTC${targetId ? `:${targetId}` : ""}] ${message}`, {
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
        connectionState: peer.connectionState,
        senders: peer.getSenders?.().map(sender => ({
            kind: sender.track?.kind || null,
            trackId: sender.track?.id || null,
            label: sender.track?.label || "",
            readyState: sender.track?.readyState || null
        })) || []
    };
}

function peerDiagnostics(peer) {
    const senders = peer?.getSenders?.() || [];
    return {
        connectionState: peer?.connectionState || null,
        iceConnectionState: peer?.iceConnectionState || null,
        signalingState: peer?.signalingState || null,
        audioSenders: senders.filter(sender => sender.track?.kind === "audio").length,
        videoSenders: senders.filter(sender => sender.track?.kind === "video").length,
        senderTracks: senders.map(sender => ({
            kind: sender.track?.kind || null,
            id: sender.track?.id || null,
            label: sender.track?.label || "",
            readyState: sender.track?.readyState || null,
            enabled: sender.track?.enabled ?? null
        }))
    };
}

function logPcStateDebug(targetId, peer, reason = "state") {
    const info = peerInfo[targetId] || {};
    console.log("[PC STATE DEBUG]", {
        targetId,
        reason,
        role: info.role || "unknown",
        connectionState: peer?.connectionState || null,
        iceConnectionState: peer?.iceConnectionState || null,
        signalingState: peer?.signalingState || null,
        senders: peer?.getSenders?.().map(sender => ({
            kind: sender.track?.kind,
            id: sender.track?.id,
            label: sender.track?.label,
            enabled: sender.track?.enabled,
            readyState: sender.track?.readyState
        })) || [],
        receivers: peer?.getReceivers?.().map(receiver => ({
            kind: receiver.track?.kind,
            id: receiver.track?.id,
            label: receiver.track?.label,
            enabled: receiver.track?.enabled,
            readyState: receiver.track?.readyState
        })) || []
    });
}

function isPeerClosed(peer) {
    return (
        !peer ||
        peer.__resenhaClosing ||
        peer.signalingState === "closed" ||
        peer.connectionState === "closed" ||
        peer.iceConnectionState === "closed"
    );
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
        sdpMid: candidate?.sdpMid || "",
        sdpMLineIndex: candidate?.sdpMLineIndex ?? null,
        usernameFragment: candidate?.usernameFragment || "",
        type: candidate?.type || raw.match(/ typ (\w+)/)?.[1] || "unknown",
        protocol: candidate?.protocol || raw.match(/ (udp|tcp) /i)?.[1] || "unknown",
        address: candidate?.address || candidate?.ip || raw.match(/candidate:\S+ \d+ \S+ \d+ ([^\s]+)/)?.[1] || "",
        port: candidate?.port || raw.match(/candidate:\S+ \d+ \S+ \d+ [^\s]+ (\d+)/)?.[1] || ""
    };
}

async function addIceCandidateSafely(sender, candidate, reason = "live") {
    const peer = peerConnections[sender];

    if (!peer) {
        rtcLog(sender, "ICE candidate ignored because peer does not exist", {
            reason,
            ...summarizeCandidate(candidate)
        }, "warn");
        return false;
    }

    if (isPeerClosed(peer)) {
        rtcLog(sender, "ICE candidate ignored because peer is closed", {
            reason,
            peer: peerSnapshot(peer),
            ...summarizeCandidate(candidate)
        }, "warn");
        return false;
    }

    if (!peer.remoteDescription) {
        pendingCandidates[sender] = pendingCandidates[sender] || [];
        pendingCandidates[sender].push(candidate);
        rtcLog(sender, "ICE candidate queued until remoteDescription", {
            reason,
            queued: pendingCandidates[sender].length,
            peer: peerSnapshot(peer),
            ...summarizeCandidate(candidate)
        });
        return false;
    }

    try {
        rtcLog(sender, "adding ICE candidate", {
            reason,
            peer: peerSnapshot(peer),
            ...summarizeCandidate(candidate)
        });
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
        return true;
    } catch (error) {
        const errorMessage = String(error?.message || "");
        const isStaleCandidate =
            error?.name === "InvalidStateError" ||
            /unknown ufrag/i.test(errorMessage) ||
            /ufrag/i.test(errorMessage);

        rtcLog(sender, isStaleCandidate ? "stale ICE candidate ignored" : "ICE candidate failed", {
            reason,
            peer: peerSnapshot(peer),
            ...summarizeCandidate(candidate),
            errorName: error?.name,
            errorMessage: error?.message
        }, isStaleCandidate ? "warn" : "error");

        if (!isStaleCandidate) {
            console.error("Erro ICE:", error);
        }

        return false;
    }
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

    if (isPeerClosed(peer)) {
        rtcLog(targetId, "offer aborted because peer is closed", {
            peer: peerSnapshot(peer)
        }, "warn");
        return;
    }

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

    if (!peer) {
        delete pendingCandidates[sender];
        rtcLog(sender, "pending ICE candidates discarded because peer does not exist", {}, "warn");
        return;
    }

    if (isPeerClosed(peer)) {
        delete pendingCandidates[sender];
        rtcLog(sender, "pending ICE candidates discarded because peer is closed", {
            peer: peerSnapshot(peer)
        }, "warn");
        return;
    }

    if (!pendingCandidates[sender]) return;
    if (!peer.remoteDescription) {
        rtcLog(sender, "pending ICE flush skipped until remoteDescription", {
            queued: pendingCandidates[sender].length,
            peer: peerSnapshot(peer)
        });
        return;
    }

    for (const candidate of pendingCandidates[sender]) {
        await addIceCandidateSafely(sender, candidate, "flush-pending");
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

    const roleHasLocalMedia = data.role === "camera"
        ? !!cameraOnlyStream
        : !!getActiveLocalStream();

    if ((data.role === "player" || data.role === "camera") && !roleHasLocalMedia) {
        try {
            await startWebcam();
        } catch (error) {
            console.warn("Falha ao iniciar mídia ao assumir papel:", error);
        }
    }

    if (data.role === "spectator") {
        window.enableSpectatorMicrophone?.().catch(error => {
            audioLog("[RTC_DEBUG][AUDIO][SPECTATOR] default microphone start failed", {
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");

            if (currentRoomId) {
                socket.emit("update-mic-status", {
                    roomId: currentRoomId,
                    micEnabled: false
                });
            }
        });
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

    if (socket.recovered) {
        socketLog("socket recovered; keeping active peerConnections", {
            peers: Object.keys(peerConnections)
        });
    } else {
        socketLog("socket reconnect requires room cleanup before rejoin", {
            peers: Object.keys(peerConnections)
        }, "warn");
        Object.keys(peerConnections).forEach(socketId => {
            rtcLog(socketId, "cleanupRoom closing peer during socket reconnect", {
                reason: "socket-connect-not-recovered"
            }, "warn");
            cleanupPeer(socketId);
        });
    }

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

        if (currentRole === "camera" && peerData.role === "camera") {
            cameraLog("skipping camera to camera peer offer", {
                target: peerData.socketId
            });
            continue;
        }

        if (currentRole === "spectator" && ["player", "camera"].includes(peerData.role)) {
            await ensurePlayerVideoSentToPeer(peerData.socketId, "spectator-existing-peer");
        } else {
            await createOffer(peerData.socketId, peerData);
        }
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

    if (
        (currentRole === "spectator" && ["player", "camera"].includes(data.role)) ||
        (["player", "camera"].includes(currentRole) && data.role === "spectator")
    ) {
        spectatorLog("creating offer for spectator audio path", {
            target: data.socketId,
            remoteRole: data.role
        });
        ensurePlayerVideoSentToPeer(data.socketId, "user-connected-spectator-video").catch(error => {
            rtcLog(data.socketId, "ensure spectator video failed", {
                errorName: error?.name,
                errorMessage: error?.message
            }, "warn");
        });
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

    if (!answer || !sender) return;

    if (!peer) {
        rtcLog(sender, "answer ignored because peer does not exist", {}, "warn");
        return;
    }

    if (isPeerClosed(peer)) {
        rtcLog(sender, "answer ignored because peer is closed", {
            peer: peerSnapshot(peer)
        }, "warn");
        return;
    }

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

    await addIceCandidateSafely(sender, candidate, "socket-ice-candidate");
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
    if (isCameraOnlyClient()) {
        audioLog("[RTC_DEBUG][AUDIO] camera-only mode: no audio sender added", {
            reason: "toggle-microphone-blocked"
        });
        return;
    }

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

    const existingAudioTrack = localStream?.getAudioTracks?.()[0];
    if (existingAudioTrack && existingAudioTrack.readyState === "live") {
        micEnabled = true;
        existingAudioTrack.enabled = true;
        setActiveLocalStream(localStream, "spectator");
        audioLog("[RTC_DEBUG][AUDIO][SPECTATOR] reusing existing spectator audio track", {
            trackId: existingAudioTrack.id,
            peerCount: Object.keys(peerConnections).length
        });
        audioLog("[RTC_DEBUG][AUDIO] spectator audio track ready", {
            trackId: existingAudioTrack.id,
            enabled: existingAudioTrack.enabled,
            readyState: existingAudioTrack.readyState,
            reused: true
        });
        audioLog("[RTC_DEBUG][AUDIO] spectator audio enabled", {
            trackId: existingAudioTrack.id,
            enabled: existingAudioTrack.enabled,
            readyState: existingAudioTrack.readyState,
            reused: true
        });
        audioLog("[RTC_DEBUG][AUDIO] spectator microphone active", {
            trackId: existingAudioTrack.id,
            enabled: existingAudioTrack.enabled,
            readyState: existingAudioTrack.readyState,
            reused: true
        });

        syncLocalAudioTrackToPeers("spectator-mic-reenable");

        updateMediaStatus();

        if (currentRoomId) {
            socket.emit("update-mic-status", {
                roomId: currentRoomId,
                micEnabled: true
            });
        }

        return;
    }

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
    audioLog("[RTC_DEBUG][AUDIO] spectator audio track ready", {
        trackId: audioTrack.id,
        enabled: audioTrack.enabled,
        readyState: audioTrack.readyState,
        deviceId: trackSettings.deviceId || "default"
    });
    audioLog("[RTC_DEBUG][AUDIO] spectator audio enabled", {
        trackId: audioTrack.id,
        enabled: audioTrack.enabled,
        readyState: audioTrack.readyState,
        deviceId: trackSettings.deviceId || "default"
    });
    audioLog("[RTC_DEBUG][AUDIO] spectator microphone active", {
        trackId: audioTrack.id,
        enabled: audioTrack.enabled,
        readyState: audioTrack.readyState,
        deviceId: trackSettings.deviceId || "default"
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
    setActiveLocalStream(localStream, "spectator");
    audioLog("[SPECTATOR] audio track added", {
        peerCount: Object.keys(peerConnections).length,
        trackId: audioTrack.id
    });

    syncLocalAudioTrackToPeers("spectator-mic-enable");

    updateMediaStatus();

    if (currentRoomId) {
        socket.emit("update-mic-status", {
            roomId: currentRoomId,
            micEnabled: true
        });
    }

};

window.disableSpectatorMicrophone = async function() {
    if (currentRole !== "spectator") return;

    micEnabled = false;

    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = false;
            audioLog("[RTC_DEBUG][AUDIO][SPECTATOR] local audio track muted", {
                trackId: track.id,
                readyState: track.readyState
            });
        });
    }

    updateMediaStatus();

    if (currentRoomId) {
        socket.emit("update-mic-status", {
            roomId: currentRoomId,
            micEnabled: false
        });
    }
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
