/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var tabLastSelected = null;
var gStartedWithFeatures = [];
var gFeatureList = [];
var gFeaturesPrefs = {};
var gSamplingInterval = -1;
var gSampleBufferSize = -1;

function has_feature(feature) {
    return gFeatureList.indexOf(feature) !== -1;
}
function has_feature_active(feature) {
    return gFeaturesPrefs[feature] === true;
}

self.port.on("change_status", function(val) {
  dump("Got feature change\n");
  gStartedWithFeatures = val.startedWithFeatures;
  gFeatureList = val.profilerFeatures;
  gFeaturesPrefs = val.profilerFeaturesPrefs;
  gSamplingInterval = val.samplingInterval;
  gSampleBufferSize = val.sampleBufferSize;
  if (tabLastSelected)
    select_tab(tabLastSelected.id);
});

function select_tab(tabId) {
  if (tabLastSelected) {
    tabLastSelected.classList.remove("selected");
  }
  var tab = document.getElementById(tabId);
  tab.classList.add("selected");
  tabLastSelected = tab;

  var mainAreaDiv = document.getElementById("mainarea");
  mainAreaDiv.innerHTML = "";
  if (tabId === "tabSimple") {
    selectTabSimple(mainAreaDiv);
  } else if (tabId === "tabAdvanced") {
    selectTabAdvanced(mainAreaDiv);
  }
}

var featureDescription = {
  "stackwalk" : "Enable stackwalking in <a href='http://ftp.mozilla.org/pub/mozilla.org/firefox/nightly/latest-profiling/'>profiling-nightly</a> or custom profiling builds. Custom builds should specify: 'ac_add_options --enable-profiling'",
  "jank" : "Only record samples when the application is not responding. Useful for collecting the source of hangs over a large timespan.",
  "adb" : "Profile debug version of fennec, this will not work on nightlies. Install 'adb' on your path, and connect a device via usb debugging.",
  "sampling" : "Adjust frequency of sampling and sample buffer size by choosing a preset or entering custom values:"
};

var rowCount = 0;
function addFeatureDiv(div, name, featureName, desc) {
  var caption = featureDescription[featureName];
  var feature = document.createElement("div");
  div.appendChild(feature);
  feature.className = "settingItem";
  if (rowCount % 2 == 1) {
    feature.classList.add("oddRow");
  }
  rowCount++;
  feature.onmouseover = function() {
    var infoBarDiv = document.getElementById("infobar");
    infoBarDiv.innerHTML = desc;
  };
  
  var featureCheckbox = document.createElement("input");
  featureCheckbox.checked = has_feature_active(featureName);
  featureCheckbox.type = "checkbox";
  feature.appendChild(featureCheckbox);
  var featureText = document.createElement("text");
  feature.appendChild(featureText);
  featureText.textContent = name;
  feature.appendChild(document.createElement("br"));
  feature.appendChild(document.createElement("br"));
  var featureDescriptionNode = document.createElement("text");
  feature.appendChild(featureDescriptionNode);
  featureDescriptionNode.innerHTML = caption;

  featureCheckbox.onclick = function() {
    self.port.emit("set_feature", {feature:featureName, value:featureCheckbox.checked});
  };

  return feature;
}

var presets = {
  "Maximum resolution": { interval: 1, entries: 1000000, disableEditFields: true },
  "Default settings": { interval: 10, entries: 100000, disableEditFields: true },
  "Custom": {
    get interval() { return gSamplingInterval; },
    get entries() { return gSampleBufferSize; },
    disableEditFields: false
  }
};

function OnListboxChanged() {
  var listBox = document.getElementById("presets");
  var presetName = listBox.value;
  var selectedPreset = presets[presetName];

  var intervalField = document.getElementById("intervalField");
  var entriesField = document.getElementById("entriesField");

  intervalField.value = selectedPreset.interval;
  entriesField.value = selectedPreset.entries;

  intervalField.disabled = selectedPreset.disableEditFields;
  entriesField.disabled = selectedPreset.disableEditFields;
}

