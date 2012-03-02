const gDebugExpectedDurations = false;

function ProgressReporter() {
  this._observers = [];
  this._subreporters = [];
  this._subreporterExpectedDurationsSum = 0;
  this._progress = 0;
  this._state = ProgressReporter.STATE_WAITING;
  this._action = "";
}

ProgressReporter.STATE_WAITING = 0;
ProgressReporter.STATE_DOING = 1;
ProgressReporter.STATE_FINISHED = 2;

ProgressReporter.prototype = {
  getProgress: function () {
    return this._progress;
  },
  getState: function () {
    return this._state;
  },
  getAction: function () {
    switch (this._state) {
      case ProgressReporter.STATE_WAITING:
        return "Waiting for preceding tasks to finish...";
      case ProgressReporter.STATE_DOING:
        return this._action;
      case ProgressReporter.STATE_FINISHED:
        return "Finished.";
      default:
        throw "Broken state";
    }
  },
  addListener: function (callback) {
    this._observers.push(callback);
  },
  addSubreporter: function (expectedDuration) {
    this._subreporterExpectedDurationsSum += expectedDuration;
    var subreporter = new ProgressReporter();
    var self = this;
    subreporter.addListener(function (progress) {
      self._recalculateProgressFromSubreporters();
      self._recalculateStateAndActionFromSubreporters();
      self._reportProgress();
    });
    this._subreporters.push({ expectedDuration: expectedDuration, reporter: subreporter });
    return subreporter;
  },
  addSubreporters: function (expectedDurations) {
    var reporters = {};
    for (var key in expectedDurations) {
      reporters[key] = this.addSubreporter(expectedDurations[key]);
    }
    return reporters;
  },
  begin: function (action) {
    this._startTime = Date.now();
    this._state = ProgressReporter.STATE_DOING;
    this._action = action;
    this._reportProgress();
  },
  setProgress: function (progress) {
    if (this._subreporters.length > 0)
      throw "Can't call setProgress on a progress reporter with subreporters";
    if (progress != this._progress &&
        (progress == 1 || (progress - this._progress >= 0.05))) {
      this._progress = progress;
      if (progress == 1)
        this._transitionToFinished();
      this._reportProgress();
    }
  },
  finish: function () {
    this.setProgress(1);
  },
  _recalculateProgressFromSubreporters: function () {
    if (this._subreporters.length == 0)
      throw "Can't _recalculateProgressFromSubreporters on a progress reporter without any subreporters";
    this._progress = 0;
    for (var i = 0; i < this._subreporters.length; i++) {
      var { expectedDuration, reporter } = this._subreporters[i];
      this._progress += reporter.getProgress() * expectedDuration / this._subreporterExpectedDurationsSum;
    }
  },
  _recalculateStateAndActionFromSubreporters: function () {
    if (this._subreporters.length == 0)
      throw "Can't _recalculateStateAndActionFromSubreporters on a progress reporter without any subreporters";
    var actions = [];
    var allWaiting = true;
    var allFinished = true;
    for (var i = 0; i < this._subreporters.length; i++) {
      var { expectedDuration, reporter } = this._subreporters[i];
      var state = reporter.getState();
      if (state != ProgressReporter.STATE_WAITING)
        allWaiting = false;
      if (state != ProgressReporter.STATE_FINISHED)
        allFinished = false;
      if (state == ProgressReporter.STATE_DOING)
        actions.push(reporter.getAction());
    }
    if (allFinished) {
      this._transitionToFinished();
    } else if (!allWaiting) {
      this._state = ProgressReporter.STATE_DOING;
      if (actions.length == 0) {
        this._action = "About to start next task..."
      } else {
        this._action = actions.join("\n");
      }
    }
  },
  _transitionToFinished: function () {
    this._state = ProgressReporter.STATE_FINISHED;

    if (gDebugExpectedDurations) {
      this._realDuration = Date.now() - this._startTime;
      if (this._subreporters.length) {
        for (var i = 0; i < this._subreporters.length; i++) {
          var { expectedDuration, reporter } = this._subreporters[i];
          var realDuration = reporter._realDuration;
          dump("For reporter with expectedDuration " + expectedDuration + ", real duration was " + realDuration + "\n");
        }
      }
    }
  },
  _reportProgress: function () {
    for (var i = 0; i < this._observers.length; i++) {
      this._observers[i](this);
    }
  },
};
