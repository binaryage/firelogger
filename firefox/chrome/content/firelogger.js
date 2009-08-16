// This source contains copy&pasted various bits from Firebug sources.
// Some code comes from FirePHP project (http://www.firephp.org)
FBL.ns(function() {
    with(FBL) {
        
        function hideUI() {
            collapse($("fbFireLoggerFilters"), true);
        }
        
        function checkFirebugVersion(minMajor, minMinor) {
            var version = Firebug.getVersion();
            if (!version) return false;
            var a = version.split('.');
            if (a.length<2) return false;
            // parse Firebug version (including alphas/betas and other weird stuff)
            var major = parseInt(a[0], 10);
            var minor = parseInt(a[1], 10);
            return major>=minMajor && minor>=minMinor;
        }

        if (!checkFirebugVersion(1,4)) {
            alert('FireQuery works with Firebug 1.4 and later.\nPlease upgrade Firebug to the latest version.');
            hideUI();
            return;
        }
        
        const Cc = Components.classes;
        const Ci = Components.interfaces;

        const nsIPrefBranch = Ci.nsIPrefBranch;
        const nsIPrefBranch2 = Ci.nsIPrefBranch2;
        const nsIWindowMediator = Ci.nsIWindowMediator;

        const observerService = CCSV("@mozilla.org/observer-service;1", "nsIObserverService");
        const prefService = CCSV("@mozilla.org/preferences-service;1", "nsIPrefBranch2");

        const fireloggerHomepage = "http://firepython.binaryage.com";

        if (Firebug.TraceModule) {
            Firebug.TraceModule.DBG_FIRELOGGER = false;
            var type = prefService.getPrefType('extensions.firebug.DBG_FIRELOGGER');
            if (type != nsIPrefBranch.PREF_BOOL) try {
                prefService.setBoolPref('extensions.firebug.DBG_FIRELOGGER', false);
            } catch(e) {}
        }
    
        function dbg() {
            if (FBTrace && FBTrace.DBG_FIRELOGGER) { 
                if (/FireLoggerPanel/.test(arguments[0])) return;
                if (/FireLogger.Record/.test(arguments[0])) return;
                if (/FireLogger.LoggerTuple/.test(arguments[0])) return;
                if (/FireLogger.Protocol/.test(arguments[0])) return;
                FBTrace.sysout.apply(this, arguments);
            }
        }
    
        function capitalize(s) {
            return s.charAt(0).toUpperCase() + s.substring(1).toLowerCase();
        }
        
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
        
        var module;
        
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
                dbg(">>>FireLoggerContextMixin.queueFile: "+file.href);
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
                var profiles = {};
                var re = /^firelogger-([0-9a-f]+)-(\d+)/i;
                var parseHeader = function(name, value) {
                    var res = re.exec(name);
                    if (!res) return;
                    buffers[res[1]] = buffers[res[1]] || [];
                    buffers[res[1]][res[2]] = value;
                };
                for (var index in headers) {
                    parseHeader(headers[index].name, headers[index].value);
                }
                // we use UTF-8 encoded JSON to exchange messages which are wrapped with base64
                var packets = [];
                for (bufferId in buffers) {
                    if (!buffers.hasOwnProperty(bufferId)) continue;
                    var buffer = buffers[bufferId].join('');
                    buffer = Base64.decode(buffer);
                    buffer = UTF8.decode(buffer);
                    dbg(">>>FireLogger.Protocol", "Packet "+bufferId+":\n"+buffer);
                    var packet = JSON.parse(buffer);
                    packets.push(packet);
                }
                return packets;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processDataPacket: function(url, packet) {
                dbg(">>>FireLoggerContextMixin.processDataPacket", packet);
                var logs = [];
                if (!packet) return logs;
                if (packet.errors) { // internal errors on logger side
                    for (var i=0; i<packet.errors.length; i++) {
                        var error = packet.errors[i];
                        module.showMessage(this, error.message, "sys-error", error.exc_info);
                    }
                }
                if (packet.logs) {
                    for (var i=0; i < packet.logs.length; i++) {
                        var log = packet.logs[i];
                        logs.push(log);
                    }
                }
                if (packet.profile) {
                    module.showProfile(this, url, packet.profile.info, packet.profile.dot);
                }
                return logs;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processRequest: function(url, packets) {
                dbg(">>>FireLoggerContextMixin.processRequest ("+url+")", packets);
                var logs = [];
                for (var i=0; i < packets.length; i++) {
                    var packet = packets[i];
                    logs = logs.concat(this.processDataPacket(url, packet));
                }
                logs.sort(function(a,b) {
                    return b.timestamp<a.timestamp;
                });
                for (var i=0; i<logs.length; i++) {
                    var log = logs[i];
                    module.showLog(this, log, "log-"+log.level);
                }
            }
        };
        
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLogger
        //
        module = Firebug.FireLogger = extend(Firebug.ActivableModule, {
            version: '0.5',
            currentPanel: null,

            /////////////////////////////////////////////////////////////////////////////////////////
            onPanelEnable: function(context, panelName) {
                if (panelName != this.panelName) return;
                dbg(">>>FireLogger.onPanelEnable", arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onPanelDisable: function(context, panelName) {
                if (panelName != this.panelName) return;
                dbg(">>>FireLogger.onPanelDisable", arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onEnabled: function(context) {
                dbg(">>>FireLogger.onEnabled", arguments);
                this.checkDependenciesOnOtherPanels(context);
                module.start();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onDisabled: function(context) {
                dbg(">>>FireLogger.onDisabled", arguments);
                module.stop();
                delete context.fireLoggerWarningShown;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            cachePrefs: function() {
                this._password = this.getPref('password');
                this._richFormatting = this.getPref('richFormatting');
                this._showInternal = this.getPref('showInternal');
                this._enableProfiler = this.getPref('enableProfiler');
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            start: function() {
                dbg(">>>FireLogger.start");
                this.cachePrefs();
                prefService.addObserver(this.getPrefDomain(), this, false);
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
            // FB1.4 >=r2050
            onResponse: function(context, file) {
                dbg(">>>FireLogger.onResponse:"+file.href, context);
                
                // HACK: overcome bug in Firebug1.4, first root HTML file can be sent twice!
                if (!context.flc) context.flc = {};
                if (context.flc[file.href]) return;
                context.flc[file.href] = true;
                
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
                if (topic == "http-on-modify-request") {
                    var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
                    // from v0.3 do not alter User-Agent, this guy on twitter had problems: http://twitter.com/lawouach/statuses/1222443299
                    // just add FireLogger version as a separate header, should be safe
                    httpChannel.setRequestHeader("X-FireLogger", this.version, false);
                    if (this._password) {
                        httpChannel.setRequestHeader("X-FireLoggerAuth", this.prepareAuth(this._password), false);
                    }
                    if (this._enableProfiler) {
                        httpChannel.setRequestHeader("X-FireLoggerProfiler", "1", false);
                    }
                }
                if (topic == "nsPref:changed") {
                    this.cachePrefs();
                    var parts = data.split(".");
                    var name = parts[parts.length-1];
                    var value = this.getPref(name);
                    this.updatePanel();
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function() {
                dbg(">>>FireLogger.initialize");
                this.panelName = 'firelogger';
                this.description = "Server-side logging tools for web developers.";
                Firebug.ActivableModule.initialize.apply(this, arguments);
                this.patchChrome(top.FirebugChrome, FirebugContext);
                this.start();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            shutdown: function() {
                dbg(">>>FireLogger.shutdown");
                this.stop();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initializeUI: function() {
                dbg(">>>FireLogger.initializeUI");
                Firebug.ActivableModule.initializeUI.apply(this, arguments);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onSuspendFirebug: function(context) {
                dbg(">>>FireLogger.onSuspendFirebug");
                this.stop();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onResumeFirebug: function(context) {
                dbg(">>>FireLogger.onResumeFirebug");
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
            patchChrome: function(chrome, context) {
                if (!chrome.selectFireLoggerOriginal) {
                    dbg(">>>FireLogger.patchChrome");
                    chrome.selectFireLoggerOriginal = chrome.select;
                    // this monkeypatching is responsible for intercepting object inspection 
                    // fireloggerwatches panel intercepts all object inspections only when FireLogger panel is visible
                    chrome.select = function(object, panelName, sidePanelName, forceUpdate) {
                        if (module.currentPanel) {
                            var panel = FirebugContext.getPanel(module.panelName);
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
                var panel = context.getPanel(module.panelName);
                if (!panel) return;
                panel.applyCSS();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            checkDependenciesOnOtherPanels: function(context) {
                if ((!Firebug.NetMonitor.isEnabled(context) || !Firebug.Console.isEnabled(context)) && !context.fireLoggerWarningShown) {
                    this.showMessage(context, 'You have to enable the Firebug Console and Net panels for FireLogger to work properly!', "sys-warning");
                    context.fireLoggerWarningShown = true;
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showPanel: function(browser, panel) {
                dbg(">>>FireLogger.showPanel", panel);
                Firebug.ActivableModule.showPanel.apply(this, arguments);
                if (!module.isEnabled()) return;
                var isFireLogger = panel && panel.name == this.panelName;
                if (isFireLogger) {
                    panel.context.processRequestQueueAutoFlushing = true;
                    panel.context.processRequestQueue();
                    this.checkDependenciesOnOtherPanels(panel.context);
                    this.currentPanel = panel;
                    this.updatePanel();
                
                    // default DOMPanel behavior is to show top level window object
                    // this is a good place to reset it to empty object
                    var watchesPanel = panel.context.getPanel("fireloggerwatches");
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
                var type = "message";
                if (exc_info) type = "messagewithexception";
                var event = new FireLoggerEvent(type, {
                    message: text,
                    time: this.getCurrentTime(),
                    exc_info: exc_info
                }, icon);
                return this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showProfile: function(context, url, profile_info, profile_data) {
                var type = "profile";
                var event = new FireLoggerEvent(type, {
                    message: (profile_info || "Request Profile available as Graphviz") + " [" + url + "]",
                    time: this.getCurrentTime(),
                    profile_data: profile_data
                }, "sys-time");
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
                var panel = context.getPanel(module.panelName);
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
            findEditor: function(editorId, allowDefault) {
                var editors = this.loadExternalEditors();
                var editor = null;
                for (var i=0; i<editors.length; i++) {
                    if (editorId == editors[i].id) return editors[i];
                }
                if (allowDefault && editors.length>0) return editors[0];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            findPreferredEditor: function() {
                var preferredEditorId = this.getPref('preferredEditor');
                return this.findEditor(preferredEditorId, true);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            findGraphviz: function() {
                return this.findEditor("Graphviz", false);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            writeTemporaryFile: function(name_template, data) {
                var file = Components.classes["@mozilla.org/file/directory_service;1"].
                                     getService(Components.interfaces.nsIProperties).
                                     get("TmpD", Components.interfaces.nsIFile);
                file.append(name_template);
                file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);

                var foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].
                                         createInstance(Components.interfaces.nsIFileOutputStream);
                                // write, create, truncate
                foStream.init(file, 0x02 | 0x08 | 0x20, 0666, 0);

                var utfStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"].
                                          createInstance(Components.interfaces.nsIConverterOutputStream);
                utfStream.init(foStream, "UTF-8", 0, 0x0000);
                utfStream.writeString(data);
                utfStream.close();
                return file.path;
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
            preprocessObject: function(o) {
                if (this._showInternal) return o;
                var worker = function(x) {
                    if (typeof x != "object") return x;
                    var res = {};
                    for (i in x) {
                        if (x.hasOwnProperty(i)) {
                            if (i=="_") continue;
                            res[i] = worker(x[i]);
                        }
                    }
                    return res;
                };
                return worker(o);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getPref: function(name) {
                var prefName = this.getPrefDomain() + "." + name;
                var type = prefService.getPrefType(prefName);
                if (type == nsIPrefBranch.PREF_STRING)
                return prefService.getCharPref(prefName);
                else if (type == nsIPrefBranch.PREF_INT)
                return prefService.getIntPref(prefName);
                else if (type == nsIPrefBranch.PREF_BOOL)
                return prefService.getBoolPref(prefName);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            setPref: function(name, value) {
                var prefName = this.getPrefDomain() + "." + name;
                var type = prefService.getPrefType(prefName);
                if (type == nsIPrefBranch.PREF_STRING)
                prefService.setCharPref(prefName, value);
                else if (type == nsIPrefBranch.PREF_INT)
                prefService.setIntPref(prefName, value);
                else if (type == nsIPrefBranch.PREF_BOOL)
                prefService.setBoolPref(prefName, value);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            visitWebsite: function() {
                openNewTab(fireloggerHomepage);
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
            openPreferences: function() {
                dbg(">>>FireLogger.openPreferences");
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
            }
        });
    
        ////////////////////////////////////////////////////////////////////////
        // module.Record
        //
        module.Record = domplate(Firebug.Rep, {
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
            tagProfile:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", onclick: "$onProfileNavigate" }, "$object|getDate"),
                    DIV({ class: "rec-msg", onclick: "$onProfileNavigate" }, "$object|getMessage")
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
                module.openSourceFile(path, line);
                e.stopPropagation();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onProfileNavigate: function(e) {
                dbg(">>>FireLogger.Record.onProfileNavigate", arguments);
                if (!isLeftClick(e)) return;
                var event = this.lookupEventObject(e.currentTarget);
                var path = module.writeTemporaryFile("graph.dot", event.data.profile_data);
                var editor = module.findGraphviz();
                args = [path]
                if (!editor) {
                    alert('Graphviz not found!\nPlease add it into Firebug via Firebug Menu -> Open With Editor -> Configure Editors ...');
                    dbg(">>>graphviz was not found!");
                } else {
                    dbg(">>>Lauching "+editor.executable, args);
                    try {
                        FBL.launchProgram(editor.executable, args);
                    }
                    catch (e) { 
                        alert("Failed to launch:\n"+editor.executable+"\n with parameters "+args+"\n\n"+e.message); 
                        dbg(">>>Launch exception", e); 
                    }
                }
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
                    s.push('<td class="rec-traceback-file" onclick=\'event.stopPropagation();top.module.openSourceFile("'+escapeJS(path).replace('\\', '\\\\', 'g')+'", '+line+');\'>');
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
                        r.tag.append({object: module.preprocessObject(frame)}, dest);
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
        Firebug.FireLoggerPanel.prototype = extend(Firebug.ActivablePanel, {
            name: "firelogger",
            title: "Logger",
            searchable: true,
            editable: false,
            wasScrolledToBottom: true,
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function() {
                dbg(">>>FireLoggerPanel.initialize");
                Firebug.ActivablePanel.initialize.apply(this, arguments);
                this.panelSplitter = $("fbPanelSplitter");
                this.sidePanelDeck = $("fbSidePanelDeck");
                this.applyCSS();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            enablePanel: function(module) {
                dbg(">>FireLoggerPanel.enablePanel; " + this.context.getName());
                Firebug.ActivablePanel.enablePanel.apply(this, arguments);
                this.clear();
                if (this.wasScrolledToBottom)
                    scrollToBottom(this.panelNode);
                this.panelSplitter.collapsed = false;
                this.sidePanelDeck.collapsed = false;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            disablePanel: function(module) {
                dbg(">>FireLoggerPanel.disablePanel; " + this.context.getName());
                Firebug.ActivablePanel.disablePanel.apply(this, arguments);
                this.hide();
                var watchesPanel = this.context.getPanel("fireloggerwatches");
                watchesPanel.hide();
                this.panelSplitter.collapsed = true;
                this.sidePanelDeck.collapsed = true;
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
                var enabled = module.isAlwaysEnabled();
                this.panelSplitter.collapsed = !enabled;
                this.sidePanelDeck.collapsed = !enabled;
                if (enabled) {
                     module.disabledPanelPage.hide(this);
                     this.showToolbarButtons("fbFireLoggerFilters", true);
                     if (this.wasScrolledToBottom)
                         scrollToBottom(this.panelNode);
                } else {
                    this.hide();
                    module.disabledPanelPage.show(this);
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            hide: function() {
                dbg(">>>FireLoggerPanel.hide");
                this.showToolbarButtons("fbFireLoggerFilters", false);
                this.wasScrolledToBottom = isScrolledToBottom(this.panelNode);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getOptionsMenuItems: function() {
                dbg(">>>FireLoggerPanel.getOptionsMenuItems");
                return [{
                    label: "Preferences ...",
                    nol10n: true,
                    command: function() {
                        module.openPreferences();
                    }
                },'-', {
                    label: "Visit FireLogger Website...",
                    nol10n: true,
                    command: function() {
                        module.visitWebsite();
                    }
                }];
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
                dbg(">>>FireLoggerPanel.createRow", arguments);
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
					if (!object.data.args) return;
                    if (object.data.args["py/tuple"]) {
                        return object.data.args["py/tuple"][index];
                    }
                    if (index==0 && !object.data.args.length) {
                        return object.data.args;
                    }
					return object.data.args[index];
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
                        r.tag.append({object: module.preprocessObject(arg)}, dest);
                    }
                }
				// dump also unreferenced args
				if (object.data.args && object.data.args.length) {
					var a = object.data.args;
					if (object.data.args["py/tuple"]) a = object.data.args["py/tuple"];
					for (var j=i-1; j<a.length; j++) {
						var arg = lookupArg(j);
                        var r = Firebug.getRep(arg);
                        r.tag.append({object: module.preprocessObject(arg)}, dest);
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
                if (module._richFormatting && object.data.template)
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
        // Firebug.FireLoggerWatchesPanel
        //
        Firebug.FireLoggerWatchesPanel = function () {};
        Firebug.FireLoggerWatchesPanel.prototype = extend(Firebug.DOMPanel.prototype, {
            title: "Watches",
            name: "fireloggerwatches",
            parentPanel: "firelogger"
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
        module.LoggerTuple = domplate(Firebug.Rep, {
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
                for (child = child.previousSibling; child; child = child.previousSibling) {
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
    
        Firebug.registerActivableModule(module);
        Firebug.registerRep(module.Record);
        Firebug.registerRep(module.LoggerTuple);
        Firebug.registerPanel(Firebug.FireLoggerPanel);
        Firebug.registerPanel(Firebug.FireLoggerWatchesPanel);
        Firebug.setDefaultReps(FirebugReps.Func, FirebugReps.Obj);
    }
});