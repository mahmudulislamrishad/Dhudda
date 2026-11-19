
// ==========================================
// DHUDDA HUB - PART 1: ACCOUNT & CHAT
// ==========================================

import {
  Room,
  RoomEvent,
  Track
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/+esm";

const API_BASE_URL = "https://dhudda-hub-api.fake-jonathan-james.workers.dev";

const AUTH_KEY = "dhudda_auth";
const DEVICE_KEY = "dhudda_device";
const PRIV_KEY = "dhudda_e2ee_private";

let account = null;
let selectedFriend = null;
let socket = null;
let conversationKey = null;

// ==========================================
// API
// ==========================================

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = localStorage.getItem(AUTH_KEY);
  if (token) headers.Authorization = "Bearer " + token;

  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {
    id = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }

  return id;
}

// ==========================================
// ENCRYPTION
// ==========================================

function toB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) {
    s += String.fromCharCode(b);
  }
  return btoa(s);
}

function fromB64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function createIdentityKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const publicJwk = await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey
  );

  const privateJwk = await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey
  );

  localStorage.setItem(PRIV_KEY, JSON.stringify(privateJwk));

  return JSON.stringify(publicJwk);
}

async function deriveConversationKey(publicText) {
  const privateText = localStorage.getItem(PRIV_KEY);

  if (!privateText) {
    throw new Error("এই ডিভাইসের encryption key পাওয়া যায়নি।");
  }

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(privateText),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(publicText),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    conversationKey,
    new TextEncoder().encode(text)
  );

  return JSON.stringify({
    iv: toB64(iv),
    cipher: toB64(ciphertext)
  });
}

async function decryptText(value) {
  const p = JSON.parse(value);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(p.iv) },
    conversationKey,
    fromB64(p.cipher)
  );

  return new TextDecoder().decode(plaintext);
}

// ==========================================
// ACCOUNT FORMS
// ==========================================

function showRegisterForm() {
  document.getElementById("accountLoginPanel")
    .classList.add("hidden");

  document.getElementById("activatePanel")
    .classList.remove("hidden");
}

function showLoginForm() {
  document.getElementById("activatePanel")
    .classList.add("hidden");

  document.getElementById("accountLoginPanel")
    .classList.remove("hidden");
}

// ==========================================
// REGISTER
// ==========================================

async function activateAccount() {
  const error = document.getElementById("activateError");
  error.textContent = "";

  try {
    if (!window.crypto?.subtle) {
      throw new Error("HTTPS browser প্রয়োজন।");
    }

    const key = document.getElementById("activationKey").value.trim();
    const username = document.getElementById("newUsername").value.trim().toLowerCase();
    const displayName = document.getElementById("displayName").value.trim();
    const password = document.getElementById("registerPassword").value;

    if (!key || !username || !displayName || !password) {
      throw new Error("সব ঘর পূরণ করো।");
    }

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      throw new Error("Username ৩-২০ অক্ষরের হতে হবে।");
    }

    if (displayName.length > 40) {
      throw new Error("Display Name সর্বোচ্চ ৪০ অক্ষর হতে পারবে।");
    }

    if (password.length < 8 || password.length > 128) {
      throw new Error("Password ৮-১২৮ অক্ষরের হতে হবে।");
    }

    const publicKey = await createIdentityKey();

    const result = await api("/api/activate", {
      method: "POST",
      body: JSON.stringify({
        key,
        username,
        displayName,
        password,
        deviceId: getDeviceId(),
        publicKey
      })
    });

    localStorage.setItem(AUTH_KEY, result.token);
    account = result.user;

    await showHub();

  } catch (e) {
    error.textContent = e.message;
  }
}

// ==========================================
// LOGIN
// ==========================================

