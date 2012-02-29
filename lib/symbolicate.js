
const {Cc,Ci} = require("chrome");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

let timers = require("timers");

var dropFrames =
  [ "TableTicker::Tick",
    "ProfilerSignalHandler",
    "_ZL21ProfilerSignalHandler",
    "0x00000001",
    "_sigtramp",
    "???",
    "?? ??:0"
 ];

exports.symbolicate = function symbolicate_export(profile) {

    var hh = Cc["@mozilla.org/network/protocol;1?name=http"].getService(Ci.nsIHttpProtocolHandler);
    var platform = hh["platform"];
    if (platform == "X11") {
        platform = "Linux";
    }
    if (platform == "Macintosh" || platform == "Linux") {
        return symbolicate(profile, platform);
    } else {
        return profile;
    }
        
}

function StringBuilder(value)
{
    this.strings = new Array("");
    this.append(value);
}

function ptrValue(p) {
  return ctypes.cast(p, ctypes.uintptr_t).value.toString();
}

function symbolicate(profile, platform) {
    dump("full profile:\n" + profile + "\n");
    var lines = profile.split("\n");
    
    // Compute a map of libraries to resolve
    var symbolsToResolve = {};
    for(var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("l-") == 0 && line.indexOf("@") != -1) {
            var tagData = line.substring(2).split("@");
            var library = tagData[0];
            var offset = tagData[1];
            if (symbolsToResolve[library] == null) {
                symbolsToResolve[library] = {};
                symbolsToResolve[library].unresolved = {};
            }
            symbolsToResolve[library].unresolved[offset] = null; // Placeholder
            //dump("library: " + tagDataSplit[0] + ", address: " + tagDataSplit[1] + "\n");
        }
    }
    
    // Resolve the symbols
    for(var loopLib in symbolsToResolve) {
        let lib = loopLib;
        var unresolvedList = Object.keys(symbolsToResolve[lib].unresolved);
        var resolvedMap = {};
        dump("Resolve: " + unresolvedList.length + " in " + lib + "\n");
        read_symbols_lib(lib, unresolvedList, resolvedMap, platform);
        symbolsToResolve[lib].resolved = resolvedMap;
    }
    
    // Subsitute
    var newProfile = [];
    next_sym: for(var i = 0; i < lines.length; i++) {
        var line = lines[i];
        //dump(line + "\n");
        if (line.indexOf("l-???@") == 0) continue;
        if (line.indexOf("l-") == 0 && line.indexOf("@") != -1) {
            var tagData = line.substring(2).split("@");
            var library = tagData[0];
            var offset = tagData[1];
            var sym = symbolsToResolve[library].resolved[offset];
            if (sym != null) {
                for(var j = 0; j < dropFrames.length; j++) {
                  if (sym.indexOf(dropFrames[j]) == 0)
                    continue next_sym;
                }
                newProfile.push("l-" + symbolsToResolve[library].resolved[offset]);
                //dump("Found symbol for: " + offset + "\n");
            } else {
                newProfile.push(line);
                dump("FAILED to find symbol for: " + offset + " in " + library + "\n");
            }
        } else {
            newProfile.push(line);
        }
    }
    
    var result = newProfile.join("\n");
    return result;
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

// The command line can't get too long so let's not do more than 1000 at a time.
const kNumSymbolsPerCall = 1000;

function readSymbolsLinux(platform, libName, unresolvedList, resolvedMap) {
    dump("Linux sym\n");
    var [popen, fread, pclose] = getCFunctions(platform);

    bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall).forEach(function symbolicateBucket(unresolvedSymbols) {
        var cmd = "/usr/bin/addr2line -C -f -e '" + libName + "' " + unresolvedSymbols.join(" ");
        var file = popen(cmd, "r")
        
        var buffer = ctypes.char.array(10)("          ");
        var size = 10;
        var outList = [];
        while (size == 10 ) {
            size = fread(buffer, 1, 10, file);
            outList.push(buffer.readString().substring(0, size));
        }
        pclose(file);
        
        // Parse
        var outLines = outList.join("").split("\n");
        for (var i = 0; i < unresolvedSymbols.length; i++) {
            resolvedMap[unresolvedSymbols[i]] = outLines[i*2+0] + " " + outLines[i*2+1];
        }

    })
}

function readSymbolsMac(platform, libName, unresolvedList, resolvedMap) {
    var [popen, fread, pclose] = getCFunctions(platform);

    bucketsBySplittingArray(unresolvedList, kNumSymbolsPerCall).forEach(function symbolicateBucket(unresolvedSymbols) {
        var atos_args;
        if (Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI == "x86_64-gcc3") {
            atos_args = " -arch x86_64 "
        } else {
            atos_args = ""
        }
        var cmd = "/usr/bin/atos" + atos_args + " -l 0x0 -o '" + libName + "' " + unresolvedSymbols.join(" ");
        var file = popen(cmd, "r")
        dump("open:\n" + cmd + "\n");
        
        var buffer = ctypes.char.array(10)("          ");
        var size = 10;
        var outList = [];
        while (size == 10 ) {
            size = fread(buffer, 1, 10, file);
            outList.push(buffer.readString().substring(0, size));
            //dump(hello.readString().substring(0, size));
        }
        pclose(file);
        
        // Parse
        var outLines = outList.join("").split("\n");
        for (var i = 0; i < unresolvedSymbols.length; i++) {
            resolvedMap[unresolvedSymbols[i]] = outLines[i];
            //dump("OUT LINES: " + unresolvedList[i] + " -> " + outLines[i] + "\n");
        }

    });
}

function read_symbols_lib(libName, unresolvedList, resolvedMap, platform) {
    if (platform == "Linux") {
        readSymbolsLinux(platform, libName, unresolvedList, resolvedMap);
    } else if (platform == "Macintosh") {
        readSymbolsMac(platform, libName, unresolvedList, resolvedMap);
    }
}



