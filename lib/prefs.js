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
 * Portions created by the Initial Developer are Copyright (C) 2012
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

exports.get_pref_int = function get_pref_int(branch, node, defaultValue) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    try {
        var value = prefs.getIntPref(node);
    } catch (e) {
        if (defaultValue == null)
            defaultValue = 0;
        return defaultValue;
    }
    return value;
}

exports.set_pref_int = function set_pref_int(branch, node, value) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);

    var value = prefs.setIntPref(node, value);
}

exports.get_pref_bool = function get_pref_bool(branch, node, defaultValue) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    try {
        var value = prefs.getBoolPref(node);
    } catch (e) {
        if (defaultValue == null)
            defaultValue = false;
        return defaultValue;
    }
    return value;
}

exports.set_pref_bool = function set_pref_bool(branch, node, value) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);

    var value = prefs.setBoolPref(node, value);
}

exports.set_pref_string = function set_pref_string(branch, node, value) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);

    var value = prefs.setCharPref(node, value);
}

exports.get_pref_string = function get_pref_string(branch, node, defaultValue) {
    var prefs = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService).getBranch(branch);
    try {
        return prefs.getCharPref(node);
    } catch (e) {
        return defaultValue;
    }
    return "??";
}

exports.default_init_pref = function default_init_pref(branch, node, initValue) {
    if (exports.get_pref_bool(branch, node, "null") === "null") {
        exports.set_pref_bool(branch, node, initValue);
    }
};

exports.default_init_pref_string = function default_init_pref_string(branch, node, initValue) {
    if (exports.get_pref_string(branch, node, "null") === "null") {
        exports.set_pref_string(branch, node, initValue);
    }
}