async function loginAccount() {
  const error = document.getElementById("loginFormError");
  error.textContent = "";

  try {
    const username = document.getElementById("loginUsername").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
      throw new Error("Username এবং Password দাও।");
    }

    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        deviceId: getDeviceId()
      })
    });

    localStorage.setItem(AUTH_KEY, result.token);
    account = result.user;

    await showHub();

  } catch (e) {
    error.textContent = e.message;
  }
}

// ==========================================
// SHOW HUB
// ==========================================

async function showHub() {
  if (!account) {
    const result = await api("/api/me");
    account = result.user;
  }

  document.getElementById("activatePanel").classList.add("hidden");
  document.getElementById("accountLoginPanel").classList.add("hidden");
  document.getElementById("hubPanel").classList.remove("hidden");

  document.getElementById("myDisplay").textContent = account.display_name;
  document.getElementById("myUsername").textContent = "@" + account.username;

  document.getElementById("myVerified")
    .classList.toggle("hidden", !account.is_verified);

  document.getElementById("username").value = account.display_name;

  await refreshPeople();
}

// ==========================================
// LOGOUT
// ==========================================

async function logoutAccount() {
  if (socket) socket.close();

  socket = null;
  account = null;
  selectedFriend = null;
  conversationKey = null;

  localStorage.removeItem(AUTH_KEY);

  document.getElementById("hubPanel").classList.add("hidden");
  showLoginForm();
}

// ==========================================
// CHAT UI
// ==========================================

function appendMessage(label, text) {
  const p = document.createElement("p");
  p.className = "chat-bubble";
  p.textContent = label + ": " + text;

  const box = document.getElementById("chatMessages");
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function makePerson(name, buttonText, handler) {
  const row = document.createElement("div");
  row.className = "person";

  const label = document.createElement("span");
  label.textContent = name;
  row.appendChild(label);

  if (buttonText) {
    const btn = document.createElement("button");
    btn.className = "secondary-action";
    btn.textContent = buttonText;
    btn.onclick = handler;
    row.appendChild(btn);
  }

  return row;
}

// ==========================================
// SEARCH USERS
// ==========================================

async function searchUsers() {
  try {
    const q = encodeURIComponent(
      document.getElementById("userSearch").value.trim()
    );

    const result = await api("/api/users?q=" + q);
    const box = document.getElementById("searchResults");
    box.replaceChildren();

    for (const u of result.users) {
      const row = makePerson(
        `${u.display_name} @${u.username}${u.is_verified ? " ✓" : ""}`,
        "Add",
        async () => {
          try {
            await api("/api/friend-request", {
              method: "POST",
              body: JSON.stringify({ userId: u.id })
            });

            row.lastChild.textContent = "Sent";
            row.lastChild.disabled = true;

          } catch (e) {
            alert(e.message);
          }
        }
      );

      box.appendChild(row);
    }

  } catch (e) {
    alert(e.message);
  }
}

// ==========================================
// FRIENDS & REQUESTS
// ==========================================

async function refreshPeople() {
  try {
    const [friends, requests] = await Promise.all([
      api("/api/friends"),
      api("/api/requests")
    ]);

    const fb = document.getElementById("friendList");
    const rb = document.getElementById("friendRequests");

    fb.replaceChildren();
    rb.replaceChildren();

    for (const u of friends.friends) {
      const row = makePerson(
        `${u.display_name} @${u.username}${u.is_verified ? " ✓" : ""}`,
        "Open",
        () => openChat(u)
      );

      fb.appendChild(row);
    }

    for (const u of requests.requests) {
      const row = makePerson(
        "@" + u.username,
        "Accept",
        async () => {
          await api("/api/friend-accept", {
            method: "POST",
            body: JSON.stringify({ requestId: u.id })
          });

          await refreshPeople();
        }
      );

      rb.appendChild(row);
    }

  } catch (e) {
    console.error("Friend refresh error:", e);
  }
}

// ==========================================
// OPEN PRIVATE CHAT
// ==========================================

async function openChat(friend) {
  try {
    if (socket) socket.close();

    selectedFriend = friend;
    conversationKey = await deriveConversationKey(friend.public_key);

    document.getElementById("chatTitle").textContent =
      friend.display_name + (friend.is_verified ? " ✓" : "");

    document.getElementById("chatMessages").replaceChildren();
    document.getElementById("chatState").textContent = "Connecting…";

    const ticket = await api("/api/chat-ticket", {
      method: "POST",
      body: JSON.stringify({ userId: friend.id })
    });

    const wsUrl =
      API_BASE_URL.replace(/^http/, "ws") +
      "/api/chat?ticket=" +
      encodeURIComponent(ticket.ticket);

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      document.getElementById("chatState").textContent =
        "Encrypted chat connected";
    };

    socket.onmessage = async event => {
      try {
        const packet = JSON.parse(event.data);

        if (packet.type === "ciphertext") {
          const message = await decryptText(packet.data);
          appendMessage(friend.display_name, message);
        }

      } catch (e) {
        console.error("Message decrypt error:", e);
      }
    };

    socket.onerror = () => {
      document.getElementById("chatState").textContent = "Connection error";
    };

    socket.onclose = () => {
      document.getElementById("chatState").textContent = "Disconnected";
    };

  } catch (e) {
    alert(e.message);
  }
}

