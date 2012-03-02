var EXPORTED_SYMBOLS = ["symbolicate"];

var Cc = Components.classes;
var Ci = Components.interfaces;

var sWorker = null;
function getWorker() {
  if (!sWorker) {
    sWorker = new ChromeWorker("SymbolicateWorker.js");
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var abi = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI;
    sWorker.postMessage({ platform: hh["platform"], abi: abi });
  }
  return sWorker;
}

var sProfileID = 0;
function symbolicate(profile, progressCallback, finishCallback) {
  var worker = getWorker();

  var id = sProfileID++;
  worker.addEventListener("message", function workerSentMessage(msg) {
    if (msg.data.id == id) {
      switch (msg.data.type) {
        case "progress":
          progressCallback(Math.floor(msg.data.progress * 100) + "% " + msg.data.action);
          break;
        case "finished":
          worker.removeEventListener("message", workerSentMessage);
          finishCallback(msg.data.profile);
          break;
      }
    }
  });
  worker.postMessage({ id: id, profile: profile });
}
