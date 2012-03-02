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

  var { id, profile } = msg.data;

  if (sPlatform == "Macintosh" || sPlatform == "Linux") {
    symbolicate(profile, sPlatform, function (progress, action) {
      self.postMessage({ id: id, progress: progress, action: action });
    }, function (result) {
      self.postMessage({ id: id, profile: result });
    });    
  } else {
    self.postMessage({ id: id, profile: result });
  }
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
    var symbolsToResolve = {};
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("l-") == 0 && line.indexOf("@") != -1) {
            var tagData = line.substring(2).split("@");
            var library = tagData[0];
            var offset = tagData[1];
            if (symbolsToResolve[library] == null) {
                symbolsToResolve[library] = {};
            }
            symbolsToResolve[library][offset] = null;
        }
        reporter.setProgress((i + 1) / lines.length);
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

const kSymbolsPerMS = 0.99;
const kSymbolicationWarmupTime = 15; // ms

function resolveSymbols(reporter, symbolsToResolve, platform, callback) {
    reporter.begin("Resolving symbols...");
    var libReporters = {};
    for (var lib in symbolsToResolve) {
        var expectedDuration = kSymbolicationWarmupTime + Object.keys(symbolsToResolve[lib]).length / kSymbolsPerMS;
        libReporters[lib] = reporter.addSubreporter(expectedDuration);
    }
    runAsContinuation(function (resumeContinuation) {
        var resolvedSymbols = {};
        for (var lib in symbolsToResolve) {
            var unresolvedList = Object.keys(symbolsToResolve[lib]);
            resolvedSymbols[lib] = yield read_symbols_lib(libReporters[lib], lib, unresolvedList, platform, resumeContinuation);
        }
        setTimeout(function () {
            callback(resolvedSymbols);
        }, 0);
    });
}

function shouldDropFrame(symbolName) {
    return dropFrames.indexOf(symbolName) != -1;
}

function substituteSymbols(reporter, lines, resolvedSymbols, callback) {
    reporter.begin("Substituting symbols in original profile...");
    var newProfile = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("l-???@") == 0) continue;
        if (line.indexOf("l-") == 0 && line.indexOf("@") != -1) {
            var tagData = line.substring(2).split("@");
            var library = tagData[0];
            var offset = tagData[1];
            var sym = resolvedSymbols[library][offset];
            if (sym) {
                if (shouldDropFrame(sym))
                    continue;
                newProfile.push("l-" + sym);
            } else {
                newProfile.push(line);
                dump("FAILED to find symbol for: " + offset + " in " + library + "\n");
            }
        } else {
            newProfile.push(line);
        }
        reporter.setProgress((i + 1) / lines.length);
    }
    reporter.finish();
    return newProfile;
}

function getSplitLines(reporter, profile) {
    reporter.begin("Splitting profile into lines...");
    var split = profile.split("\n");
    reporter.finish();
    return split;
}

function getJoinedLines(reporter, lines) {
    reporter.begin("Joining lines into new profile...");
    var joined = lines.join("\n");
    reporter.finish();
    return joined;
}

function symbolicate(profile, platform, progressCallback, finishCallback) {
    runAsContinuation(function (resumeContinuation) {
        var totalProgressReporter = new ProgressReporter();
        var subreporters = totalProgressReporter.addSubreporters({
            lineSplitting: 7,
            symbolFinding: 200,
            symbolResolving: 2000,
            symbolSubstituting: 200,
            lineJoining: 25,
        });
        totalProgressReporter.addListener(function (r) {
            progressCallback(r.getProgress(), r.getAction());
        });
        totalProgressReporter.begin("Symbolicating profile...");
        var lines = getSplitLines(subreporters.lineSplitting, profile);
        var symbolsToResolve = findSymbolsToResolve(subreporters.symbolFinding, lines);
        var resolvedSymbols = yield resolveSymbols(subreporters.symbolResolving, symbolsToResolve, platform, resumeContinuation);
        var fixedLines = substituteSymbols(subreporters.symbolSubstituting, lines, resolvedSymbols);
        var fixedProfile = getJoinedLines(subreporters.lineJoining, fixedLines);
        finishCallback(fixedProfile);
    });
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

function readSymbolsLinux(reporter, platform, libName, unresolvedList, callback) {
    reporter.begin("Resolving symbols for library " + libName + "...");
    runAsContinuation(function (resumeContinuation) {
        var resolvedSymbols = {};
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        for (var i = 0; i < buckets.length; i++) {
            var unresolvedSymbols = buckets[i];
            var cmd = "/usr/bin/addr2line -C -f -e '" + libName + "' " + unresolvedSymbols.join(" ");

            // Parse
            var addr2lineResult = yield runCommand(cmd, resumeContinuation);
            var outLines = addr2lineResult.split("\n");
            for (var i = 0; i < unresolvedSymbols.length; i++) {
                resolvedSymbols[unresolvedSymbols[i]] = outLines[i*2+0] + " " + outLines[i*2+1];
            }
            reporter.setProgress((i * kNumSymbolsPerCall + unresolvedSymbols.length) / unresolvedList.length);
        }
        reporter.finish();
        callback(resolvedSymbols);
    });
}

function getFilename(fullPath) {
    return fullPath.substring(fullPath.lastIndexOf("/") + 1);
}

function usingStrippedLibrary(originalLibraryPath, callback, finishCallback) {
    var libraryFilename = getFilename(originalLibraryPath);
    if (!kStripLibrary || libraryFilename != "XUL")
        return callback(originalLibraryPath, finishCallback);

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
        yield callback(strippedLibraryPath, resumeContinuation);
        runCommand("rm -rf " + tmpDir, finishCallback);
    });
}

function isx86_64() {
    return sAbi == "x86_64-gcc3";
}

function readSymbolsMac(reporter, platform, libName, unresolvedList, callback) {
    reporter.begin("Resolving symbols for library " + getFilename(libName) + "...");
    var atos_args = isx86_64() ? " -arch x86_64 " : "";
    var resolvedSymbols = {};

    usingStrippedLibrary(libName, function (strippedLibraryPath, andThen) {
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        runAsContinuation(function (resumeContinuation) {
            for (var j = 0; j < buckets.length; j++) {
                var unresolvedSymbols = buckets[j];

                var cmd = "/usr/bin/atos" + atos_args + " -l 0x0 -o '" +
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
    }, function () {
        reporter.finish();
        callback(resolvedSymbols);
    });
}

function read_symbols_lib(reporter, libName, unresolvedList, platform, callback) {
    if (platform == "Linux") {
        readSymbolsLinux(reporter, platform, libName, unresolvedList, callback);
    } else if (platform == "Macintosh") {
        readSymbolsMac(reporter, platform, libName, unresolvedList, callback);
    }
}