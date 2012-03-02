var EXPORTED_SYMBOLS = ["runCommand"];

var Cc = Components.classes;
var Ci = Components.interfaces;

var sWorker = null;
function getWorker() {
  if (!sWorker) {
    sWorker = new ChromeWorker("CmdRunWorker.js");
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    sWorker.postMessage(hh["platform"]);
  }
  return sWorker;
}

function runCommand(cmd, callback) {
  var worker = getWorker();
  worker.addEventListener("message", function workerSentMessage(msg) {
    if (msg.data.cmd == cmd) {
      worker.removeEventListener("message", workerSentMessage);
      callback(msg.data.result);
    }
  });
  worker.postMessage(cmd);
}
