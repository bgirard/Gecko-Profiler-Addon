// Enable platform-specific styles.
self.port.on("platform", function (platform) {
  document.documentElement.classList.add("platform_" + platform);
});

self.port.on("displayText", function (text) {
  document.getElementById("status").textContent = text;
});

self.port.emit("ready");
