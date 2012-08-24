/* -*- Mode: js2; indent-tabs-mode: nil; -*- */

importScripts("ProgressReporter.js");

var dropFrames =
  [ "TableTicker::Tick",
    "ProfilerSignalHandler",
    "js::RunScript(JSContext*, JSScript*, js::StackFrame*)",
    "__CFRUNLOOP_IS_CALLING_OUT_TO_A_SOURCE0_PERFORM_FUNCTION__",
    "_ZL21ProfilerSignalHandler",
    "0x00000001",
    "_sigtramp",
    "???",
    "?? ??:0"
 ];

var sCmdWorker = null;
var sPlatform = "";
var sAbi = "";
var sAndroidLibsPrefix = "/tmp";
var sFennecLibsPrefix = "/tmp";

function init(platform, abi, androidLibsPrefix, fennecLibsPrefix) {
    if (platform == "X11") {
        platform = "Linux";
    }
    sCmdWorker = new ChromeWorker("CmdRunWorker.js");
    sCmdWorker.postMessage({type: "platform", cmd: platform});
    sPlatform = platform;
    sAbi = abi;
    sAndroidLibsPrefix = androidLibsPrefix;
    sFennecLibsPrefix = fennecLibsPrefix;
}

var inited = false;

self.onmessage = function (msg) {
  if (!inited) {
    var { platform, abi, androidLibsPrefix, fennecLibsPrefix } = msg.data;
    init(platform, abi, androidLibsPrefix, fennecLibsPrefix);
    inited = true;
    return;
  }

  var { id, profile, sharedLibraries, uri, androidHWID } = msg.data;

  if (sharedLibraries != null) {
      sharedLibraries = JSON.parse(sharedLibraries);
      sharedLibraries.sort(function (a, b) { return a.start - b.start; });
      // version convert older sharedLibraries formats
      for (var i = 0; i < sharedLibraries.length; i++) {
          if (sharedLibraries[i].offset == null) {
              sharedLibraries[i].offset = 0;
          }
      }
  }

  var targetPlatform = sPlatform;
  if (msg.data.targetPlatform != null) {
      targetPlatform = msg.data.targetPlatform;
  }

  if (typeof profile === "string" && profile.charAt(0) === "{") {
    dump("Text profile starting with '{', parsing as JSON (" + profile.length + " bytes)\n");
    profile = JSON.parse(profile);
    dump("Parsed\n");

    if (!sharedLibraries && profile.libs) {
      sharedLibraries = JSON.parse(profile.libs);
      dump("Extract shared library from profile\n");
    }
  }

  if (sPlatform == "Macintosh" || sPlatform == "Linux" || sPlatform == "Android") {
    symbolicate(profile, sharedLibraries, targetPlatform, function (progress, action) {
      self.postMessage({ id: id, type: "progress", progress: progress, action: action });
    }, function (result) {
      postSymbolicatedProfile(id, profile, result);
    }, androidHWID);
  } else if (sPlatform == "Windows") {
    symbolicateWindows(profile, sharedLibraries, uri, function (result) {
      postSymbolicatedProfile(id, profile, result);
    }, androidHWID);
  } else {
    dump("Don't know how to symbolicate for platform: '" + sPlatform + "'\n");
    postSymbolicatedProfile(id, profile, {});
  }
}

function postSymbolicatedProfile(id, profile, symbolicationTable) {
    var errorString = null;
    if ("error" in symbolicationTable) {
        errorString = symbolicationTable.error;
        symbolicationTable = {};
    }

    var bundle;

    if (typeof profile === "string") {

      bundle = {
          format: "profileStringWithSymbolicationTable,1",
          profileString: profile,
          symbolicationTable: symbolicationTable
      };
    } else {
      bundle = {
          format: "profileJSONWithSymbolicationTable,1",
          profileJSON: profile,
          symbolicationTable: symbolicationTable
      };
    }

    self.postMessage({ id: id, type: "finished", profile: JSON.stringify(bundle), error: errorString });
}

