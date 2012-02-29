
const {Cc,Ci} = require("chrome");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

let timers = require("timers");
let data = require("self").data;

var CmdRunner = Components.utils.import(data.url("CmdRunner.jsm"));

var dropFrames =
  [ "TableTicker::Tick",
    "ProfilerSignalHandler",
    "_ZL21ProfilerSignalHandler",
    "0x00000001",
    "_sigtramp",
    "???",
    "?? ??:0"
 ];

exports.symbolicate = function symbolicate_export(profile, progressCallback, finishCallback) {
    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var platform = hh["platform"];
    if (platform == "X11") {
        platform = "Linux";
    }
    if (platform == "Macintosh" || platform == "Linux") {
        symbolicate(profile, platform, progressCallback, finishCallback);
    } else {
        timers.setTimeout(function() {
            finishCallback(profile);
        }, 0);
    }
}

// Compute a map of libraries to resolve
function findSymbolsToResolve(lines) {
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
    }
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

function resolveSymbols(symbolsToResolve, platform, callback) {
    runAsContinuation(function (resumeContinuation) {
        var resolvedSymbols = {};
        for (var lib in symbolsToResolve) {
            var unresolvedList = Object.keys(symbolsToResolve[lib]);
            resolvedSymbols[lib] = yield read_symbols_lib(lib, unresolvedList, platform, resumeContinuation);
        }
        timers.setTimeout(function () {
            callback(resolvedSymbols);
        }, 0);
    });
}

function shouldDropFrame(symbolName) {
    return dropFrames.indexOf(symbolName) != -1;
}

function substituteSymbols(lines, resolvedSymbols) {
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
    }
    return newProfile;
}

function symbolicate(profile, platform, progressCallback, finishCallback) {
    dump("full profile:\n" + profile + "\n");
    var lines = profile.split("\n");
    
    var symbolsToResolve = findSymbolsToResolve(lines);

    resolveSymbols(symbolsToResolve, platform, function(resolvedSymbols) {
        var fixedLines = substituteSymbols(lines, resolvedSymbols);
        var fixedProfile = fixedLines.join("\n");
        timers.setTimeout(function() {
            finishCallback(fixedProfile);
        }, 0);
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

// The command line can't get too long so let's not do more than 5000 at a time.
const kNumSymbolsPerCall = 5000;

// Run libraries through strip -S so that symbol lookup is faster.
const kStripLibrary = true;

function readSymbolsLinux(platform, libName, unresolvedList, callback) {
    dump("Linux sym\n");
    runAsContinuation(function (resumeContinuation) {
        var resolvedSymbols = {};
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        for (var i = 0; i < buckets.length; i++) {
            var unresolvedSymbols = bucket[i];
            var cmd = "/usr/bin/addr2line -C -f -e '" + libName + "' " + unresolvedSymbols.join(" ");

            // Parse
            var addr2lineResult = yield CmdRunner.runCommand(cmd, resumeContinuation);
            var outLines = addr2lineResult.split("\n");
            for (var i = 0; i < unresolvedSymbols.length; i++) {
                resolvedSymbols[unresolvedSymbols[i]] = outLines[i*2+0] + " " + outLines[i*2+1];
            }

        }
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
        yield CmdRunner.runCommand("mkdir " + tmpDir, resumeContinuation);
        var strippedLibraryPath = tmpDir + "/" + libraryFilename;
        var stripCommand = "strip -S '" + originalLibraryPath + "' -o '" +
                             strippedLibraryPath + "'";
        yield CmdRunner.runCommand(stripCommand, resumeContinuation);
        yield callback(strippedLibraryPath, resumeContinuation);
        CmdRunner.runCommand("rm -rf " + tmpDir, finishCallback);
    });
}

function isx86_64() {
    return Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI == "x86_64-gcc3";
}

function getChromeWorker() {
    return Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser").ChromeWorker;
}

function readSymbolsMac(platform, libName, unresolvedList, callback) {
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
                var atosResult = yield CmdRunner.runCommand(cmd, resumeContinuation);
                var outLines = atosResult.split("\n");
                for (var i = 0; i < unresolvedSymbols.length; i++) {
                    resolvedSymbols[unresolvedSymbols[i]] = outLines[i];
                }
            }
            andThen();
        });
    }, function () {
        callback(resolvedSymbols);
    });
}

function read_symbols_lib(libName, unresolvedList, platform, callback) {
    if (platform == "Linux") {
        readSymbolsLinux(platform, libName, unresolvedList, callback);
    } else if (platform == "Macintosh") {
        readSymbolsMac(platform, libName, unresolvedList, callback);
    }
}
