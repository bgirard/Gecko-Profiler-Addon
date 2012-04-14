var popen, fread, pclose;

var inited = false;

function init(platform) {
    var lib;
    if (platform == "Linux") {
        var libcLoc = "/lib/x86_64-linux-gnu/libc.so.6";
        try {
            lib = ctypes.open(libcLoc); 
        } catch(err) {
            dump("Could not open libc at '" + libcLoc + "'\n");
            throw "Could not open libc at '" + libcLoc + "'";
        }
    } else if (platform == "Macintosh"){
        lib = ctypes.open("/usr/lib/libc.dylib"); 
    } else if (platform == "Windows") {
        return;
    } else {
        dump("Unknown plat\n");
        throw "Unknown platform";
    }
    
    popen = lib.declare("popen",  
                         ctypes.default_abi,  
                         ctypes.voidptr_t,     // Return int
                         ctypes.char.ptr,       // Param1 const char *command
                         ctypes.char.ptr       // Param1 const char *command
                            );
                            
    fread = lib.declare("fread",  
                         ctypes.default_abi,  
                         ctypes.size_t,     // Return int
                         ctypes.voidptr_t,
                         ctypes.size_t,
                         ctypes.size_t,
                         ctypes.voidptr_t
                            );
                            
    pclose = lib.declare("pclose",  
                         ctypes.default_abi,  
                         ctypes.int,     // Return int
                         ctypes.voidptr_t
                            );
    inited = true;
}

self.onmessage = function (msg) {
  if (!inited) {
    init(msg.data);
    return;
  }

  var cmd = msg.data;
  var result = runCommand(cmd);
  self.postMessage({ cmd: cmd, result: result });
}


function runCommand(cmd) {
    var file = popen(cmd, "r")
    
    const bufferSize = 1000;
    var buffer = ctypes.char.array(bufferSize)("");
    var size = bufferSize;
    var outList = [];
    while (size == bufferSize) {
        size = fread(buffer, 1, bufferSize, file);
        try {
            outList.push(buffer.readString().substring(0, size));
        } catch (e) {
            //dump("Exception reading line, ignoring characters.\n");
        }
    }
    pclose(file);
    
    return outList.join("");
}