function runCommand(cmd, callback) {
  var worker = sCmdWorker;
  worker.addEventListener("message", function workerSentMessage(msg) {
    if (msg.data.cmd == cmd) {
      worker.removeEventListener("message", workerSentMessage);
      callback(msg.data.result);
    }
  });
  worker.postMessage({type: "runCommand", cmd: cmd});
}

function getJSScriptURL(fullName) {
  var isJSFrame = false;
  var url = null;
  var match =
    /^(.*) \(in ([^\)]*)\) (\+ [0-9]+)$/.exec(fullName) ||
    /^(.*) \(in ([^\)]*)\) (\(.*:.*\))$/.exec(fullName) ||
    /^(.*) \(in ([^\)]*)\)$/.exec(fullName);
    // Try to parse a JS frame
  var jsMatch1 = match ||
    /^(.*) \((.*):([0-9]+)\)$/.exec(fullName);
  if (!match && jsMatch1) {
    url = jsMatch1[2];
    isJSFrame = true;
  }
  var jsMatch2 = match ||
    /^(.*):([0-9]+)$/.exec(fullName);
  if (!match && jsMatch2) {
    url = jsMatch2[1];
    isJSFrame = true;
  }
  if (url) {
    var urlTokens = url.split(" ");
    url = urlTokens[urlTokens.length-1];
  }
  return url;
}

// Compute a map of libraries to resolve
function findSymbolsToResolve(reporter, lines) {
    reporter.begin("Gathering unresolved symbols...");
    var addresses = {};
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("l-0x") == 0 ||
            line.indexOf("L-0x") == 0)
        {
            var address = line.substring(2);
            addresses[address] = null;
        }
        reporter.setProgress((i + 1) / lines.length);
    }
    reporter.finish();
    return Object.keys(addresses);
}

function findSymbolsToResolveJSON(reporter, profile) {
    reporter.begin("Gathering unresolved symbols...");
    var addresses = {};
    if (!profile.threads) {
      return Object.keys(addresses);
    }
    for (var i = 0; i < profile.threads.length; i++) {
        var thread = profile.threads[i];
        if (!thread.samples)
            continue;
        for (var j = 0; j < thread.samples.length; j++) {
            var sample = thread.samples[j];
            if (!sample.frames)
                continue;
            for (var k = 0; k < sample.frames.length; k++) {
                var frame = sample.frames[k];
                if (frame.location.indexOf("0x") == 0) {
                  addresses[frame.location] = null;
                }
            }
        }
    }

    reporter.finish();
    return Object.keys(addresses);
}

function resolveJSDocumentsJSON(reporter, profile) {
    // TODO pass in a proper progress reporter
    //reporter.begin("Gathering js source...");
    var addresses = {};
    if (!profile.threads) {
      return;
    }
    for (var i = 0; i < profile.threads.length; i++) {
        var thread = profile.threads[i];
        if (!thread.samples)
            continue;
        for (var j = 0; j < thread.samples.length; j++) {
            var sample = thread.samples[j];
            if (!sample.frames)
                continue;
            for (var k = 0; k < sample.frames.length; k++) {
                // Try to get a JS url if this is a JS frame. If
                // so we will retrieve for the document
                // for the front end to expend the source view.
                var frame = sample.frames[k];
                var url = getJSScriptURL(frame.location);
                if (url) {
                    addresses[url] = null;
                }
            }
        }
    }

    profile.meta.js = profile.meta.js || {};
    profile.meta.js.source = profile.meta.js.source || {};

    dump("Fetching js source\n");
    var documentsToFetch = Object.keys(addresses);
    for (var i = 0; i < documentsToFetch.length; i++) {
        var documentToFetch = documentsToFetch[i];
        dump("Fetch: " + documentToFetch + "\n");
        try {
            var uri = documentToFetch;
            var xhr = new XMLHttpRequest();
            xhr.open("GET", uri, false);
            xhr.send(null);
            var scriptStr = xhr.responseText;
            profile.meta.js.source[uri] = scriptStr;
            dump("source:\n" + scriptStr);
        } catch (e) {
            dump("Fetch js source request failed: " + e + " (" + uri + ")\n");
            continue;
        }
    }

    //reporter.finish();
    return;
}

