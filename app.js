
import {
  Room,
  RoomEvent,
  Track,
  TokenSource
} from "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/+esm";

// LiveKit development token server ID
const TOKEN_SERVER_ID = "dhudda-2ayw9x";

const tokenSource =
  TokenSource.developmentTokenServer(TOKEN_SERVER_ID);

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

function createVideoTile(identity, name, isLocal = false) {
  const id = "tile-" + identity.replace(/[^a-zA-Z0-9_-]/g, "_");

  let tile = $(id);
  if (tile) return tile;

  tile = document.createElement("div");
  tile.id = id;
  tile.className = "video-tile";

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;

  const label = document.createElement("span");
  label.className = "tile-name";
  label.textContent = name || "Participant";

  tile.appendChild(video);
  tile.appendChild(label);

  if (isLocal) {
    tile.classList.add("local-tile");
    $("videoGrid").prepend(tile);
  } else {
    $("videoGrid").appendChild(tile);
  }

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

    const video = tile.querySelector("video");
    track.attach(video);
    video.autoplay = true;
    video.playsInline = true;
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
  }
}

async function startCall(mode) {
  const name = $("username").value.trim();
  const roomName = $("roomName").value.trim();

  if (!name || !roomName) {
    showError("Your name and room name are required.");
    return;
  }

  if (!/^[a-zA-Z0-9_-]{2,50}$/.test(roomName)) {
    showError("Room name: use 2-50 letters, numbers, - or _ only.");
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

  const localName = document.createElement("span");
  localName.className = "tile-name";
  localName.textContent = name + " (You)";

  localTile.append(localVideo, localName);
  $("videoGrid").appendChild(localTile);

  try {
    const credentials = await tokenSource.fetch({
      roomName: roomName
    });

    room = new Room({
      adaptiveStream: true,
      dynacast: true
    });

    room
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        attachRemoteTrack(track, participant);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        removeRemoteTrack(track);
      })
      .on(RoomEvent.ParticipantConnected, () => {
        updateParticipantCount();
      })
      .on(RoomEvent.ParticipantDisconnected, participant => {
        const tileId = "tile-" +
          participant.identity.replace(/[^a-zA-Z0-9_-]/g, "_");

        $(tileId)?.remove();

        document.querySelectorAll(
          `audio[data-participant="${participant.identity}"]`
        ).forEach(audio => audio.remove());

        updateParticipantCount();
      })
      .on(RoomEvent.ActiveSpeakersChanged, speakers => {
        $("callStatus").textContent =
          speakers.length ? "Someone is speaking" : "Call connected";
      })
      .on(RoomEvent.Disconnected, () => {
        $("callStatus").textContent = "Call disconnected";
      });

    await room.connect(
      credentials.serverUrl,
      credentials.participantToken
    );

    await room.localParticipant.setName(name);
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
    $("micButton").classList.remove("disabled-control");
    $("cameraButton").classList.remove("disabled-control");

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

async function toggleMute() {
  if (!room) return;

  try {
    const enabled = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!enabled);

    $("micButton").querySelector("small").textContent =
      enabled ? "Unmute" : "Mute";

    $("micButton").classList.toggle("disabled-control", enabled);
  } catch (error) {
    alert("Microphone error: " + error.message);
  }
}

async function toggleCamera() {
  if (!room) return;

  try {
    const enabled = room.localParticipant.isCameraEnabled;

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

    $("cameraButton").classList.toggle("disabled-control", enabled);

  } catch (error) {
    alert("Camera error: " + error.message);
  }
}

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
      alert("Camera track পাওয়া যায়নি।");
      return;
    }

    facingMode = facingMode === "user" ? "environment" : "user";

    await videoTrack.restartTrack({
      facingMode: facingMode
    });

    attachLocalPreview();

  } catch (error) {
    facingMode = facingMode === "user" ? "environment" : "user";
    alert("Camera switch failed: " + error.message);
  }
}

async function enableSpeaker() {
  if (!room) return;

  try {
    await room.startAudio();
    $("callStatus").textContent = "Speaker enabled";
  } catch (error) {
    alert("Speaker error: " + error.message);
  }
}

async function endCall() {
  if (room) {
    await room.disconnect();
    room = null;
  }

  document.querySelectorAll("audio").forEach(audio => audio.remove());

  $("videoGrid").innerHTML = "";
  $("callScreen").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("callStatus").textContent = "Call ended";
  $("participantCount").textContent = "1";

  facingMode = "user";
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(console.error);
  });
}

window.startCall = startCall;
window.toggleMute = toggleMute;
window.toggleCamera = toggleCamera;
window.switchCamera = switchCamera;
window.enableSpeaker = enableSpeaker;
window.endCall = endCall;
