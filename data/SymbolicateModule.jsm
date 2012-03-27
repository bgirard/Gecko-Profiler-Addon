var EXPORTED_SYMBOLS = ["symbolicate"];

var Cc = Components.classes;
var Ci = Components.interfaces;

const DEFAULT_SYMBOLICATION_URL = "http://127.0.0.1:8000";

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
function symbolicate(profile, sharedLibraries, progressCallback, finishCallback) {
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
          finishCallback(msg.data.symbolicationTable);
          break;
      }
    }
  });

  var uri = "";
  try {
      var prefs = Cc["@mozilla.org/preferences-service;1"]
                  .getService(Ci.nsIPrefService).getBranch("profiler.");
      uri = prefs.getCharPref("symbolicationUrl");
  } catch (e) {
      uri = DEFAULT_SYMBOLICATION_URL;
  }

  worker.postMessage({ id: id, profile: profile, sharedLibraries: sharedLibraries, uri: uri });
}