function getContainingLibrary(libs, address) {
    var left = 0;
    var right = libs.length - 1;
    while (left <= right) {
        var mid = Math.floor((left + right) / 2);
        if (address >= libs[mid].end)
            left = mid + 1;
        else if (address < libs[mid].start)
            right = mid - 1;
        else
            return libs[mid];
    }
    return null;
}

function assignSymbolsToLibraries(reporter, sharedLibraries, addresses) {
    reporter.begin("Assigning symbols to libraries...");
    var symbolsToResolve = {};
    for (var i = 0; i < addresses.length; i++) {
        var lib = getContainingLibrary(sharedLibraries, parseInt(addresses[i], 16));
        if (!lib)
            continue;
        if (!(lib.name in symbolsToResolve)) {
            symbolsToResolve[lib.name] = { library: lib, symbols: [] };
        }
        symbolsToResolve[lib.name].symbols.push(addresses[i]);
        reporter.setProgress((i + 1) / addresses.length);
    }
    reporter.finish();
    return symbolsToResolve;
}

function runAsContinuation(fun) {
    function resumeContinuation(result) {
        try { gen.send(result); }
        catch (e if e instanceof StopIteration) { }
    }
    var gen = fun(resumeContinuation);
    resumeContinuation();
}

const kExpectedSymbolsProcessedPerMs = 0.99;
const kSymbolicationWarmupTime = 15; // ms

function resolveSymbols(reporter, symbolsToResolve, platform, callback, hwid) {
    reporter.begin("Resolving symbols...");
    var libReporters = {};
    for (var lib in symbolsToResolve) {
        var expectedDuration = kSymbolicationWarmupTime + symbolsToResolve[lib].symbols.length / kExpectedSymbolsProcessedPerMs;
        libReporters[lib] = reporter.addSubreporter(expectedDuration);
    }
    runAsContinuation(function (resumeContinuation) {
        var resolvedSymbols = {};
        for (var lib in symbolsToResolve) {
            yield read_symbols_lib(libReporters[lib], symbolsToResolve[lib].library,
                                   symbolsToResolve[lib].symbols, platform, resolvedSymbols,
                                   resumeContinuation, hwid);
        }
        setTimeout(function () {
            callback(resolvedSymbols);
        }, 0);
    });
}

function shouldDropFrame(symbolName) {
    return dropFrames.indexOf(symbolName) != -1;
}

function getSplitLines(reporter, profile) {
    dump("Splitting profile into lines...\n");
    reporter.begin("Splitting profile into lines...");
    var split = profile.split("\n");
    reporter.finish();
    return split;
}

function symbolicate(profile, sharedLibraries, platform, progressCallback, finishCallback, hwid) {
    if (typeof profile === "string") {
      return symbolicateStrProfile(profile, sharedLibraries, platform, progressCallback, finishCallback, hwid);
    } else {
      return symbolicateJSONProfile(profile, sharedLibraries, platform, progressCallback, finishCallback, hwid);
    }
}

function symbolicateJSONProfile(profile, sharedLibraries, platform, progressCallback, finishCallback, hwid) {
    runAsContinuation(function (resumeContinuation) {
        var totalProgressReporter = new ProgressReporter();
        var subreporters = totalProgressReporter.addSubreporters({
            symbolFinding: 200,
            symbolLibraryAssigning: 200,
            symbolResolving: 2000,
        });
        totalProgressReporter.addListener(function (r) {
            progressCallback(r.getProgress(), r.getAction());
        });
        totalProgressReporter.begin("Symbolicating profile...");
        var foundSymbols = findSymbolsToResolveJSON(subreporters.symbolFinding, profile);
        resolveJSDocumentsJSON(subreporters.symbolFinding, profile);
        var symbolsToResolve = assignSymbolsToLibraries(subreporters.symbolLibraryAssigning,
                                                        sharedLibraries, foundSymbols);
        var resolvedSymbols = yield resolveSymbols(subreporters.symbolResolving,
                                                   symbolsToResolve, platform,
                                                   resumeContinuation, hwid);
        finishCallback(resolvedSymbols);
    });
}

