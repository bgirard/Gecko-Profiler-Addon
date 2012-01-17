
const {Cc,Ci} = require("chrome");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

let timers = require("timers");


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
        read_symbols_lib(lib, unresolvedList, resolvedMap, platform);
        symbolsToResolve[lib].resolved = resolvedMap;
        dump("Resolve: " + unresolvedList.length + " in " + lib + "\n");
    }
    
    // Subsitute
    var newProfile = [];
    for(var i = 0; i < lines.length; i++) {
        var line = lines[i];
        //dump(line + "\n");
        if (line.indexOf("l-") == 0 && line.indexOf("@") != -1) {
            var tagData = line.substring(2).split("@");
            var library = tagData[0];
            var offset = tagData[1];
            if (symbolsToResolve[library].resolved[offset] != null) {
                if (symbolsToResolve[library].resolved[offset] == "?? ??:0") {
                    continue;
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

function read_symbols_lib(libName, unresolvedList, resolvedMap, platform) {

    // The command line can't get to big so let's not do more then 10000.
    // We can fixed this by openning a bidrectional pipe using popen, but
    // I couldn't get this working.
    var MAX_PER_CALL = 10000;
    if (unresolvedList.length > MAX_PER_CALL) {
        read_symbols_lib(libName, unresolvedList.slice(MAX_PER_CALL), resolvedMap, platform);
        unresolvedList = unresolvedList.slice(0, MAX_PER_CALL);
    }
    
    var lib;
    if (platform == "Linux") {
        lib = ctypes.open("/lib/x86_64-linux-gnu/libc.so.6"); 
    } else if (platform == "Macintosh"){
        lib = ctypes.open("/usr/lib/libc.dylib"); 
    } else {
        throw new "Unknown platform";
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
                            
    var fwrite = lib.declare("fwrite",  
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

    if (platform == "Linux") {
        dump("Linux sym\n");
        var cmd = "/usr/bin/addr2line -C -f -e " + libName + " " + unresolvedList.join(" ");
        var file = popen(cmd, "r")
        //dump("open:\n" + cmd + "\n");
        
        let hello = ctypes.char.array(10)("          ");
        var size = 10;
        var outList = [];
        while( size == 10 ) {
            size = fread(hello, 1, 10, file);
            outList.push(hello.readString().substring(0, size));
            //dump(hello.readString().substring(0, size));
        }
        
        // Parse
        var outLines = outList.join("").split("\n");
        for (var i = 0; i < unresolvedList.length; i++) {
            resolvedMap[unresolvedList[i]] = outLines[i*2+0] + " " + outLines[i*2+1];
            //dump("OUT LINES: " + unresolvedList[i] + " -> " + outLines[i] + "\n");
        
        }
        
    } else if (platform == "Macintosh") {
        var atos_args;
        if (Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).XPCOMABI == "x86_64-gcc3") {
            atos_args = " -arch x86_64 "
        } else {
            atos_args = ""
        }
        var cmd = "/usr/bin/atos" + atos_args + " -l 0x0 -o " + libName + " " + unresolvedList.join(" ");
        var file = popen(cmd, "r")
        //dump("open:\n" + cmd + "\n");
        
        let hello = ctypes.char.array(10)("          ");
        var size = 10;
        var outList = [];
        while( size == 10 ) {
            size = fread(hello, 1, 10, file);
            outList.push(hello.readString().substring(0, size));
            //dump(hello.readString().substring(0, size));
        }
        
        // Parse
        var outLines = outList.join("").split("\n");
        for (var i = 0; i < unresolvedList.length; i++) {
            resolvedMap[unresolvedList[i]] = outLines[i];
            //dump("OUT LINES: " + unresolvedList[i] + " -> " + outLines[i] + "\n");
        
        }
        
    }
    
    pclose(file);
}



