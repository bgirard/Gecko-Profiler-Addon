
const {Cc,Ci} = require("chrome");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

let timers = require("timers");
let data = require("self").data;

//var CmdRunner = Components.utils.import(data.url("CmdRunner.jsm"));

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

function getCFunctions(platform) {
    var lib;
    if (platform == "Linux") {
        lib = ctypes.open("/lib64/libc.so.6"); 
    } else if (platform == "Macintosh"){
        lib = ctypes.open("/usr/lib/libc.dylib"); 
    } else {
        throw "Unknown platform";
    }
    
    var popen = lib.declare("popen",  
                         ctypes.default_abi,  
                         ctypes.voidptr_t,     // Return int
                         ctypes.char.ptr,       // Param1 const char *command
                         ctypes.char.ptr       // Param1 const char *command
                            );
                            
    var fread = lib.declare("fread",  
                         ctypes.default_abi,  
                         ctypes.size_t,     // Return int
                         ctypes.voidptr_t,
                         ctypes.size_t,
                         ctypes.size_t,
                         ctypes.voidptr_t
                            );
                            
    var pclose = lib.declare("pclose",  
                         ctypes.default_abi,  
                         ctypes.int,     // Return int
                         ctypes.voidptr_t
                            );

    return [popen, fread, pclose];
}

function bucketsBySplittingArray(array, maxItemsPerBucket) {
    var buckets = [];
    while (buckets.length * maxItemsPerBucket < array.length) {
        buckets.push(array.slice(buckets.length * maxItemsPerBucket,
                                 (buckets.length + 1) * maxItemsPerBucket));
    }
    return buckets;
}

// The command line can't get too long so let's not do more than 10000 at a time.
const kNumSymbolsPerCall = 5000;

// Run libraries through strip -S so that symbol lookup is faster.
const kStripLibrary = true;

function runCommand(popen, fread, pclose, cmd) {
    dump("open:\n" + cmd + "\n");
    var file = popen(cmd, "r")
    
    const bufferSize = 1000;
    var buffer = ctypes.char.array(bufferSize)("");
    var size = bufferSize;
    var outList = [];
    while (size == bufferSize) {
        size = fread(buffer, 1, bufferSize, file);
        outList.push(buffer.readString().substring(0, size));
    }
    pclose(file);
    
    return outList.join("");
}

function readSymbolsLinux(platform, libName, unresolvedList, callback) {
    dump("Linux sym\n");
    var [popen, fread, pclose] = getCFunctions(platform);
    var resolvedSymbols = {};

    bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall).forEach(function symbolicateBucket(unresolvedSymbols) {
        var cmd = "/usr/bin/addr2line -C -f -e '" + libName + "' " + unresolvedSymbols.join(" ");

        // Parse
        var outLines = runCommand(popen, fread, pclose, cmd).split("\n");
        for (var i = 0; i < unresolvedSymbols.length; i++) {
            resolvedSymbols[unresolvedSymbols[i]] = outLines[i*2+0] + " " + outLines[i*2+1];
        }
    });
    timers.setTimeout(function () {
        callback(resolvedSymbols);
    }, 0);
}

function getFilename(fullPath) {
    return fullPath.substring(fullPath.lastIndexOf("/") + 1);
}

function usingStrippedLibrary(popen, fread, pclose, originalLibraryPath, callback, finishCallback) {
    var libraryFilename = getFilename(originalLibraryPath);
    if (!kStripLibrary || libraryFilename != "XUL")
        return callback(originalLibraryPath, finishCallback);

    // Make a copy of the library in a temporary location and run it through
    // "strip -S". This will make atos run much faster, at least for local
    // builds which have file and line number information.
    var randomNumber = Math.floor(Math.random() * 1000000);
    var tmpDir = "/tmp/tmp_stripped_library_" + randomNumber;
    runCommand(popen, fread, pclose, "mkdir " + tmpDir);
    var strippedLibraryPath = tmpDir + "/" + libraryFilename;
    runCommand(popen, fread, pclose, "strip -S '" + originalLibraryPath + "' -o '" + strippedLibraryPath + "'");
    callback(strippedLibraryPath, function() {
        runCommand(popen, fread, pclose, "rm -rf " + tmpDir);
        finishCallback();
    });
}

function isx86_64() {
    return Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI == "x86_64-gcc3";
}

function getChromeWorker() {
    return Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser").ChromeWorker;
}

function callbackForEach(array, fun, finishCallback) {
    runAsContinuation(function (resumeContinuation) {
        for (var i = 0; i < array.length; i++) {
            yield fun(resumeContinuation, array[i], i, array);
        }
        finishCallback();
    });
}

function readSymbolsMac(platform, libName, unresolvedList, callback) {
    var [popen, fread, pclose] = getCFunctions(platform);
    var atos_args = isx86_64() ? " -arch x86_64 " : "";
    var resolvedSymbols = {};

    usingStrippedLibrary(popen, fread, pclose, libName, function (strippedLibraryPath, andThen) {
        var buckets = bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall);
        callbackForEach(buckets, function symbolicateBucket(resumeContinuation, unresolvedSymbols) {
            var cmd = "/usr/bin/atos" + atos_args + " -l 0x0 -o '" +
                strippedLibraryPath + "' " + unresolvedSymbols.join(" ");

            // Parse
            var outLines = runCommand(popen, fread, pclose, cmd).split("\n");
            for (var i = 0; i < unresolvedSymbols.length; i++) {
                resolvedSymbols[unresolvedSymbols[i]] = outLines[i];
            }
            timers.setTimeout(function () {
                resumeContinuation();
            }, 0);
        }, andThen);
    }, function () {
        timers.setTimeout(function () {
            callback(resolvedSymbols);
        }, 0);
    });
}

function read_symbols_lib(libName, unresolvedList, platform, callback) {
    if (platform == "Linux") {
        readSymbolsLinux(platform, libName, unresolvedList, callback);
    } else if (platform == "Macintosh") {
        readSymbolsMac(platform, libName, unresolvedList, callback);
    }
}
