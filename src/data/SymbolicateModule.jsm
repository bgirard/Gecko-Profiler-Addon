/* -*- Mode: js2; indent-tabs-mode: nil -*- */

var EXPORTED_SYMBOLS = ["symbolicate"];

var Cc = Components.classes;
var Ci = Components.interfaces;

// Change this in main as well where we default init the pref
const DEFAULT_SYMBOLICATION_URL = "http://symbolapi.mozilla.org/gecko-profiler/";

function getPref(prefName, defaultValue) {
  var value = defaultValue;
  try {
      var prefs = Cc["@mozilla.org/preferences-service;1"]
                  .getService(Ci.nsIPrefService).getBranch("profiler.");
      value = prefs.getCharPref(prefName);
  } catch (e) {
      value = defaultValue;
  }
  return value;
}

var sWorker = null;
function getWorker() {
  if (!sWorker) {
    sWorker = new ChromeWorker("SymbolicateWorker.js");
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var abi = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI;
    var appName = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).name;
    sWorker.postMessage({
        platform: hh["platform"],
        abi: abi,
        appName: appName,
        androidLibsPrefix: getPref("androidLibsHostPath", "/tmp"),
        fennecLibsPrefix: getPref("fennecLibsHostPath", "/tmp")
    });
  }
  return sWorker;
}

var sProfileID = 0;
function symbolicate(profile, targetPlatform, sharedLibraries, progressCallback, finishCallback, hwid) {
  var worker = getWorker();

  var id = sProfileID++;
  worker.addEventListener("message", function workerSentMessage(msg) {
    if (msg.data.id == id) {
      switch (msg.data.type) {
        case "progress":
          if (progressCallback)
            progressCallback(msg.data);
          break;
        case "finished":
          worker.removeEventListener("message", workerSentMessage);
          if (msg.data.error) {
            var promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                                  .getService(Ci.nsIPromptService);
            promptService.alert(null, "Symbolication Failed", msg.data.error);
          }

          finishCallback(msg.data.profile);
          break;
      }
    }
  });

  var uri = getPref("symbolicationUrl", DEFAULT_SYMBOLICATION_URL);
  worker.postMessage({ id: id,
                       profile: profile,
                       targetPlatform: targetPlatform,
                       sharedLibraries: sharedLibraries,
                       uri: uri,
                       androidHWID: hwid
                     });
}
