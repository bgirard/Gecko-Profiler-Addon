// -*- Mode: js2; tab-width: 2; indent-tabs-mode: nil; js2-basic-offset: 2; js2-skip-preprocessor-directives: t; -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cc,Ci,Cu} = require("chrome");

let main = require("main");

function RemoteProfiler(options, cb) {
  this._options = options;
  Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
  DebuggerClient.socketConnect({ host: options.hostname, port: options.port }).then(function (transport) {
    this._client = new DebuggerClient(transport);
    this._client.connect(function(aType, aTraits) {
      this._client.listTabs(function(aResponse) {
        this._profilerActor = aResponse.profilerActor;
        this._eventObservers = {};
        this.gcStats = new main.GCStats(this);
        cb.call(this);
      }.bind(this));
      this._client.addListener("eventNotification", function (aType, aData) {
        if (aData.topic in this._eventObservers) {
          for (let observer of this._eventObservers[aData.topic]) {
            observer.observe(aData.subject, aData.topic, aData.data);
          }
        }
      }.bind(this));
    }.bind(this));
  }.bind(this));
}

exports.RemoteProfiler = RemoteProfiler;

RemoteProfiler.prototype = {
  start: function remoteProfiler_start(entries, interval, features, threadFilters, cb) {
    this._client.request({ to: this._profilerActor, type: "startProfiler", entries: entries, interval: interval, features: features, threadFilters: threadFilters }, function(aResponse) {
      if (!aResponse.error && cb != null)
        cb()
    });
  },
  getPlatform: function remoteProfiler_getPlatform() {
    // default to the host's platform
    return this._options.platform;
  },
  getHardwareID: function remoteProfiler_getHardwareID() {
    return this._options.hardwareID;
  },
  getTargetDescription: function remoteProfiler_getTargetDescription() {
    if (this._options.targetDescription)
      return this._options.targetDescription;
    return "TCP@" + this._options.hostname + ":" + this._options.port;
  },
  getTimelines: function profiler_getTimeline() {
    return [];
  },
  stop: function remoteProfiler_stop(cb) {
    this._client.request({ to: this._profilerActor, type: "stopProfiler" }, function(aResponse) {
      if (!aResponse.error)
        cb()
    });
  },
  getProfile: function profiler_getProfile(cb) {
    this._client.request({ to: this._profilerActor, type: "getProfile" }, function(aResponse) {
      if (!aResponse.error) {
        cb(aResponse.profile)
      }
    }.bind(this));
  },
  isActive: function profiler_isActive(cb) {
    this._client.request({ to: this._profilerActor, type: "isActive" }, function(aResponse) {
      if (!aResponse.error)
        cb(aResponse.isActive)
    });
  },
  getResponsivenessTimes: function profiler_getResponsivenessTimes(cb) {
    this._client.request({ to: this._profilerActor, type: "getResponsivenessTimes" }, function(aResponse) {
      if (!aResponse.error)
        cb(aResponse.responsivenessTimes)
    });
  },
  getFeatures: function profiler_getFeatures(cb) {
    this._client.request({ to: this._profilerActor, type: "getFeatures" }, function(aResponse) {
      if (!aResponse.error)
        cb(aResponse.features);
      else
        cb(["js"]);
    });
  },
  getSharedLibraryInformation: function profiler_getSharedLibraryInformation(cb) {
    this._client.request({ to: this._profilerActor, type: "getSharedLibraryInformation" }, function(aResponse) {
      if (!aResponse.error)
        cb(aResponse.sharedLibraryInformation);
      else
        cb("[]");
    });
  },
  registerEventNotifications: function profiler_registerEventNotifications(events, observer) {
    this._client.request({ to: this._profilerActor, type: "registerEventNotifications", events: events }, function(aResponse) {
      for (let event of aResponse.registered) {
        if (event in this._eventObservers) {
          if (this._eventObservers[event].indexOf(observer) != -1)
            continue;
        } else {
          this._eventObservers[event] = [];
        }
        this._eventObservers[event].push(observer);
      }
    }.bind(this));
  },
  unregisterEventNotifications: function profiler_unregisterEventNotifications(events, observer) {
    for (let event of events) {
      if (!event in this._eventObservers)
        continue;
      var idx = this._eventObservers[event].indexOf(observer);
      if (idx == -1)
        continue;
      this._eventObservers[event].splice(idx, 1);
      if (this._eventObservers[event].length == 0) {
        this._client.request({ to: this._profilerActor, type: "unregisterEventNotifications", events: [event] }, function(aResponse) {
          delete this._eventObservers[event];
        }.bind(this));
      }
    }
  },
  shutdown: function profiler_shutdown() {
    main.Profiler.prototype.shutdown.call(this);
    this._client.close(function() { });
  }
};
