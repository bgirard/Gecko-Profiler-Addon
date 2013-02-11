/* -*- Mode: js2; indent-tabs-mode: nil; js2-basic-offset: 2; -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2013
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Benoit Girard <bgirard@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const {Cc,Ci,Cu} = require("chrome");

let main = require("main");
let data = require("self").data;
let cmdRunnerModule = Cu.import(data.url("CmdRunner.jsm"));

var gIsRecording = false;

function Screencast_isAvailable() {
  var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
  var platform = hh["platform"];
  //if (platform === "X11") {
  //    platform = "Linux";
  //}
  // Only support on mac
  return platform === "Macintosh";
}

exports.isRecording = function Screencast_isRecording() {
  return gIsRecording;
}
exports.start = function Screencast_start(cb) {
  cmdRunnerModule.exec("rm /tmp/gp.mov; rm /tmp/gp.webm; mac-screen-recorder /tmp/gp.mov", true);
  gIsRecording = true;
}
exports.stop = function Screencast_stop(cb) {
  gIsRecording = false;
  cmdRunnerModule.exec("killall -INT mac-screen-recorder");
  cmdRunnerModule.runCommand("/bin/bash -c 'while [ $(ps -A | grep mac-screen-recorder | wc -l) != 3 ]; do sleep 0.1; echo $(ps -A | grep mac-screen-recorder | wc -l); done'", function(r) {
    cb();
  });
}
exports.transcode = function Screencast_transcode(cb, progress_cb) {
  cmdRunnerModule.runCommand("/bin/bash -c 'transcode.sh /tmp/gp.mov /tmp/gp.webm 2>&1'", function(r) {
    cmdRunnerModule.runCommand("/bin/bash -c 'transcode.sh /tmp/gp.mov /tmp/gp.webm 2>&1'", function(r) {
      cmdRunnerModule.runCommand("/bin/bash -c 'scp /tmp/gp.webm people.mozilla.org:public_html'", function(r) {
        cb();
      });
    });
  }, true, function progress(r) {
    r = r.split("\r");
    r = r[Math.max(0, r.length-2)];
    progress_cb(r);
  });
}

exports.hasPreReq = function Screencast_hasPreReq(cb, error_cb) {
  if (!Screencast_isAvailable()) {
    error_cb({
      description: "Screencast is not supported on this platform."
    });
    return;
  }
  cmdRunnerModule.runCommand("/bin/bash -c 'which ffmpeg'", function(r) {
    if (!r) {
      dump("ffmpeg not found: " + r + "\n");
      error_cb({
        description: "'ffmpeg' not found in your PATH",
        //url: ""
      }); 
      return;
    }
    cmdRunnerModule.runCommand("/bin/bash -c 'which mac-screen-recorder && which transcode.sh'", function(r) {
      if (r.indexOf("mac-screen-recorder") == -1 || r.indexOf("transcode.sh") == -1) {
        dump("mac-screen-recorder not found\n");
        error_cb({
          description: "'mac-screen-recorder' not found in your PATH",
          //url: ""
        }); 
        return;
      }
      cb({});
    });
  });
}
