(function() {
    var loginManager = Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
    var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Components.interfaces.nsILoginInfo, "init");
    var passwordDomain = "chrome://firelogger";
    
    // see https://developer.mozilla.org/en/XPCOM_Interface_Reference/Using_nsILoginManager
    FireLogger.PasswordVault = {
        /////////////////////////////////////////////////////////////////////////////////////////
        get: function() {
            var logins = loginManager.findLogins({}, passwordDomain, "", "");
            if (logins) {
                for (var i = 0; i < logins.length; i++) {
                    return logins[i].password;
                }
            }
            return "";
        },
        /////////////////////////////////////////////////////////////////////////////////////////
        set: function(password) {
            // remove all our logins
            var logins = loginManager.findLogins({}, passwordDomain, "", "");
            if (logins) {
                for (var i = 0; i < logins.length; i++) {
                    loginManager.removeLogin(logins[i]);
                }
            }
            
            // insert new login
            if (password) {
                var loginInfo = new nsLoginInfo(passwordDomain, null, 'Password required by FireLogger server', 'user', password, "", "");
                loginManager.addLogin(loginInfo);
            }
        }
    };
    
})();
