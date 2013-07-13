Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

dump("Symbolicate: " + arguments[0] + "\n");
// symbolicate_file(profile, libsPrefix, appName)
symbolicate_file(arguments[0], arguments[1], arguments[2])

//let symbolicateModule = Cu.import("resource://gre/modules/SymbolicateModule.jsm");
