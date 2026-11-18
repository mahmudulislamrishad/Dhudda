
function loginUser() {
  const name = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!name || !email || password.length < 6) {
    alert("Name, email এবং কমপক্ষে ৬ অক্ষরের password দাও।");
    return;
  }

  document.getElementById("displayName").textContent = name;
  document.getElementById("login").classList.add("hidden");
  document.getElementById("home").classList.remove("hidden");
}

function startCall(type) {
  document.getElementById("callBox").classList.remove("hidden");
  document.getElementById("callTitle").textContent = type;
  document.getElementById("status").textContent =
    "Demo mode: real calling service is not connected yet.";
}

function toggleMute() {
  alert("Real call service যুক্ত হলে Mute কাজ করবে।");
}

function toggleCamera() {
  alert("Real call service যুক্ত হলে Camera control কাজ করবে।");
}

function endCall() {
  document.getElementById("callBox").classList.add("hidden");
}

function logout() {
  document.getElementById("home").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
}