function symbolicateStrProfile(profile, sharedLibraries, platform, progressCallback, finishCallback, hwid) {
    runAsContinuation(function (resumeContinuation) {
        var totalProgressReporter = new ProgressReporter();
        var subreporters = totalProgressReporter.addSubreporters({
            lineSplitting: 7,
            symbolFinding: 200,
            symbolLibraryAssigning: 200,
            symbolResolving: 2000,
        });
        totalProgressReporter.addListener(function (r) {
            progressCallback(r.getProgress(), r.getAction());
        });
        totalProgressReporter.begin("Symbolicating profile...");
        var lines = getSplitLines(subreporters.lineSplitting, profile);
        sharedLibraries = getSharedLibraries(lines, sharedLibraries);
        var foundSymbols = findSymbolsToResolve(subreporters.symbolFinding, lines);
        var symbolsToResolve = assignSymbolsToLibraries(subreporters.symbolLibraryAssigning,
                                                        sharedLibraries, foundSymbols);
        var resolvedSymbols = yield resolveSymbols(subreporters.symbolResolving,
                                                   symbolsToResolve, platform,
                                                   resumeContinuation, hwid);
        finishCallback(resolvedSymbols);
    });
}

function symbolicateWindows(profile, sharedLibraries, uri, finishCallback) {
    var totalProgressReporter = new ProgressReporter();
    var subreporters = totalProgressReporter.addSubreporters({
        lineSplitting: 7,
        symbolFinding: 200
    });

    totalProgressReporter.begin("Symbolicating profile...");

    if (typeof profile === "string") {
      var lines = getSplitLines(subreporters.lineSplitting, profile);
      var stackAddresses = findSymbolsToResolve(subreporters.symbolFinding, lines);
    } else {
      var stackAddresses = findSymbolsToResolveJSON(subreporters.symbolFinding, profile);
      resolveJSDocumentsJSON(subreporters.symbolFinding, profile);
    }

    stackAddresses.sort();

    // Drop memory modules not referenced by the stack
    var memoryMap = [];
    for (var libIndex = 0; libIndex < sharedLibraries.length; ++libIndex) {
        var lib = sharedLibraries[libIndex];
	for (var pcIndex = 0; pcIndex < stackAddresses.length; ++pcIndex) {
	    var pc = parseInt(stackAddresses[pcIndex], 16);
	    if (lib.start <= pc && pc < lib.end) {
                var libSize = lib.end - lib.start;
                var module = [lib.start, lib.name, libSize, lib.pdbAge, lib.pdbSignature, lib.pdbName];
                memoryMap.push(module);

		// We found a PC entry for this library, so no need to look at more PCs
		break;
            }
	}
    }

    symbolicationRequest = [{ "stack": stackAddresses, "memoryMap": memoryMap }];
    var requestJson = JSON.stringify(symbolicationRequest);

    try {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", uri, true);
        xhr.setRequestHeader("Content-type", "application/json");
        xhr.setRequestHeader("Content-length", requestJson.length);
        xhr.setRequestHeader("Connection", "close");
        xhr.send(requestJson);
    } catch (e) {
        dump("Sending SymbolicationServer request failed: " + e + " (" + uri + ")\n");
        var errorString = "Could not send symbolication request to server at '" + uri + "'";
        errorString += "\n\nPlease confirm the \"profiler.symbolicationUrl\" configuration setting is correct.";
        finishCallback( { "error": errorString } );
        return;
    }

    xhr.onreadystatechange = function (evt) {
        if (xhr.readyState != 4)
            return;

        if (xhr.status != 200) {
            dump("SymbolicationServer request failed: HTTP " + xhr.status + " (" + uri + ")\n");
            if (xhr.status == 0) {
                var errorString = "Could not connect to symbolication server at " + uri;
                errorString += "\n\nPlease verify that you are connected to the Internet.";
                finishCallback( { "error": errorString } );
            } else {
                var errorString = "Symbolication request to " + uri + " failed with error code HTTP " + xhr.status;
                errorString += "\n\nPlease try again later.";
                finishCallback( { "error": errorString } );
            }
            return;
        }

        try {
            var jsonResponse = JSON.parse(xhr.responseText);
            var resolvedStack = jsonResponse[0];
            var resolvedSymbols = {};
            for (var i = 0; i < resolvedStack.length; ++i) {
                resolvedSymbols[stackAddresses[i]] = resolvedStack[i];
            }
            finishCallback(resolvedSymbols);
        } catch (e) {
            dump("Exception parsing SymbolicationServer response: " + e + "\n");
            var errorString = "Could not understand response from symbolication server at " + uri;
            errorString += "\n\nPlease consider filing a bug at https://bugzilla.mozilla.org/";
            finishCallback( { "error": errorString } );
        }
    };
}

