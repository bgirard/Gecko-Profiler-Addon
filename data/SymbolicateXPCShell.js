const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Components.utils.import("resource://gre/modules/ctypes.jsm");

function importScripts(a) {}
var self = {};

var _pendingTimers = [];
function _Timer(func, delay) {
  delay = Number(delay);
  if (delay < 0)
    do_throw("do_timeout() delay must be nonnegative");

  if (typeof func !== "function")
    do_throw("string callbacks no longer accepted; use a function!");

  this._func = func;
  this._start = Date.now();
  this._delay = delay;

  var timer = Components.classes["@mozilla.org/timer;1"]
                        .createInstance(Components.interfaces.nsITimer);
  timer.initWithCallback(this, delay, timer.TYPE_ONE_SHOT);

  // Keep timer alive until it fires
  _pendingTimers.push(timer);
}
_Timer.prototype = {
  QueryInterface: function(iid) {
    if (iid.Equals(Components.interfaces.nsITimerCallback) ||
        iid.Equals(Components.interfaces.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  notify: function(timer) {
    _pendingTimers.splice(_pendingTimers.indexOf(timer), 1);
    dump("fired\n");

    // The current nsITimer implementation can undershoot, but even if it
    // couldn't, paranoia is probably a virtue here given the potential for
    // random orange on tinderboxen.
    var end = Date.now();
    var elapsed = end - this._start;
    if (elapsed >= this._delay) {
      try {
        this._func.call(null);
      } catch (e) {
        do_throw("exception thrown from do_timeout callback: " + e);
      }
      return;
    }

    // Timer undershot, retry with a little overshoot to try to avoid more
    // undershoots.
    var newDelay = this._delay - elapsed;
    do_timeout(newDelay, this._func);
  }
};

function setTimeout(func, time)  {
  new _Timer(func, Number(time));
}

var sIsDone = false;
self.postMessage = function (msg) {
  if (msg.type == "progress") {
    dump("progress\n");
  } else if (msg.type == "finished") {
    dump("finished\n");
    sIsDone = true;
  } else {
    dump("Message type: " + msg.type + "\n");
  }
}

function symbolicate_file(fileName) {
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var abi = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI;

    self.onmessage({ data : {
        platform: hh["platform"],
        abi: abi,
        androidLibsPrefix: "/tmp",
        fennecLibsPrefix: "/tmp"
    }});
    dump("Start\n");
    profile = runCommandWorker("cat " + fileName);
    self.onmessage({ data : {
        id: 1,
        profile: profile,
        targetPlatform: "Android",
        sharedLibraries: null, // its already in profile
        uri: null,
        androidHWID:null
    }});

    dump("waiting\n");
    var gThreadManager = Cc["@mozilla.org/thread-manager;1"]
        .getService(Ci.nsIThreadManager);
    var mainThread = gThreadManager.currentThread;

    while (!sIsDone)
        mainThread.processNextEvent(true);

}

//var loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
//   .getService(Components.interfaces.mozIJSSubScriptLoader);
//loader.loadSubScript("file:///home/bgirard/mozilla/android/eideticker/src/GeckoProfilerAddon/firefox/file.jsm");