// ==========================================
// SEND CHAT MESSAGE
// ==========================================

function setupChatForm() {
  const form = document.getElementById("chatForm");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const input = document.getElementById("chatInput");
    const value = input.value.trim();

    if (!value) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert("Chat connection নেই। আবার Chat open করো।");
      return;
    }

    if (!conversationKey) {
      alert("Encryption key পাওয়া যায়নি।");
      return;
    }

    try {
      const data = await encryptText(value);

      socket.send(JSON.stringify({
        type: "ciphertext",
        data
      }));

      appendMessage("You", value);
      input.value = "";

    } catch (e) {
      alert("Message error: " + e.message);
    }
  });
}

// ==========================================
// AUTO LOGIN
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
  setupChatForm();

  if (localStorage.getItem(AUTH_KEY)) {
    try {
      await showHub();

    } catch (e) {
      console.error("Auto login failed:", e);
      localStorage.removeItem(AUTH_KEY);
      showLoginForm();
    }

  } else {
    showRegisterForm();
  }
});

// ==========================================
// GLOBAL ACCOUNT FUNCTIONS
// ==========================================

window.activateAccount = activateAccount;
window.loginAccount = loginAccount;
window.logoutAccount = logoutAccount;
window.searchUsers = searchUsers;
window.showLoginForm = showLoginForm;
window.showRegisterForm = showRegisterForm;



// ==========================================
// DHUDDA HUB - PART 2: LIVEKIT CALL SYSTEM
// ==========================================

let room = null;
let facingMode = "user";
let currentMode = "audio";

const $ = id => document.getElementById(id);

function showError(message) {
  $("loginError").textContent = message;
}

function updateParticipantCount() {
  if (!room) return;

  $("participantCount").textContent =
    room.remoteParticipants.size + 1;
}

// ==========================================
// VIDEO TILE
// ==========================================

function createVideoTile(identity, name) {
  const id = "tile-" +
    identity.replace(/[^a-zA-Z0-9_-]/g, "_");

  let tile = $(id);
  if (tile) return tile;

  tile = document.createElement("div");
  tile.id = id;
  tile.className = "video-tile";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = false;

  const label = document.createElement("span");
  label.className = "tile-name";
  label.textContent = name || "Participant";

  tile.append(video, label);
  $("videoGrid").appendChild(tile);

  return tile;
}

function attachRemoteTrack(track, participant) {
  if (track.kind === Track.Kind.Audio) {
    const audio = track.attach();
    audio.autoplay = true;
    audio.volume = 1;
    audio.dataset.participant = participant.identity;
    document.body.appendChild(audio);
    return;
  }

  if (track.kind === Track.Kind.Video) {
    const tile = createVideoTile(
      participant.identity,
      participant.name || participant.identity
    );

    track.attach(tile.querySelector("video"));
  }
}