function bucketsBySplittingArray(array, maxItemsPerBucket) {
    var buckets = [];
    while (buckets.length * maxItemsPerBucket < array.length) {
        buckets.push(array.slice(buckets.length * maxItemsPerBucket,
                                 (buckets.length + 1) * maxItemsPerBucket));
    }
    return buckets;
}

// The command line can't get too long so let's not do more than 1000 at a time.
const kNumSymbolsPerCall = 1000;

// Run libraries through strip -S so that symbol lookup is faster.
const kStripLibrary = true;

// Convert all symbols in the array "symbols" to their location relative to the
// library they're in by subtracting the library start address.
function relativeToLibrary(library, symbols) {
    return symbols.map(function (symbol) {
        return "0x" + (parseInt(symbol, 16) - library.start + library.offset).toString(16);
    });
}

function readSymbolsLinux(reporter, platform, library, unresolvedList, resolvedSymbols, callback, androidHWID) {
    reporter.begin("Resolving symbols for library " + library.name + "...");
    dump("Resolving symbols for library " + library.name + "\n");

    runAsContinuation(function (resumeContinuation) {
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        for (var j = 0; j < buckets.length; j++) {
            var unresolvedSymbols = relativeToLibrary(library, buckets[j]);
            //dump("addr2line for lib: " + library.name + ", " + unresolvedSymbols.length + "\n");
            var cmd;
            if (platform === "Linux") {
                cmd = "/usr/bin/addr2line -C -f -e '" + library.name + "' " + unresolvedSymbols.join(" ");
            } else if (platform === "Android") {
                // XXX we really want to use file.join here; and do something smarter for the fennec libs,
                // but instead just make it work on unixen for now
                var lib;

                if (library.name.indexOf("/dev/ashmem/") == 0) {
                    // this is likely a fennec library; we pulled it just into sFennecLibsPrefix
                    var libBaseName = library.name.split("/");
                    libBaseName = libBaseName[libBaseName.length - 1];
                    lib = sFennecLibsPrefix + "/" + libBaseName;
                } else {
                    if (!androidHWID) {
                        // If we don't have a HWID assume all the so are in the tmp root
                        var libBaseName = library.name.split("/");
                        lib = "/tmp/" + libBaseName[libBaseName.length - 1];
                    } else {
                        lib = sAndroidLibsPrefix + "/" + androidHWID + library.name; // (library.name will have a leading "/")
                    }
                }

                cmd = "/bin/bash -l -c 'arm-eabi-addr2line -C -f -e \"" + lib + "\" " + unresolvedSymbols.join(" ") + "'";
                dump(cmd + "\n");
            }

            // Parse
            var addr2lineResult = yield runCommand(cmd, resumeContinuation);
            //dump(addr2lineResult + "\n");
            var outLines = addr2lineResult.split("\n");
            for (var i = 0; i < unresolvedSymbols.length; i++) {
                if (i*2+1 < outLines.length) {
                    if (outLines[i*2+1] != "??:0") {
                        resolvedSymbols[buckets[j][i]] = outLines[i*2+0] + " " + outLines[i*2+1] + " (in " + library.name + ")";
                    } else {
                        resolvedSymbols[buckets[j][i]] = outLines[i*2+0] + " (in " + library.name + ")";
                    }
                } else {
                    resolvedSymbols[buckets[j][i]] = "Unknown (in " + library.name + ")";
                    //resolvedSymbols[buckets[j][i]] = buckets[j][i] + " (" + unresolvedSymbols[i] + "@" + library.name + ")";
                }
            }
            reporter.setProgress((j * kNumSymbolsPerCall + unresolvedSymbols.length) / unresolvedList.length);
        }
        reporter.finish();
        callback();
    });
}

