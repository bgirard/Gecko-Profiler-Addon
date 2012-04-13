importScripts("ProgressReporter.js");

var dropFrames =
  [ "TableTicker::Tick",
    "ProfilerSignalHandler",
    "_ZL21ProfilerSignalHandler",
    "0x00000001",
    "_sigtramp",
    "???",
    "?? ??:0"
 ];

var sCmdWorker = null;
var sPlatform = "";
var sAbi = "";

function init(platform, abi) {
    if (platform == "X11") {
        platform = "Linux";
    }
    sCmdWorker = new ChromeWorker("CmdRunWorker.js");
    sCmdWorker.postMessage(platform);
    sPlatform = platform;
    sAbi = abi;
}

var inited = false;

self.onmessage = function (msg) {
  if (!inited) {
    inited = true;
    var { platform, abi } = msg.data;
    init(platform, abi);
    return;
  }

  var { id, profile, sharedLibraries, uri } = msg.data;

  sharedLibraries = JSON.parse(sharedLibraries);
  sharedLibraries.sort(function (a, b) { return a.start - b.start; });

  // version convert older sharedLibraries formats
  for (var i = 0; i < sharedLibraries.length; i++) {
    if (sharedLibraries[i].offset == null) {
      sharedLibraries[i].offset = 0;
    }
  }

  if (sPlatform == "Macintosh" || sPlatform == "Linux") {
    symbolicate(profile, sharedLibraries, sPlatform, function (progress, action) {
      self.postMessage({ id: id, type: "progress", progress: progress, action: action });
    }, function (result) {
      postSymbolicatedProfile(id, profile, result);
    });    
  } else if (sPlatform == "Windows") {
    symbolicateWindows(profile, sharedLibraries, uri, function (result) {
      postSymbolicatedProfile(id, profile, result);
    });
  } else {
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
  worker.postMessage(cmd);
}

// Compute a map of libraries to resolve
function findSymbolsToResolve(reporter, lines) {
    reporter.begin("Gathering unresolved symbols...")
    var addresses = {};
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("l-0x") == 0) {
            var address = line.substring(2);
            addresses[address] = null;
        }
        reporter.setProgress((i + 1) / lines.length);
    }
    reporter.finish();
    return Object.keys(addresses);
}

function findSymbolsToResolveJSON(reporter, profile) {
    reporter.begin("Gathering unresolved symbols...")
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
                addresses[frame.location] = null;
            }
        }
    }

    reporter.finish();
    return Object.keys(addresses);
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

function resolveSymbols(reporter, symbolsToResolve, platform, callback) {
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
                                   resumeContinuation);
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
    reporter.begin("Splitting profile into lines...");
    var split = profile.split("\n");
    reporter.finish();
    return split;
}

function symbolicate(profile, sharedLibraries, platform, progressCallback, finishCallback) {
    if (typeof profile === "string") {
      return symbolicateStrProfile(profile, sharedLibraries, platform, progressCallback, finishCallback);
    } else {
      return symbolicateJSONProfile(profile, sharedLibraries, platform, progressCallback, finishCallback);
    }
}

function symbolicateJSONProfile(profile, sharedLibraries, platform, progressCallback, finishCallback) {
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
        var symbolsToResolve = assignSymbolsToLibraries(subreporters.symbolLibraryAssigning,
                                                        sharedLibraries, foundSymbols);
        var resolvedSymbols = yield resolveSymbols(subreporters.symbolResolving,
                                                   symbolsToResolve, platform,
                                                   resumeContinuation);
        finishCallback(resolvedSymbols);
    });
}

function symbolicateStrProfile(profile, sharedLibraries, platform, progressCallback, finishCallback) {
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
        var foundSymbols = findSymbolsToResolve(subreporters.symbolFinding, lines);
        var symbolsToResolve = assignSymbolsToLibraries(subreporters.symbolLibraryAssigning,
                                                        sharedLibraries, foundSymbols);
        var resolvedSymbols = yield resolveSymbols(subreporters.symbolResolving,
                                                   symbolsToResolve, platform,
                                                   resumeContinuation);
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
    var lines = getSplitLines(subreporters.lineSplitting, profile);
    var stackAddresses = findSymbolsToResolve(subreporters.symbolFinding, lines);
    stackAddresses.sort();

    // Drop memory modules not referenced by the stack
    var memoryMap = [];
    var pcIndex = 0;
    var libIndex = 0;
    var addedLib = false;
    while (pcIndex < stackAddresses.length && libIndex < sharedLibraries.length) {
        var pc = parseInt(stackAddresses[pcIndex], 16);
        var lib = sharedLibraries[libIndex];
        if (lib.start <= pc && pc < lib.end) {
            if (!addedLib) {
                var libSize = lib.end - lib.start;
                var module = [lib.start, lib.name, libSize, lib.pdbAge, lib.pdbSignature, lib.pdbName];
                memoryMap.push(module);
                addedLib = true;
            }
            ++pcIndex;
        } else if (pc >= lib.end) {
            ++libIndex;
            addedLib = false;
        } else {
            // PC does not belong to any module
            ++pcIndex;
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

function readSymbolsLinux(reporter, platform, library, unresolvedList, resolvedSymbols, callback) {
    reporter.begin("Resolving symbols for library " + library.name + "...");
    runAsContinuation(function (resumeContinuation) {
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        for (var j = 0; j < buckets.length; j++) {
            var unresolvedSymbols = relativeToLibrary(library, buckets[j]);
            //dump("addr2line for lib: " + library.name + ", " + unresolvedSymbols.length + "\n");
            var cmd = "/usr/bin/addr2line -C -f -e '" + library.name + "' " + unresolvedSymbols.join(" ");

            // Parse
            var addr2lineResult = yield runCommand(cmd, resumeContinuation);
            //dump(addr2lineResult + "\n");
            var outLines = addr2lineResult.split("\n");
            for (var i = 0; i < unresolvedSymbols.length; i++) {
                resolvedSymbols[buckets[j][i]] = outLines[i*2+0] + " " + outLines[i*2+1];
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

function read_symbols_lib(reporter, library, unresolvedList, platform, resolvedSymbols, callback) {
    if (platform == "Linux") {
        readSymbolsLinux(reporter, platform, library, unresolvedList, resolvedSymbols, callback);
    } else if (platform == "Macintosh") {
        readSymbolsMac(reporter, platform, library, unresolvedList, resolvedSymbols, callback);
    }
}
