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
 * Portions created by the Initial Developer are Copyright (C) 2011
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
 
function init() {
    
    document.getElementById("short_desc").value = "[SPS] ";
    document.getElementById("status_whiteboard").value = "[SPS]";
    document.getElementById("comment").textContent = "URL";
    document.getElementById("short_desc").focus();
    
    self.port.emit("getaboutsupport", "test");
}

self.port.on("getaboutsupport", function(data) {
    var info = data["info"];
    var url = data["url"];
    var buildInfo = '';
    for (property in info) {
      buildInfo += property + ': ' + info[property]+'; ';
    }
    
    var commentStr = "==SPS Bug Report Form==\n\n";
    
    commentStr += "What is slow? Steps to reproduce: \n\n\n";
    commentStr += "Reproducible: \n\n\n";
    commentStr += "Cache Sensitive: Y/N\n\n";
    commentStr += "Profile: \n" + url + "\n\n";
    commentStr += "Build info:\n" + buildInfo + "\n";

    document.getElementById("comment").textContent = commentStr;
});

init();