function removeRemoteTrack(track) {
  track.detach().forEach(element => element.remove());
}

function attachExistingTracks() {
  room.remoteParticipants.forEach(participant => {
    participant.trackPublications.forEach(publication => {
      if (publication.isSubscribed && publication.track) {
        attachRemoteTrack(publication.track, participant);
      }
    });
  });
}

function attachLocalPreview() {
  const publication =
    room.localParticipant.getTrackPublication(Track.Source.Camera);

  if (publication?.videoTrack) {
    const video = $("localVideo");

    publication.videoTrack.attach(video);
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;

    video.classList.toggle(
      "mirrored-preview",
      facingMode === "user"
    );
  }
}

// ==========================================
// START AUDIO / VIDEO / GROUP CALL
// ==========================================

async function startCall(mode) {
  const name = $("username").value.trim();
  const roomName = $("roomName").value.trim();

  if (!name || !roomName) {
    showError("Your name and room name are required.");
    return;
  }

  if (!/^[a-zA-Z0-9_-]{2,50}$/.test(roomName)) {
    showError("Room name must contain 2-50 letters or numbers.");
    return;
  }

  currentMode = mode;
  showError("");

  $("login").classList.add("hidden");
  $("callScreen").classList.remove("hidden");

  $("activeRoom").textContent = roomName;
  $("callStatus").textContent = "Connecting...";
  $("videoGrid").innerHTML = "";

  const localTile = document.createElement("div");
  localTile.id = "localTile";
  localTile.className = "video-tile local-tile";

  const localVideo = document.createElement("video");
  localVideo.id = "localVideo";
  localVideo.autoplay = true;
  localVideo.muted = true;
  localVideo.playsInline = true;
  localVideo.classList.add("mirrored-preview");

  const localName = document.createElement("span");
  localName.className = "tile-name";
  localName.textContent = name + " (You)";

  localTile.append(localVideo, localName);
  $("videoGrid").appendChild(localTile);

  try {
    const response = await fetch(
      API_BASE_URL + "/api/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          roomName,
          participantName: name
        })
      }
    );

    const credentials = await response.json();

    if (!response.ok) {
      throw new Error(
        credentials.error || "Call token পাওয়া যায়নি।"
      );
    }

    room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    room
      .on(
        RoomEvent.TrackSubscribed,
        (track, publication, participant) => {
          attachRemoteTrack(track, participant);
        }
      )
      .on(RoomEvent.TrackUnsubscribed, track => {
        removeRemoteTrack(track);
      })
      .on(RoomEvent.ParticipantConnected, () => {
        updateParticipantCount();
      })
      .on(RoomEvent.ParticipantDisconnected, participant => {
        const tileId = "tile-" +
          participant.identity.replace(/[^a-zA-Z0-9_-]/g, "_");

        $(tileId)?.remove();

        document.querySelectorAll("audio").forEach(audio => {
          if (audio.dataset.participant === participant.identity) {
            audio.remove();
          }
        });

        updateParticipantCount();
      })
      .on(RoomEvent.Disconnected, () => {
        $("callStatus").textContent = "Call disconnected";
      });

    await room.connect(
      credentials.serverUrl,
      credentials.token
    );

    await room.localParticipant.setMicrophoneEnabled(true);

    if (mode === "video" || mode === "group") {
      await room.localParticipant.setCameraEnabled(true, {
        facingMode: "user"
      });

      attachLocalPreview();
    }

    attachExistingTracks();
    updateParticipantCount();

    $("callStatus").textContent = "Connected";

  } catch (error) {
    console.error("LiveKit error:", error);

    $("callStatus").textContent = "Connection failed";
    alert("Call failed: " + error.message);

    if (room) {
      await room.disconnect();
      room = null;
    }

    $("callScreen").classList.add("hidden");
    $("login").classList.remove("hidden");
  }
}

