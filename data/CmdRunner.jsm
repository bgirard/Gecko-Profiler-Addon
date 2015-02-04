var EXPORTED_SYMBOLS = ["runCommand"];

var Cc = Components.classes;
var Ci = Components.interfaces;

var DEBUG_COMMANDS = false;

var sWorker = null;
function createWorker() {
  worker = new ChromeWorker("CmdRunWorker.js");
  var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  worker.postMessage({type: "platform", cmd: hh["platform"]});
  return worker;
}
function getWorker() {
  if (!sWorker) {
    sWorker = createWorker();
  }
  return sWorker;
}

function exec(cmd, uniqueWorker) {
  var worker = getWorker();
  if (uniqueWorker) {
    worker = createWorker();
  }
  worker.postMessage({type: "exec", cmd: cmd});
}

function runCommand(cmd, callback, isProgressive, progress_callback) {
  var worker = getWorker();
  return new Promise(function (resolve, reject) {
    worker.addEventListener("message", function workerSentMessage(msg) {
      if (msg.data.cmd == cmd) {
        if (msg.data.progress) {
          progress_callback(msg.data.progress);
        } else { // finish
          worker.removeEventListener("message", workerSentMessage);
          if (DEBUG_COMMANDS) {
            dump("ran command: " + cmd + "\n");
            dump("got result: " + msg.data.result + "\n");
          }
          if (callback)
            callback(msg.data.result);
          resolve(msg.data.result);
        }
      }
    });
    worker.postMessage({type: "runCommand", cmd: cmd, isProgressive: isProgressive});
  });
}
