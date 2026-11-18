
import {
  Room,
  RoomEvent,
  Track,
  TokenSource
} from "https://cdn.jsdelivr.net/npm/livekit-client/+esm";

const TOKEN_SERVER_ID = "dhudda-2ayw9x";

let room;
let currentMode = "audio";

const tokenSource =
  TokenSource.developmentTokenServer(TOKEN_SERVER_ID);

const $ = id => document.getElementById(id);

async function loginUser() {
  const name = $("username").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!name || !email || password.length < 6) {
    alert("Name, email and 6 character password required.");
    return;
  }

  $("displayName").textContent = name;
  $("login").classList.add("hidden");
  $("home").classList.remove("hidden");
}

async function startCall(type) {
  try {
    currentMode = type;

    const name = $("username").value.trim();
    const roomName = prompt(
      "Room name দাও। একই নাম দিলে একই কলে যোগ হবে:"
    );

    if (!roomName) return;

    $("callTitle").textContent =
      type === "group" ? "Group Call" :
      type === "video" ? "Video Call" : "Audio Call";

    $("callBox").classList.remove("hidden");
    $("status").textContent = "Connecting...";

    const credentials = await tokenSource.fetch({
      roomName: roomName
    });

    room = new Room();

    
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  const element = track.attach();

  if (track.kind === Track.Kind.Audio) {
    element.autoplay = true;
    element.controls = false;
    element.style.display = "none";
    document.body.appendChild(element);
  }

  if (track.kind === Track.Kind.Video) {
    element.autoplay = true;
    element.playsInline = true;
    element.style.width = "100%";
    element.style.maxWidth = "300px";
    $("videos").appendChild(element);
  }
});


    room.on(RoomEvent.ParticipantDisconnected, () => {
      console.log("Participant left");
    });

    await room.connect(
      credentials.serverUrl,
      credentials.participantToken
    );

    await room.localParticipant.setMicrophoneEnabled(true);

    if (type !== "audio") {
      await room.localParticipant.setCameraEnabled(true);
    }

    $("status").textContent = "Connected: " + roomName;

  } catch (error) {
    console.error(error);
    $("status").textContent =
      "Call failed: " + error.message;
    alert("Call connection failed. Check internet and permissions.");
  }
}

async function toggleMute() {
  if (!room) return;

  const enabled =
    room.localParticipant.isMicrophoneEnabled;

  await room.localParticipant.setMicrophoneEnabled(!enabled);
}

async function toggleCamera() {
  if (!room) return;

  const enabled =
    room.localParticipant.isCameraEnabled;

  await room.localParticipant.setCameraEnabled(!enabled);
}

async function endCall() {
  if (room) {
    await room.disconnect();
    room = null;
  }

  $("videos").innerHTML = "";
  $("callBox").classList.add("hidden");
}

function logout() {
  endCall();
  $("home").classList.add("hidden");
  $("login").classList.remove("hidden");
}

async function enableSpeaker() {
  if (!room) return;

  try {
    await room.startAudio();
    $("status").textContent = "Speaker enabled!";
  } catch (error) {
    alert(error.message);
  }
}

window.enableSpeaker = enableSpeaker;

window.loginUser = loginUser;
window.startCall = startCall;
window.toggleMute = toggleMute;
window.toggleCamera = toggleCamera;
window.endCall = endCall;
window.logout = logout;
