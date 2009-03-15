// This source contains copy&pasted various bits from Firebug sources.
// Some code comes from FirePHP project (http://www.firephp.org)
FBL.ns(function() {
    with(FBL) {
        const Cc = Components.classes;
        const Ci = Components.interfaces;

        const nsIPrefBranch = Ci.nsIPrefBranch;
        const nsIPrefBranch2 = Ci.nsIPrefBranch2;
        const nsIWindowMediator = Ci.nsIWindowMediator;

        const fireloggerPrefService = Cc["@mozilla.org/preferences-service;1"];
        const observerService = CCSV("@mozilla.org/observer-service;1", "nsIObserverService");

        const fireloggerPrefs = fireloggerPrefService.getService(nsIPrefBranch2);
        const fireloggerURLs = {
            main: "http://github.com/darwin/firelogger"
        };
        const fireloggerPrefDomain = "extensions.firelogger";
        var fireloggerOptionUpdateMap = {};

        if (Firebug.TraceModule) {
            Firebug.TraceModule.DBG_FIRELOGGER = false;
            var type = fireloggerPrefs.getPrefType('extensions.firebug.DBG_FIRELOGGER');
            if (type != nsIPrefBranch.PREF_BOOL) try {
                fireloggerPrefs.setBoolPref('extensions.firebug.DBG_FIRELOGGER', false);
            } catch(e) {}
        }
    
        function dbg() {
            if (FBTrace && FBTrace.DBG_FIRELOGGER) { 
                if (/FireLoggerPanel/.test(arguments[0])) return;
                if (/FireLogger.Record/.test(arguments[0])) return;
                if (/FireLogger.LoggerTuple/.test(arguments[0])) return;
                FBTrace.sysout.apply(this, arguments);
            }
        }
    
        function capitalize(s) {
            return s.charAt(0).toUpperCase() + s.substring(1).toLowerCase();
        }
        
        FBL.$FIRELOGGER_STR = function(name) {
            return document.getElementById("strings_firelogger").getString(name);
        };
        FBL.$FIRELOGGER_STRF = function(name, args) {
            return document.getElementById("strings_firelogger").getFormattedString(name, args);
        };
        
        ////////////////////////////////////////////////////////////////////////
        var FireLoggerEvent = function(type, data, icon) {
            this.type = type;
            this.data = data;
            this.icon = icon;
            this.expanded = false;
        };

        function colorForName(name) {
            var niceColors = ["red", "blue", "magenta", "brown", "black", 
                              "darkgreen", "blueviolet", "cadetblue", "crimson", "darkgoldenrod",
                              "darkgrey", "darkslateblue", "firebrick", "midnightblue", "orangered", "navy"];
            var code = 0;
            for (var i=0; i<name.length; i++) {
                code += name.charCodeAt(i);
            }
            var color = niceColors[code % niceColors.length];
            return color;
        }
        
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLoggerContextMixin
        //
        Firebug.FireLoggerContextMixin = {
            /////////////////////////////////////////////////////////////////////////////////////////
            extractHeaders: function(request) {
                var headers = [];
                var http = QI(request, Ci.nsIHttpChannel);
                http.visitResponseHeaders({
                    visitHeader: function(name, value) {
                        headers.push([name, value]);
                    }
                });
                return headers;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            pushRecord: function(url, info) {
                this.requestQueue.push([url, info]);
                if (this.processRequestQueueAutoFlushing) this.processRequestQueue();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            queueRequest: function(request) {
                dbg(">>>FireLoggerContextMixin.queueRequest");
                var url = request.name;
                var headers = this.extractHeaders(request);
                var info = this.parseHeaders(headers);
                this.pushRecord(url, info);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            queueFile: function(file) {
                dbg(">>>FireLoggerContextMixin.queueFile", file);
                this.pushRecord(file.href, this.parseHeaders(file.responseHeaders));
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processRequestQueue: function() {
                dbg(">>>FireLoggerContextMixin.processRequestQueue", this.requestQueue);
                for (var i=0; i<this.requestQueue.length; i++) {
                    var item = this.requestQueue[i];
                    this.processRequest(item[0], item[1]);
                }
                this.requestQueue = [];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            parseHeaders: function(headers) {
                var buffers = {};
                var re = /^firelogger-([0-9a-f]+)-(\d+)/i;
                var parseHeader = function(name, value) {
                    var res = re.exec(name);
                    if (res) { 
                        buffers[res[1]] = buffers[res[1]] || [];
                        buffers[res[1]][res[2]]=value;
                    }
                };
                for (var index in headers) {
                    parseHeader(headers[index].name, headers[index].value);
                }
                // we use UTF-8 encoded JSON to exchange messages which are wrapped with base64
                var packets = [];
                for (buffer in buffers) {
                    if (!buffers.hasOwnProperty(buffer)) continue;
                    buffer = buffers[buffer].join('');
                    buffer = Base64.decode(buffer);
                    buffer = UTF8.decode(buffer);
                    var packet = JSON.parse(buffer);
                    packets.push(packet);
                }
                return packets;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processDataPacket: function(packet) {
                dbg(">>>FireLoggerContextMixin.processDataPacket", packet);
                var logs = [];
                if (!packet) return logs;
                if (packet.errors) { // internal errors on logger side
                    for (var i=0; i<packet.errors.length; i++) {
                        var error = packet.errors[i];
                        Firebug.FireLogger.showMessage(this, error.message, "sys-error", error.exc_info);
                    }
                }
                if (packet.logs) {
                    for (var i=0; i < packet.logs.length; i++) {
                        var log = packet.logs[i];
                        logs.push(log);
                    }
                }
                return logs;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processRequest: function(url, packets) {
                dbg(">>>FireLoggerContextMixin.processRequest ("+url+")", packets);
                var logs = [];
                for (var i=0; i < packets.length; i++) {
                    var packet = packets[i];
                    logs = logs.concat(this.processDataPacket(packet));
                }
                logs.sort(function(a,b) {
                    return b.timestamp<a.timestamp;
                });
                for (var i=0; i<logs.length; i++) {
                    var log = logs[i];
                    Firebug.FireLogger.showLog(this, log, "log-"+log.level);
                }
            }
        };
        
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLogger
        //
        Firebug.FireLogger = extend(Firebug.ActivableModule, {
            version: '0.2',
            currentPanel: null,

            /////////////////////////////////////////////////////////////////////////////////////////
            getPrefDomain: function() {
                return fireloggerPrefDomain;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            checkFirebugVersion: function() {
                var version = Firebug.getVersion();
                if (!version) return false;
                var a = version.split('.');
                if (a.length<2) return false;
                // we want Firebug version 1.2+ (including alphas/betas and other weird stuff)
                return parseInt(a[0], 10)>=1 && parseInt(a[1], 10)>=2;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            versionCheck: function(context) {
                if (!this.checkFirebugVersion() && !context.fireLoggerVersionWarningShown) {
                    this.showMessage(context, "FireLogger Firefox extension works with Firebug 1.2 or higher (you have "+Firebug.getVersion()+"). Please upgrade Firebug to the latest version.", "sys-warning");
                    context.fireLoggerVersionWarningShown = true;
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            cachePrefs: function() {
                this._password = this.getPref('password');
                this._richFormatting = this.getPref('richFormatting');
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            start: function() {
                dbg(">>>FireLogger.start");
                this.cachePrefs();
                observerService.addObserver(this, "http-on-modify-request", false);
                Firebug.NetMonitor.addListener(this);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            stop: function() {
                dbg(">>>FireLogger.stop");
                observerService.removeObserver(this, "http-on-modify-request");
                Firebug.NetMonitor.removeListener(this);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            // Used for FB1.2 (>= b4) < FB1.4 r2050
            onLoad: function(context, file) {
                dbg(">>>FireLogger.onLoad", [context, file]);
                this.mixinContext(context); // onLoad may be called before initContext, so we may need to mixin here
                context.queueFile(file);
            },
            // Used for FB1.4 >=r2050
            onResponse: function(context, file) {
                dbg(">>>FireLogger.onResponse", [context, file]);
                this.mixinContext(context); // onResponse may be called before initContext, so we may need to mixin here
                context.queueFile(file);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareAuth: function(password) {
                // this must match with logger library code
                var auth = "#FireLoggerPassword#"+password+"#";
                return hex_md5(auth);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            observe: function(subject, topic, data) {
                dbg(">>>FireLogger.observe: "+topic);
                Firebug.ActivableModule.observe.apply(this, [subject, topic, data]);
                if (topic == "http-on-modify-request") {
                    var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
                    // add FireLogger/X.X.X to User-Agent header if not already there
                    // see https://developer.mozilla.org/En/Setting_HTTP_request_headers
                    if (httpChannel.getRequestHeader("User-Agent").match(/\sX-FireLogger\/([\.|\d]*)\s?/) == null) {
                        httpChannel.setRequestHeader("User-Agent", httpChannel.getRequestHeader("User-Agent") + ' ' + "X-FireLogger/" + this.version, false);
                    }
                    if (this._password) {
                        httpChannel.setRequestHeader("X-FireLoggerAuth", this.prepareAuth(this._password), false);
                    }
                }
                if (topic == "nsPref:changed") {
                    this.cachePrefs();
                    var parts = data.split(".");
                    var name = parts[parts.length-1];
                    var value = this.getPref(name);
                    this.updatePref(name, value);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            updatePref: function(name, value) {
                dbg(">>>FireLogger.updatePref: "+name+"->"+value);
                this.updatePanel();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function() {
                dbg(">>>FireLogger.initialize");
                this.panelName = 'FireLogger';
                this.description = "Logger logging tools for web developers.";
                Firebug.ActivableModule.initialize.apply(this, arguments);
                this.patchChrome(top.FirebugChrome, FirebugContext);
                fireloggerPrefs.addObserver(this.getPrefDomain(), this, false);
                this.start();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            shutdown: function() {
                dbg(">>>FireLogger.shutdown");
                this.stop();
                fireloggerPrefs.removeObserver(this.getPrefDomain(), this, false);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initializeUI: function() {
                dbg(">>>FireLogger.initializeUI");
                Firebug.ActivableModule.initializeUI.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onPanelActivate: function(context, init, panelName) {
                Firebug.ActivableModule.onPanelActivate.apply(this, arguments);
                if (panelName != this.panelName) return;
                dbg(">>>FireLogger.onPanelActivate");
                if (!init) { 
                    context.window.location.reload();
                    return;
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onPanelDeactivate: function(context, destroy, deactivatedPanelName) {
                dbg(">>>FireLogger.onPanelDeactivate");
                Firebug.ActivableModule.onPanelDeactivate.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onFirstPanelActivate: function(context, init) {
                dbg(">>>FireLogger.onFirstPanelActivate");
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onLastPanelDeactivate: function(context, destroy) {
                dbg(">>>FireLogger.onLastPanelDeactivate");
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onSuspendFirebug: function(context) {
                dbg(">>>FireLogger.onSuspendFirebug");
                this.stop();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onResumeFirebug: function(context) {
                dbg(">>>FireLogger.onResumeFirebug");
                this.start();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            mixinContext: function(context) {
                dbg(">>>FireLogger.mixinContext");
                if (context.alreadyMixedWithFireLoggerContext) return;
                context.alreadyMixedWithFireLoggerContext = true;
                // mix-in FireLoggerContextMixin into newly created context
                for (var p in Firebug.FireLoggerContextMixin) context[p] = Firebug.FireLoggerContextMixin[p];
                context.requestQueue = [];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initContext: function(context) {
                dbg(">>>FireLogger.initContext");
                Firebug.ActivableModule.initContext.apply(this, arguments);
                this.mixinContext(context);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showContext: function(browser, context) {
                dbg(">>>FireLogger.showContext");
                Firebug.ActivableModule.showContext.apply(this, arguments);
                this.versionCheck(context);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            destroyContext: function(context) {
                dbg(">>>FireLogger.destroyContext");
                Firebug.ActivableModule.destroyContext.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            patchChrome: function(chrome, context) {
                if (!chrome.selectFireLoggerOriginal) {
                    dbg(">>>FireLogger.patchChrome");
                    chrome.selectFireLoggerOriginal = chrome.select;
                    // this monkeypatching is responsible for intercepting object inspection 
                    // FireLoggerWatches panel intercepts all object inspections only when FireLogger panel is visible
                    chrome.select = function(object, panelName, sidePanelName, forceUpdate) {
                        if (Firebug.FireLogger.currentPanel) {
                            var panel = FirebugContext.getPanel("FireLoggerWatches");
                            if (panel) {
                                panel.select(object, forceUpdate);
                                return;
                            }
                        }
                        return chrome.selectFireLoggerOriginal.apply(chrome, arguments);
                    };
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            reattachContext: function(browser, context) {
                dbg(">>>FireLogger.reattachContext");
                Firebug.ActivableModule.reattachContext.apply(this, arguments);
                this.patchChrome(browser.chrome, context);
                var panel = context.getPanel("FireLogger");
                if (!panel) return;
                panel.applyCSS();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            loadedContext: function(context) {
                dbg(">>>FireLogger.loadedContext");
                Firebug.ActivableModule.loadedContext.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            watchWindow: function(context, win) {
                dbg(">>>FireLogger.watchWindow");
                Firebug.ActivableModule.watchWindow.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            unwatchWindow: function(context, win) {
                dbg(">>>FireLogger.unwatchWindow");
                Firebug.ActivableModule.unwatchWindow.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showPanel: function(browser, panel) {
                dbg(">>>FireLogger.showPanel", panel);
                Firebug.ActivableModule.showPanel.apply(this, arguments);
                var isFireLogger = panel && panel.name == this.panelName;
                if (isFireLogger) {
                    panel.context.processRequestQueueAutoFlushing = true;
                    panel.context.processRequestQueue();
                    if ((!Firebug.NetMonitor.isEnabled(panel.context) || !Firebug.Console.isEnabled(panel.context)) && !panel.context.fireLoggerWarningShown) {
                        this.showMessage(panel.context, 'You must have the Firebug Console and Net panels enabled to use FireLogger!', "sys-warning");
                        panel.context.fireLoggerWarningShown = true;
                    }
                    this.currentPanel = panel;
                    this.updatePanel();

                    // default DOMPanel behavior is to show top level window object
                    // this is a good place to reset it to empty object
                    var watchesPanel = panel.context.getPanel("FireLoggerWatches");
                    if (watchesPanel) {
                        watchesPanel.select({});
                    }
                } else {
                    panel.context.processRequestQueueAutoFlushing = false;
                    this.currentPanel = null;
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            updateFilterButtons: function(panel, states) {
                var browser = panel.context.browser;
                if (!browser) return;
                for (var s in states) {
                    var button = browser.chrome.$("fbFireLoggerFilter"+capitalize(s)+"Button");
                    button.checked = !states[s];
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            updateFilterClasses: function(panel, states) {
                var node = panel.panelNode;
                for (var s in states) {
                    var classname = "filter-"+s;
                    removeClass(node, classname);
                    if (states[s]) setClass(node, classname);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            updatePanel: function() {
                dbg(">>>FireLogger.updatePanel", this.currentPanel);
                if (!this.currentPanel) return;
                var filterStates = this.loadFilterStates();
                this.updateFilterButtons(this.currentPanel, filterStates);
                this.updateFilterClasses(this.currentPanel, filterStates);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showLog: function(context, data, icon) {
                var type = "simple";
                if (data.exc_info && this._richFormatting) type = "exception";
                var event = new FireLoggerEvent(type, data, icon);
                return this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showMessage: function(context, text, icon, exc_info) {
                if (!icon) icon = "info";
                type = "message";
                if (exc_info) type = "messagewithexception";
                var event = new FireLoggerEvent(type, {
                    message: text,
                    time: this.getCurrentTime(),
                    exc_info: exc_info
                }, icon);
                return this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getCurrentTime: function() {
                var d = new Date();
                var h = d.getHours() + "";
                var m = d.getMinutes() + "";
                var s = d.getSeconds() + "";
                var x = d.getMilliseconds() + "";
                while (h.length < 2) h = "0" + h;
                while (m.length < 2) m = "0" + m;
                while (s.length < 2) s = "0" + s;
                while (x.length < 3) x = "0" + x;
                return h + ":" + m + ":" + s + "." + x;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            publishEvent: function(context, event) {
                if (!context) return;
                dbg(">>>FireLogger.publishEvent", arguments);
                if (!this.isEnabled(context)) return;
                var panel = context.getPanel("FireLogger");
                if (panel) panel.publish(event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            loadExternalEditors: function()
            {
                const prefName = "externalEditors";
                const editorPrefNames = ["label", "executable", "cmdline", "image"];

                externalEditors = [];
                var list = Firebug.getPref(Firebug.prefDomain, prefName).split(",");
                for (var i = 0; i < list.length; ++i) {
                    var editorId = list[i];
                    if (!editorId || editorId == "")
                        continue;
                    var item = { id: editorId };
                    for (var j = 0; j < editorPrefNames.length; ++j) {
                        try {
                            item[editorPrefNames[j]] = Firebug.getPref(Firebug.prefDomain, prefName+"."+editorId+"."+editorPrefNames[j]);
                        } catch(exc) {}
                    }
                    if (item.label && item.executable) {
                        if (!item.image) item.image = getIconURLForFile(item.executable);
                        externalEditors.push(item);
                    }
                }
                return externalEditors;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            findPreferredEditor: function() {
                var preferredEditorId = this.getPref('preferredEditor');
                var editors = this.loadExternalEditors();
                var editor = null;
                for (var i=0; i<editors.length; i++) {
                    if (preferredEditorId == editors[i].id) return editors[i];
                }
                if (editors.length>0) return editors[0];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            openSourceFile: function(path, line) {
                dbg(">>>FireLogger.openSourceFile", [path, line]);
                if (!path) return;
                path = rewriter.rewritePath(path);
                dbg(">>>FireLogger.rewritePath", path);
                var editor = this.findPreferredEditor();
                if (!editor) { 
                    alert('No external editor found!\nPlease add one into Firebug via Firebug Menu -> Open With Editor -> Configure Editors ...');
                    dbg(">>>no editor was found!");
                    return;
                }
                var args = [];
                if (editor.cmdline) {
                    args = editor.cmdline.split(" ");
                    for (var i=0; i<args.length; i++) {
                        args[i] = args[i].replace("%file", path);
                        args[i] = args[i].replace("%line", line);
                    }
                }
                dbg(">>>Lauching "+editor.executable, args);
                try {
                    FBL.launchProgram(editor.executable, args);
                }
                catch (e) { 
                    alert("Failed to launch:\n"+editor.executable+"\n with parameters "+args+"\n\n"+e.message); 
                    dbg(">>>Launch exception", e); 
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getPref: function(name) {
                dbg(">>>FireLogger.getPref: "+name);
                var prefName = fireloggerPrefDomain + "." + name;
    
                var type = fireloggerPrefs.getPrefType(prefName);
                if (type == nsIPrefBranch.PREF_STRING)
                return fireloggerPrefs.getCharPref(prefName);
                else if (type == nsIPrefBranch.PREF_INT)
                return fireloggerPrefs.getIntPref(prefName);
                else if (type == nsIPrefBranch.PREF_BOOL)
                return fireloggerPrefs.getBoolPref(prefName);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            setPref: function(name, value) {
                dbg(">>>FireLogger.setPref: "+name+"->"+value);
                var prefName = fireloggerPrefDomain + "." + name;
    
                var type = fireloggerPrefs.getPrefType(prefName);
                if (type == nsIPrefBranch.PREF_STRING)
                fireloggerPrefs.setCharPref(prefName, value);
                else if (type == nsIPrefBranch.PREF_INT)
                fireloggerPrefs.setIntPref(prefName, value);
                else if (type == nsIPrefBranch.PREF_BOOL)
                fireloggerPrefs.setBoolPref(prefName, value);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onOptionsShowing: function(popup) {
                if (Firebug.ActivableModule.onOptionsShowing) // FB1.4 doesn't have this?
                    Firebug.ActivableModule.onOptionsShowing.apply(this, arguments);
                for (var child = popup.firstChild; child; child = child.nextSibling) {
                    if (child.localName == "menuitem") {
                        var option = child.getAttribute("option");
                        if (option) {
                            var checked = false;
                            checked = this.getPref(option);
                            child.setAttribute("checked", checked);
                        }
                    }
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onVisitWebsite: function(which) {
                openNewTab(fireloggerURLs[which]);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            loadFilterStates: function(states) {
                dbg(">>>FireLogger.loadFilterStates", arguments);
                var states = ["debug", "info", "warning", "error", "critical"];
                var res = {};
                for (var i=0; i<states.length; i++) {
                    res[states[i]] = this.getPref("filter"+capitalize(states[i])+"Logs");
                }
                dbg(">>>Filter states", res);
                return res;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            storeFilterStates: function(states) {
                dbg(">>>FireLogger.storeFilterStates", arguments);
                for (var s in states) {
                    this.setPref("filter"+capitalize(s)+"Logs", states[s]);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onFilterLogs: function(what) {
                dbg(">>>FireLogger.onFilterLogs", what);
                var states = this.loadFilterStates();
                states[what] = !states[what];
                this.storeFilterStates(states);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onClear: function() {
                dbg(">>>FireLogger.onClear");
                if (!this.currentPanel) return;
                this.currentPanel.clear();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getMostRecentWindow: function(aType) {
                var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(nsIWindowMediator);
                return wm.getMostRecentWindow(aType);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onPreferences: function() {
                dbg(">>>FireLogger.onPreferences");
                var features = "chrome,titlebar,toolbar,centerscreen,dialog=no";
                var url = "chrome://firelogger/content/preferences.xul";

                var args = {
                    FBL: FBL
                };
                var win = this.getMostRecentWindow("FireLogger:Preferences");
                if (win) {
                    win.focus();
                } else {
                    openWindow(null, url, features, args);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            openPermissions: function(event, context) {
                cancelEvent(event);
    
                var browserURI = FirebugChrome.getBrowserURI(context);
                var host = this.getHostForURI(browserURI);
    
                var params = {
                    permissionType: this.getPrefDomain(),
                    windowTitle: $FIRELOGGER_STR(this.panelName + ".Permissions"),
                    introText: $FIRELOGGER_STR(this.panelName + ".PermissionsIntro"),
                    blockVisible: true,
                    sessionVisible: false,
                    allowVisible: true,
                    prefilledHost: host
                };
    
                openWindow("Browser:Permissions", "chrome://browser/content/preferences/permissions.xul", "", params);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getMenuLabel: function(option, location, shortened) {
                var label = "";
                var host = "";
    
                switch (option) {
                case "disable-site":
                    if (isSystemURL(location.spec))
                    label = "SystemPagesDisable";
                    else if (!getURIHost(location))
                    label = "LocalFilesDisable";
                    else
                    label = "HostDisable";
    
                    if (shortened)
                    return $FIRELOGGER_STR("panel.Disabled");
                    break;
    
                case "enable-site":
                    if (isSystemURL(location.spec))
                    label = "SystemPagesEnable";
                    else if (!getURIHost(location))
                    label = "LocalFilesEnable";
                    else
                    label = "HostEnable";
    
                    if (shortened)
                    return $FIRELOGGER_STR("panel.Enabled");
                    break;
    
                case "enable":
                    return $FIRELOGGER_STR("panel.Enabled");
    
                case "disable":
                    return $FIRELOGGER_STR("panel.Disabled");
                }
    
                if (!label)
                return null;
    
                label = this.panelName + "." + label;
                return $FIRELOGGER_STRF(label, [getURIHost(location)]);
            }
        });
    
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLogger.Record
        //
        Firebug.FireLogger.Record = domplate(Firebug.Rep, {
            /////////////////////////////////////////////////////////////////////////////////////////
            tagException: 
                DIV({ class: "rec-head closed $object|getIcon", onclick: "$onToggleDetails", _repObject: "$object"},
                    IMG({ class: "rec-icon", src: "blank.gif"}),
                    DIV({ class: "rec-date", onclick: "$onSourceNavigate" }, "$object|getDate"),
                    DIV({ class: "rec-logger", style:"$object|getLoggerStyle", title:"logger name" }, "$object|getLoggerName"),
                    DIV({ class: "rec-msg" }, ""),
                    DIV({ class: "rec-details" })
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagSimple:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", onclick: "$onSourceNavigate" }, "$object|getDate"),
                    DIV({ class: "rec-logger", style:"$object|getLoggerStyle", title:"logger name" }, "$object|getLoggerName"),
                    DIV({ class: "rec-msg" }, "")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagMessage:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date" }, "$object|getDate"),
                    DIV({ class: "rec-msg" }, "$object|getMessage")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagMessagewithexception:
                DIV({ class: "rec-head closed $object|getIcon", onclick: "$onToggleDetails", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date" }, "$object|getDate"),
                    DIV({ class: "rec-msg" }, "$object|getMessage"),
                    DIV({ class: "rec-details" })
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            getMessage: function(event) {
                dbg(">>>FireLogger.Record.getMessage", arguments);
                return event.data.message;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getIcon: function(event) {
                dbg(">>>FireLogger.Record.getIcon", arguments);
                return event.icon;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getDate: function(event) {
                dbg(">>>FireLogger.Record.getDate", arguments);
                return '[' + event.data.time + ']';
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getLoggerName: function(event) {
                dbg(">>>FireLogger.Record.getLogger", arguments);
                return event.data.name || "?";
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getLoggerStyle: function(event) {
                dbg(">>>FireLogger.Record.getLoggerStyle", arguments);
                var color = colorForName(event.data.name || "?");
                return "background-color:"+color;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            lookupEventObject: function(target) {
                var firelogger = getAncestorByClass(target, "firelogger-rec");
                var head = getChildByClass(firelogger, "rec-head")
                var event = head.repObject;
                return event;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onSourceNavigate: function(e) {
                dbg(">>>FireLogger.Record.onSourceNavigate", arguments);
                if (!isLeftClick(e)) return;
                var event = this.lookupEventObject(e.currentTarget);
                var path = event.data.pathname;
                var line = event.data.lineno;
                Firebug.FireLogger.openSourceFile(path, line);
                e.stopPropagation();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onToggleDetails: function(e) {
                dbg(">>>FireLogger.Record.onToggleDetails", arguments);
                if (!isLeftClick(e)) return;
                // do not toggle if clicked on locals property
                var clickedOnObjectLink = getAncestorByClass(e.target, "objectLink");
                if (clickedOnObjectLink) return;
                
                var event = this.lookupEventObject(e.currentTarget);
                var firelogger = getAncestorByClass(e.currentTarget, "firelogger-rec");
                var row = getChildByClass(firelogger, "rec-head")
                var details = getChildByClass(row, "rec-details");

                toggleClass(row, "expanded");
                toggleClass(row, "closed");

                event.expanded = false;
                if (hasClass(row, "expanded")) {
                    event.expanded = true;
                    this.showEventDetails(event, details);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderTraceback: function(event) {
                dbg(">>>FireLogger.Record.renderTraceback", arguments);
                if (!event.data.exc_info) return "no exception info available";
                var exc_info = event.data.exc_info['py/tuple'];
                if (!exc_info) return "no exception info available";
                var items = exc_info[2];
                if (!items) return "no traceback available";

                var formatFile = function(item) {
                    var path = item[0];
                    var line = item[1];
                    var parts = path.split('/');
                    var res = parts[parts.length-1];
                    if (res=="") res = "?";
                    if (line!=undefined) res += ":"+line;
                    return res;
                };
                var formatFunction = function(item) {
                    return item[2];
                };
                var formatLocation = function(item) {
                    return item[3];
                };

                var s = ['<table class="rec-traceback-table">'];
                for (var i=0; i<items.length; i++){
                    var item = items[i]['py/tuple'];
                    var extra = "";
                    if (i == items.length-1) extra = " current";
                    s.push('<tr class="rec-traceback-row row-'+i+''+extra+'">');
                    var path = item[0];
                    var line = item[1];
                    s.push('<td class="rec-traceback-icon"></td>')
                    s.push('<td class="rec-traceback-file" onclick=\'event.stopPropagation();top.Firebug.FireLogger.openSourceFile("'+escapeJS(path).replace('\\', '\\\\', 'g')+'", '+line+');\'>');
                    s.push(formatFile(item));
                    s.push('</td>');
                    s.push('<td class="rec-traceback-function">');
                    s.push(formatFunction(item));
                    s.push('</td>');
                    s.push('<td class="rec-traceback-location">');
                    s.push(formatLocation(item));
                    s.push('</td>');
                    s.push('<td class="rec-traceback-locals traceback-frame-'+i+'" >');
                    // placeholder for dynamic items
                    s.push('</td>');
                    s.push('</tr>')
                };
                s.push('</table>');
                return s.join('');
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderDynamicItems: function(event, node) {
                dbg(">>>FireLogger.Record.renderDynamicItems", arguments);
                var frames = event.data.exc_frames;
                if (!frames) return;
                
                for (var i=0; i<frames.length; i++) {
                    var frame = frames[i];
                    var dest = getElementByClass(node, "traceback-frame-"+i);
                    if (dest) {
                        var r = Firebug.getRep(frame);
                        r.tag.append({object: frame}, dest);
                    }
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showEventDetails: function(event, details) {
                dbg(">>>FireLogger.Record.showEventDetails", arguments);
                var html = "";
                switch (event.type) {
                    case "exception": 
                    case "messagewithexception": 
                        html = this.renderTraceback(event); 
                        break;
                }
                details.innerHTML = html;
                switch (event.type) {
                    case "exception":
                    case "messagewithexception": 
                        this.renderDynamicItems(event, details); 
                        break;
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            supportsObject: function(object) {
                return object instanceof FireLoggerEvent;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getRealObject: function(event, context) {
                return event.data;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getContextMenuItems: function(event) {
                return null;
            }
        });
    
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLoggerPanel
        //
        Firebug.FireLoggerPanel = function() {}
        Firebug.FireLoggerPanel.prototype = extend(Firebug.AblePanel||Firebug.Panel, { // AblePanel was introduced in 1.3
            name: "FireLogger",
            title: "FireLogger",
            searchable: true,
            editable: false,
    
            wasScrolledToBottom: true,
    
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function() {
                dbg(">>>FireLoggerPanel.initialize");
                Firebug.Panel.initialize.apply(this, arguments);
                this.applyCSS();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            applyCSS: function() {
                dbg(">>>FireLoggerPanel.applyCSS");
                this.applyPanelCSS("chrome://firelogger/skin/firelogger.css");
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            publish: function(event) {
                dbg(">>>FireLoggerPanel.publish", event);
                event.root = this.append(event, "rec", null, null);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            clear: function() {
                dbg(">>>FireLoggerPanel.clear");
                if (this.panelNode) clearNode(this.panelNode);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            show: function(state) {
                dbg(">>>FireLoggerPanel.show", state);
                var enabled = Firebug.FireLogger.isEnabled(this.context);
                this.showToolbarButtons("fbFireLoggerButtons", true);
                this.showToolbarButtons("fbFireLoggerFilters", enabled);
    
                if (enabled)
                    Firebug.ModuleManagerPage.hide(this);
                else
                    Firebug.ModuleManagerPage.show(this, Firebug.FireLogger);
    
                if (this.wasScrolledToBottom) scrollToBottom(this.panelNode);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            hide: function() {
                dbg(">>>FireLoggerPanel.hide");
                this.wasScrolledToBottom = isScrolledToBottom(this.panelNode);
                this.showToolbarButtons("fbFireLoggerButtons", false);
                this.showToolbarButtons("fbFireLoggerFilters", false);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getOptionsMenuItems: function() {
                dbg(">>>FireLoggerPanel.getOptionsMenuItems");
                return null;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            search: function(text) {
                // make previously visible nodes invisible again
                if (this.matchSet) {
                    for (var i in this.matchSet)
                        removeClass(this.matchSet[i], "matched");
                }
                this.matchSet = [];

                if (!text) return;

                function findRow(node) { return getAncestorByClass(node, "firelogger-rec"); }
                var search = new TextSearch(this.panelNode, findRow);

                var row = search.find(text);
                if (!row) return false;
                for (; row; row = search.findNext()) {
                    setClass(row, "matched");
                    this.matchSet.push(row);
                }
                return true;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getTopContainer: function() {
                return this.panelNode;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            createRow: function(rowName, className) {
                var elt = this.document.createElement("div");
                elt.className = rowName + (className ? " " + rowName + "-" + className: "");
                return elt;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            append: function(objects, className, rep) {
                dbg(">>>FireLoggerPanel.append", arguments);
                var container = this.getTopContainer();
                var scrolledToBottom = isScrolledToBottom(this.panelNode);
                var row = this.createRow("firelogger", className);
                this.appendObject.apply(this, [objects, row, rep]);
                container.appendChild(row);
                if (scrolledToBottom) scrollToBottom(this.panelNode);
                return row;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderFormattedMessage: function(object, row, rep) {
                var lookupArg = function(index) {
                    if (object.data.args && object.data.args["py/tuple"]) {
                        return object.data.args["py/tuple"][index];
                    }
                    if (index==0 && object.data.args) {
                        return object.data.args;
                    }
                };
                var dest = getChildByClass(row.childNodes[0], "rec-msg");
                dest.innerHTML = "";
                var template = object.data.template;
                if (typeof template != "string") template = template._; // this is a special case for exceptions
                if (!template) template = "?";
                var parts = (template+" ").split(/%[a-zA-Z]{0,1}/);
                if (parts[parts.length-1]=="") parts.pop();
                for (var i=0; i<parts.length; i++) {
                    var part = parts[i];
                    FirebugReps.Text.tag.append({object: part}, dest);
                    if (i<parts.length-1) {
                        var arg = lookupArg(i);
                        var r = Firebug.getRep(arg);
                        r.tag.append({object: arg}, dest);
                    }
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderPlainMessage: function(object, row, rep) {
                var dest = getChildByClass(row.childNodes[0], "rec-msg");
                dest.innerHTML = "";
                FirebugReps.Text.tag.append({object: object.data.message}, dest);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            appendObject: function(object, row, rep) {
                dbg(">>>FireLoggerPanel.appendObject", arguments);
                var rep = rep ? rep: Firebug.getRep(object);
                var typeName = "tag"+capitalize(object.type);
                setClass(row, "type-"+object.type);
                setClass(row, "icon-"+object.icon);
                var res = rep[typeName].append({ object: object }, row);
                if (Firebug.FireLogger._richFormatting && object.data.template)
                    this.renderFormattedMessage(object, row, rep);
                else
                    this.renderPlainMessage(object, row, rep);
                if (object.expanded) {
                    rep.onToggleDetails({ currentTarget: row.childNodes[0].childNodes[0] });
                }
                return res;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            applyPanelCSS: function(url) {
                var links = FBL.getElementsBySelector(this.document, "link");
                for (var i=0; i < links.length; i++) {
                    var link = links[i];
                    if (link.getAttribute('href')==url) return; // already applied
                }
                var styleElement = this.document.createElement("link");
                styleElement.setAttribute("type", "text/css");
                styleElement.setAttribute("href", url);
                styleElement.setAttribute("rel", "stylesheet");
                var head = this.getHeadElement(this.document);
                if (head) head.appendChild(styleElement);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getHeadElement: function(doc) {
                var heads = doc.getElementsByTagName("head");
                if (heads.length == 0) return doc.documentElement;
                return heads[0];
            }
        });
    
        ////////////////////////////////////////////////////////////////////////
        // Firebug.WatchesFireLoggerPanel
        //
        Firebug.WatchesFireLoggerPanel = function () {};
        Firebug.WatchesFireLoggerPanel.prototype = extend(Firebug.DOMPanel.prototype, {
            name: "FireLoggerWatches",
            title: "Logger Watches",
            parentPanel: "FireLogger",
        });

        ////////////////////////////////////////////////////////////////////////
        // JSON-like displaing for objects
        //
        var OBJECTBOX = this.OBJECTBOX =
            SPAN({class: "objectBox objectBox-$className"});

        var OBJECTBLOCK = this.OBJECTBLOCK =
            DIV({class: "objectBox objectBox-$className"});

        var OBJECTLINK = this.OBJECTLINK =
            A({
                class: "objectLink objectLink-$className",
                _repObject: "$object"
            });

        FirebugReps.Obj = domplate(FirebugReps.Obj, {
            tag: OBJECTLINK(
                "{",
                FOR("prop", "$object|propIterator",
                    " $prop.name=",
                    SPAN({class: "objectPropValue"}, "$prop.value|cropString")
                ), 
                " }"
            ),
            /////////////////////////////////////////////////////////////////////////////////////////
            getTitle: function(object, context) {
                return "{...}";
            }
        });
    
        ////////////////////////////////////////////////////////////////////////
        // support Logger tuples
        //
        Firebug.FireLogger.LoggerTuple = domplate(Firebug.Rep, {
            className: "array",
            /////////////////////////////////////////////////////////////////////////////////////////
            tag:
                OBJECTBOX({_repObject: "$object|getRealObject"},
                    SPAN({class: "arrayLeftBracket"}, "("),
                    FOR("item", "$object|arrayIterator",
                        TAG("$item.tag", {object: "$item.object"}),
                        SPAN({class: "arrayComma"}, "$item.delim")
                    ),
                    SPAN({class: "arrayRightBracket"}, ")")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            shortTag:
                OBJECTBOX({_repObject: "$object|getRealObject"},
                    SPAN({class: "arrayLeftBracket"}, "("),
                    FOR("item", "$object|shortArrayIterator",
                        TAG("$item.tag", {object: "$item.object"}),
                        SPAN({class: "arrayComma"}, "$item.delim")
                    ),
                    SPAN({class: "arrayRightBracket"}, ")")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            arrayIterator: function(array) {
                dbg(">>>FireLogger.LoggerTuple.arrayIterator", arguments);
                array = array['py/tuple'] || [];
                var items = [];
                for (var i = 0; i < array.length; ++i) {
                    var value = array[i];
                    var rep = Firebug.getRep(value);
                    var tag = rep.shortTag ? rep.shortTag : rep.tag;
                    var delim = (i == array.length-1 ? "" : ", ");

                    items.push({object: value, tag: tag, delim: delim});
                }
                return items;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            shortArrayIterator: function(array) {
                dbg(">>>FireLogger.LoggerTuple.shortArrayIterator", arguments);
                array = array['py/tuple'] || [];
                var items = [];
                for (var i = 0; i < array.length && i < 3; ++i) {
                    var value = array[i];
                    var rep = Firebug.getRep(value);
                    var tag = rep.shortTag ? rep.shortTag : rep.tag;
                    var delim = (i == array.length-1 ? "" : ", ");

                    items.push({object: value, tag: tag, delim: delim});
                }

                if (array.length > 3)
                    items.push({object: (array.length-3) + " more...", tag: FirebugReps.Caption.tag, delim: ""});

                return items;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getItemIndex: function(child) {
                var arrayIndex = 0;
                for (child = child.previousSibling; child; child = child.previousSibling)
                {
                    if (child.repObject)
                        ++arrayIndex;
                }
                return arrayIndex;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            supportsObject: function(object) {
                return !!object['py/tuple'];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getRealObject: function(object) {
                return object['py/tuple'];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getTitle: function(object, context) {
                return "[" + object['py/tuple'].length + "]";
            }
        });
    
        Firebug.registerActivableModule(Firebug.FireLogger);
        Firebug.registerRep(Firebug.FireLogger.Record);
        Firebug.registerRep(Firebug.FireLogger.LoggerTuple);
        Firebug.registerPanel(Firebug.FireLoggerPanel);
        Firebug.registerPanel(Firebug.WatchesFireLoggerPanel);
        Firebug.setDefaultRep(FirebugReps.Obj);
    }
});