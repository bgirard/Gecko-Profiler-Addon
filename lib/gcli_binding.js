const {Cu} = require("chrome");

exports.bindGCLI = function bindGCLI(profiler, profilerStatus, toggle_state, set_feature, analyze) {
  Cu.import("resource:///modules/devtools/gcli.jsm");

  var profilerFeatures;

  function updateProfilerStatus(profilerStatus) {
    profilerFeatures = profilerStatus.profilerFeatures;
  }
  updateProfilerStatus(profilerStatus);

  gcli.addCommand({
    name: 'profiler',
    description: 'Commands to control the Gecko Profiler'
  });

  gcli.addCommand({
    name: 'profiler start',
    description: 'Start the Gecko Profiler',
    exec: function(args, context) {
      if (profiler.IsActive()) {
        return 'Profiler already started';
      }
      toggle_state();
      return 'Profiler started: Press Ctrl+Shift+S to avoid loading extra frames';
    }
  });

  gcli.addCommand({
    name: 'profiler stop',
    description: 'Stop the Gecko Profiler',
    exec: function(args, context) {
      if (!profiler.IsActive()) {
        return 'Profiler already started';
      }
      toggle_state();
      return 'Profiler stopped: Press Ctrl+Shift+S to avoid loading extra frames';
    }
  });

  gcli.addCommand({
    name: 'profiler analyze',
    description: 'Open the Analyzer on the most recent profile grab',
    params: [ ],
    exec: function(args, context) {
      var deferred = context.defer();
      analyze(function got_profile(profile) {
        function numberWithCommas(x) {
          return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }

        if (typeof profile === "string") {
          deferred.resolve("Analyzing profile: " + numberWithCommas(profile.length) + " bytes");
        } else {
          deferred.resolve("Analyzing profile");
        }
      });
      return deferred.promise;
    }
  });

  gcli.addCommand({
    name: 'profiler set',
    description: 'Alter profiler settings',
    params: [
      {
        name: 'setting',
        description: 'The setting to alter',
        type: {
          name: 'selection',
          data: function() {
            var reply = [];
            for (var i = 0; i < profilerFeatures.length; i++) {
              reply.push(profilerFeatures[i]);
            }
            return reply;
          },
          cacheable: false
        }
      },
      {
      name: 'value',
      type: 'boolean'
      }
    ],
    exec: function(args, context) {
      set_feature(args.setting, args.value);

      var newStatus;
      if (args.value) {
        newStatus = "activated";
      } else {
        newStatus = "de-activated";
      }
      function capitaliseFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
      }

      return capitaliseFirstLetter(args.setting) + ' ' + newStatus + '. \nNote: Restart the profiler when changing features.';
    }
  });
}