function addSamplingSettingsDiv(div, featureName, desc) {
  var caption = featureDescription[featureName];
  var feature = document.createElement("div");
  div.appendChild(feature);
  feature.className = "settingItem";
  if (rowCount % 2 == 1) {
    feature.classList.add("oddRow");
  }
  rowCount++;
  feature.onmouseover = function() {
    var infoBarDiv = document.getElementById("infobar");
    infoBarDiv.innerHTML = desc;
  };

  feature.appendChild(document.createTextNode(caption));
  feature.appendChild(document.createElement("br"));
  feature.appendChild(document.createElement("br"));

  feature.appendChild(document.createTextNode("Presets: "));
  var listBox = document.createElement("select");
  listBox.id = "presets";
  var selectedItem = false;
  for (var presetName in presets) {
    var option = document.createElement("option");
    option.text = presetName;
    option.value = presetName;
    listBox.add(option);
    if (!selectedItem &&
        presets[presetName].interval == gSamplingInterval &&
        presets[presetName].entries == gSampleBufferSize) {
      // If current settings match a preset, select that preset
      listBox.selectedIndex = listBox.length - 1;
      selectedItem = true;
    }
  }
  listBox.onchange = OnListboxChanged;
  feature.appendChild(listBox);

  feature.appendChild(document.createElement("br"));

  feature.appendChild(document.createTextNode("Sampling Interval (ms):"));
  var intervalField = document.createElement("input");
  intervalField.id = "intervalField";
  intervalField.value = gSamplingInterval;
  intervalField.disabled = presets[listBox.value].disableEditFields;
  feature.appendChild(intervalField);
  feature.appendChild(document.createElement("br"));

  feature.appendChild(document.createTextNode("Sample Buffer Size (samples):"));
  var entriesField = document.createElement("input");
  entriesField.id = "entriesField";
  entriesField.value = gSampleBufferSize;
  entriesField.disabled = presets[listBox.value].disableEditFields;
  feature.appendChild(entriesField);
  feature.appendChild(document.createElement("br"));

  var submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.innerHTML = "Set values";
  submitButton.onclick = function() {
    var samplingInterval = parseInt(intervalField.value);
    var sampleBufferSize = parseInt(entriesField.value);
    if (isNaN(samplingInterval) || isNaN(sampleBufferSize) ||
        samplingInterval <= 0 || sampleBufferSize <= 0) {
      alert("Sampling Interval & Sample Buffer Size must be positive integers.");
      return;
    }

    self.port.emit("adjust_sampling", {interval: samplingInterval, entries: sampleBufferSize});

    gSamplingInterval = samplingInterval;
    gSampleBufferSize = sampleBufferSize;
  };
  feature.appendChild(submitButton);

  feature.appendChild(document.createElement("br"));

  return feature;
}

function selectTabSimple(mainAreaDiv) {
  var featuresDiv = document.createElement("div");
  mainAreaDiv.appendChild(featuresDiv);
  featuresDiv.className = "settingHeader";
  featuresDiv.textContent = "Features";
  rowCount = 0;

  var feature_stackwalking = addFeatureDiv(mainAreaDiv, "Stackwalk", "stackwalk", "Mouse over text");
  var feature_jank = addFeatureDiv(mainAreaDiv, "Jank", "jank", "Mouse over text");
}
function selectTabAdvanced(mainAreaDiv) {
  var featuresDiv = document.createElement("div");
  mainAreaDiv.appendChild(featuresDiv);
  featuresDiv.className = "settingHeader";
  featuresDiv.textContent = "Advanced Features";
  rowCount = 0;

  var feature_stackwalking = addFeatureDiv(mainAreaDiv, "Fennec profiling", "adb", "Mouse over text");
  var sampling_settings = addSamplingSettingsDiv(mainAreaDiv, "sampling", "Adjust how sampling is done");
}

document.getElementById('tabSimple').onclick = function() {
  select_tab("tabSimple");
};
document.getElementById('tabAdvanced').onclick = function() {
  select_tab("tabAdvanced");
};
select_tab("tabSimple");