function getFilename(fullPath) {
    return fullPath.substring(fullPath.lastIndexOf("/") + 1);
}

function usingStrippedLibrary(originalLibraryPath, reporter, callback, finishCallback) {
    var libraryFilename = getFilename(originalLibraryPath);
    if (!kStripLibrary || libraryFilename != "XUL")
        return callback(originalLibraryPath, reporter, function () { finishCallback(reporter); });

    var subreporters = reporter.addSubreporters({
        strip: 1000,
        readSymbols: 5000
    });

    subreporters.strip.begin("Stripping symbols from library " + libraryFilename);

    runAsContinuation(function (resumeContinuation) {
        // Make a copy of the library in a temporary location and run it through
        // "strip -S". This will make atos run much faster, at least for local
        // builds which have filename and line number information.
        var randomNumber = Math.floor(Math.random() * 1000000);
        var tmpDir = "/tmp/tmp_stripped_library_" + randomNumber;
        yield runCommand("mkdir " + tmpDir, resumeContinuation);
        var strippedLibraryPath = tmpDir + "/" + libraryFilename;
        var stripCommand = "strip -S '" + originalLibraryPath + "' -o '" +
                             strippedLibraryPath + "'";
        yield runCommand(stripCommand, resumeContinuation);
        subreporters.strip.finish();
        yield callback(strippedLibraryPath, subreporters.readSymbols, resumeContinuation);
        runCommand("rm -rf " + tmpDir, function () { finishCallback(subreporters.readSymbols); });
    });
}

function isx86_64() {
    return sAbi == "x86_64-gcc3";
}

function readSymbolsMac(reporter, platform, library, unresolvedList, resolvedSymbols, callback) {
    reporter.begin("Resolving symbols for library " + getFilename(library.name) + "...");
    var atos_args = isx86_64() ? " -arch x86_64 " : "";

    usingStrippedLibrary(library.name, reporter, function (strippedLibraryPath, reporter, andThen) {
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        runAsContinuation(function (resumeContinuation) {
            for (var j = 0; j < buckets.length; j++) {
                var unresolvedSymbols = buckets[j];

                var cmd = "/usr/bin/atos" + atos_args + " -l 0x" + library.start.toString(16) + " -o '" +
                  strippedLibraryPath + "' " + unresolvedSymbols.join(" ");

                // Parse
                var atosResult = yield runCommand(cmd, resumeContinuation);
                var outLines = atosResult.split("\n");
                for (var i = 0; i < unresolvedSymbols.length; i++) {
                    resolvedSymbols[unresolvedSymbols[i]] = outLines[i];
                }
                reporter.setProgress((j * kNumSymbolsPerCall + unresolvedSymbols.length) / unresolvedList.length);
            }
            andThen();
        });
    }, function (reporter) {
        reporter.finish();
        callback();
    });
}

function read_symbols_lib(reporter, library, unresolvedList, platform, resolvedSymbols, callback, hwid) {
    if (platform == "Linux") {
        readSymbolsLinux(reporter, platform, library, unresolvedList, resolvedSymbols, callback, hwid);
    } else if (platform == "Android") {
        readSymbolsLinux(reporter, platform, library, unresolvedList, resolvedSymbols, callback, hwid);
    } else if (platform == "Macintosh") {
        readSymbolsMac(reporter, platform, library, unresolvedList, resolvedSymbols, callback, hwid);
    } else {
        throw "Unsupported platform: " + platform;
    }
}

function getSharedLibraries(lines, sharedLibraries) {
    if (sharedLibraries != null) {
        return sharedLibraries;
    }
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("h-") == 0) {
            var line = lines[i].substring(2);
            return JSON.parse(line);
        }
    }
    return null;
}

function hasSymbolResolver(platform, callback) {
    if (platform === "Android") { 
        var checkSym = runCommand("/bin/bash -l -c 'arm-eabi-addr2line --version'", resumeContinuation);
        callback(checkSym.indexOf("GNU addr2line") == 0);
    } else {
        // TODO Add proper check for others platform
        callback(true);
    }
}
