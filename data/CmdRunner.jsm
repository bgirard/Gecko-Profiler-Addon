var EXPORTED_SYMBOLS = ["runCommand"];

var Cc = Components.classes;
var Ci = Components.interfaces;

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

function runCommand(cmd, callback) {
  var worker = getWorker();
  worker.addEventListener("message", function workerSentMessage(msg) {
    if (msg.data.cmd == cmd) {
      worker.removeEventListener("message", workerSentMessage);
      callback(msg.data.result);
    }
  });
  worker.postMessage({type: "runCommand", cmd: cmd});
}
