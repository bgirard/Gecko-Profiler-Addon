const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Components.utils.import("resource://gre/modules/ctypes.jsm");

function importScripts(a) {}
var self = {};

self.postMessage = function (msg) {
  if (msg.type == "Progress") {
    dump("progress\n");
  } else {
    dump("Message type: " + msg.type + "\n");
  }
}

function symbolicate_file(fileName) {
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var abi = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI;

    self.onmessage({ data : {
        platform: ["platform"],
        abi: abi,
        androidLibsPrefix: "/tmp",
        fennecLibsPrefix: "/tmp"
    }});
    profile = runCommandWorker("cat " + fileName);
    self.onmessage({ data : {
        id: 1,
        profile: profile,
        targetPlatform: "Android",
        sharedLibraries: null, // its already in profile
        uri: null,
        androidHWID:null
    }});
}

//var loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
//   .getService(Components.interfaces.mozIJSSubScriptLoader);
//loader.loadSubScript("file:///home/bgirard/mozilla/android/eideticker/src/GeckoProfilerAddon/firefox/file.jsm");