// ==========================================
// MICROPHONE
// ==========================================

async function toggleMute() {
  if (!room) return;

  try {
    const enabled =
      room.localParticipant.isMicrophoneEnabled;

    await room.localParticipant.setMicrophoneEnabled(!enabled);

    $("micButton").querySelector("small").textContent =
      enabled ? "Unmute" : "Mute";

    $("micButton").classList.toggle(
      "disabled-control",
      enabled
    );

  } catch (error) {
    alert("Microphone error: " + error.message);
  }
}

// ==========================================
// CAMERA ON / OFF
// ==========================================

async function toggleCamera() {
  if (!room) return;

  try {
    const enabled =
      room.localParticipant.isCameraEnabled;

    if (!enabled) {
      await room.localParticipant.setCameraEnabled(true, {
        facingMode
      });

      attachLocalPreview();

    } else {
      await room.localParticipant.setCameraEnabled(false);
      $("localVideo").srcObject = null;
    }

    $("cameraButton").querySelector("small").textContent =
      enabled ? "Camera On" : "Camera Off";

    $("cameraButton").classList.toggle(
      "disabled-control",
      enabled
    );

  } catch (error) {
    alert("Camera error: " + error.message);
  }
}

// ==========================================
// SWITCH FRONT / BACK CAMERA
// ==========================================

async function switchCamera() {
  if (!room || !room.localParticipant.isCameraEnabled) {
    alert("আগে Camera চালু করো।");
    return;
  }

  try {
    const publication =
      room.localParticipant.getTrackPublication(Track.Source.Camera);

    const videoTrack = publication?.videoTrack;

    if (!videoTrack) {
      throw new Error("Camera track পাওয়া যায়নি।");
    }

    facingMode =
      facingMode === "user" ? "environment" : "user";

    await videoTrack.restartTrack({
      facingMode
    });

    attachLocalPreview();

  } catch (error) {
    alert("Camera switch failed: " + error.message);
  }
}

// ==========================================
// SPEAKER
// ==========================================

async function enableSpeaker() {
  if (!room) return;

  try {
    await room.startAudio();
    $("callStatus").textContent = "Speaker enabled";

  } catch (error) {
    alert("Speaker error: " + error.message);
  }
}

// ==========================================
// MINIMIZE / PICTURE IN PICTURE
// ==========================================

async function minimizeCall() {
  const video = $("localVideo");

  if (!video || !video.srcObject) {
    alert("Video চালু থাকলে Minimize ব্যবহার করতে পারবে।");
    return;
  }

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();

    } else if (
      document.pictureInPictureEnabled &&
      video.requestPictureInPicture
    ) {
      await video.requestPictureInPicture();

    } else {
      alert("এই browser-এ Picture-in-Picture support নেই।");
    }

  } catch (error) {
    alert("Minimize করা যায়নি: " + error.message);
  }
}

// ==========================================
// END CALL
// ==========================================

async function endCall() {
  if (room) {
    await room.disconnect();
    room = null;
  }

  document.querySelectorAll("audio").forEach(audio => {
    audio.remove();
  });

  $("videoGrid").innerHTML = "";

  $("callScreen").classList.add("hidden");
  $("login").classList.remove("hidden");

  $("callStatus").textContent = "Call ended";
  $("participantCount").textContent = "1";

  facingMode = "user";
}

// ==========================================
// SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(console.error);
  });
}

// ==========================================
// GLOBAL CALL FUNCTIONS
// ==========================================

window.startCall = startCall;
window.toggleMute = toggleMute;
window.toggleCamera = toggleCamera;
window.switchCamera = switchCamera;
window.enableSpeaker = enableSpeaker;
window.endCall = endCall;
window.minimizeCall = minimizeCall;

        
