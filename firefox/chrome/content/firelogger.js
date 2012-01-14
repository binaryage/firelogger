FBL.ns(function() {
    with(FBL) {
        
        var hideUI = function() {
            collapse($("fbFireLoggerFilters"), true);
        };
        
        var checkFirebugVersion = function(minMajor, minMinor) {
            var version = Firebug.getVersion();
            if (!version) return false;
            if (version.indexOf('X')!=-1) { // SVN alpha/beta versions
                version = version.split('X')[0];
            }
            var a = version.split('.');
            if (a.length<2) return false;
            // parse Firebug version (including alphas/betas and other weird stuff)
            var major = parseInt(a[0], 10);
            var minor = parseInt(a[1], 10);
            return major>minMajor || (major==minMajor && minor>=minMinor);
        };
        
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
        
        const fireloggerHomepage = "http://firelogger.binaryage.com";
        
        if (typeof FBTrace == "undefined") {
            FBTrace = { sysout: function() {} };
        }

        FBTrace.DBG_FIRELOGGER = prefService.getBoolPref("extensions.firebug.DBG_FIRELOGGER");
                    
        var dbg = function() {
            if (FBTrace && FBTrace.DBG_FIRELOGGER) { 
                if (/FireLoggerPanel/.test(arguments[0])) return;
                //if (/FireLogger.Record/.test(arguments[0])) return;
                if (/FireLogger.LoggerTuple/.test(arguments[0])) return;
                if (/FireLogger.Protocol/.test(arguments[0])) return;
                FBTrace.sysout.apply(this, arguments);
            }
        };
            
        var capitalize = function(s) {
            if (!s) return '';
            return s.charAt(0).toUpperCase() + s.substring(1).toLowerCase();
        };
        
        ////////////////////////////////////////////////////////////////////////
        var FireLoggerEvent = function(type, data, icon) {
            this.type = type;
            this.data = data;
            this.icon = icon;
            this.expanded = false;
        };
        
        var colorForName = function(name) {
            var niceColors = ["blue", "magenta", "brown", "black", 
                              "darkgreen", "blueviolet", "cadetblue", "crimson", "darkgoldenrod",
                              "darkslateblue", "firebrick", "midnightblue", "orangered", "navy"];
            var code = 0;
            for (var i=0; i<name.length; i++) {
                code += name.charCodeAt(i);
            }
            var color = niceColors[code % niceColors.length];
            return color;
        };
        
        // http://code.google.com/p/fbug/source/detail?r=7625
        var getCurrentContext = function() {
            if (typeof FirebugContext != "object") {
                return Firebug.currentContext;
            }
            return FirebugContext;
        };
        
        var getCurrentChrome = function(context) {
            if (context && context.chrome) {
                return context.chrome;
            }
            if (top.FirebugChrome) {
                return top.FirebugChrome;
            }
            return Firebug.chrome;
        };
        
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
                dbg(">>>FireLoggerContextMixin.pushRecord", [url, info]);
                this.requestQueue.push([url, info]);
                if (module.currentPanel) this.processRequestQueue(); // flush immediately in case logger panel is visible
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
                dbg(">>>FireLoggerContextMixin.queueFile: "+file.href, file);
                // normally i would just do this.pushRecord(file.href, that.parseHeaders(file.responseHeaders));
                // but Firebug may pass file in progress into onResponse which has no responseHeaders defined yet (because of network latency?)
                // it probably depends on when Firebug UI starts rendering file and 
                // Utils.getHttpHeaders(request, file) gets called, which happens randomly after onRequest has been called
                //
                // workaround: in case I don't see responseHeaders I setup setInterval and wait 10 seconds for responseHeaders to appear
                // see the discussion here: http://getsatisfaction.com/binaryage/topics/firelogger_0_8_does_not_show_anything
                //
                var that = this;
                var job = function() {
                    that.pushRecord(file.href, that.parseHeaders(file.responseHeaders));
                };
                if (file.responseHeaders) {
                    job();
                } else {
                    // wait for responseHeaders
                    var counter = 0;
                    var interval = setInterval(function() {
                        counter++;
                        if (file.responseHeaders) {
                            clearInterval(interval);
                            job();
                        }
                        if (counter>100) {
                            clearInterval(interval);
                        }
                    }, 100);
                }
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
                for (var bufferId in buffers) {
                    if (!buffers.hasOwnProperty(bufferId)) continue;
                    var buffer = buffers[bufferId].join('');
                    buffer = FireLogger.Base64.decode(buffer);
                    buffer = FireLogger.UTF8.decode(buffer);
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
                var events = [];
                var i;
                if (!packet) return [events, logs];
                if (packet.errors) { // internal errors on logger side
                    for (i=0; i<packet.errors.length; i++) {
                        var error = packet.errors[i];
                        events.push(module.prepareMessage(this, error.message, "sys-error", error.exc_info));
                    }
                }
                if (packet.logs) {
                    for (i=0; i < packet.logs.length; i++) {
                        var log = packet.logs[i];
                        logs.push(log);
                    }
                }
                if (packet.profile) {
                    events.push(module.prepareProfile(this, url, packet.profile.info, packet.profile.dot));
                }
                var extension_data = packet.extension_data;
                if (extension_data) {
                    var appstats = extension_data.appengine_appstats;
                    events.push(module.prepareAppstats(this, appstats));
                }
                return [events, logs];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            processRequest: function(url, packets) {
                dbg(">>>FireLoggerContextMixin.processRequest ("+url+")", packets);
                // process data packets for given url and sort log messages
                var logs = [];
                var events = [];
                var i;
                for (i=0; i < packets.length; i++) {
                    var packet = packets[i];
                    var items = this.processDataPacket(url, packet);
                    var newEvents = items[0];
                    var newLogs = items[1];
                    events = events.concat(newEvents);
                    logs = logs.concat(newLogs);
                }
                logs.sort(function(a, b) {
                    if (b.timestamp==a.timestamp) { //stable sorting when timestamp has insufficient resolution
                        if (b.order && a.order) // supported by PHP
                            return b.order < a.order;
                    }
                    return b.timestamp<a.timestamp;
                });
                // bail out in case of no logs and no events
                if (!logs.length && !events.length) return;
        
                // render events and logs
                module.deferRendering(); // prevent flickering
                module.showRequest(this, { url: url });
                for (i=0; i<events.length; i++) {
                    var event = events[i];
                    module.publishEvent(this, event);
                }
                for (i=0; i<logs.length; i++) {
                    var log = logs[i];
                    module.showLog(this, log, "log-"+log.level);
                }
                module.undeferRendering();
            }
        };
        
        ////////////////////////////////////////////////////////////////////////
        // Firebug.FireLogger
        //
        module = Firebug.FireLogger = extend(Firebug.ActivableModule, {
            version: '1.2',
            currentPanel: null,
            collapsedRequests: {},
        
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
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onDisabled: function(context) {
                dbg(">>>FireLogger.onDisabled", arguments);
                delete context.fireLoggerWarningShown;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            cachePrefs: function() {
                this._richFormatting = this.getPref('richFormatting');
                this._showInternal = this.getPref('showInternal');
                this._enableProfiler = this.getPref('enableProfiler');
                this._enableAppstats = this.getPref('enableAppstats');
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            start: function() {
                if (this.running) return;
                this.running = true;
                dbg(">>>FireLogger.start");
                observerService.addObserver(this, "http-on-modify-request", false);
                Firebug.NetMonitor.addListener(this);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            stop: function() {
                if (!this.running) return;
                this.running = false;
                dbg(">>>FireLogger.stop");
                observerService.removeObserver(this, "http-on-modify-request");
                Firebug.NetMonitor.removeListener(this);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onResponse: function(context, file) {
                dbg(">>>FireLogger.onResponse:"+file.href, context);
                this.mixinContext(context); // onResponseBody may be called before initContext, so we may need to mixin here
                context.queueFile(file);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareAuth: function(password) {
                // this must match with logger library code
                var auth = "#FireLoggerPassword#"+password+"#";
                return FireLogger.md5.hex_md5(auth);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            observe: function(subject, topic, data) {
                dbg(">>>FireLogger.observe: "+topic, data);
                if (module.isEnabled()) {
                    if (topic == "http-on-modify-request") {
                        var httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
                        // from v0.3 do not alter User-Agent, this guy on twitter had problems: http://twitter.com/lawouach/statuses/1222443299
                        // just add FireLogger version as a separate header, should be safe
                        httpChannel.setRequestHeader("X-FireLogger", this.version, false);
                        var password = FireLogger.PasswordVault.get();
                        if (password) {
                            httpChannel.setRequestHeader("X-FireLoggerAuth", this.prepareAuth(password), false);
                        }
                        if (this._enableProfiler) {
                            httpChannel.setRequestHeader("X-FireLoggerProfiler", "1", false);
                        }
                        if (this._enableAppstats) {
                            httpChannel.setRequestHeader("X-FireLoggerAppstats", "1", false);
                        }
                    }
                }
                if (topic == "nsPref:changed") {
                    this.cachePrefs();
                    this.updatePanel();
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function(prefDomain, prefNames) {
                dbg(">>>FireLogger.initialize");
                this.panelName = 'firelogger';
                this.description = "Server-side logging tools for web developers.";
                Firebug.ActivableModule.initialize.apply(this, arguments);
                this.patchChrome(getCurrentChrome(), getCurrentContext());
                this.cachePrefs();
                prefService.addObserver(this.getPrefDomain(), this, false);
                module.start();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onEnabled: function(context) {
                dbg(">>>FireLogger.onEnabled", context);
                this.registerObservers(context);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onDisabled: function(context) {
                dbg(">>>FireLogger.onDisabled", context);
                this.unregisterObservers(context);
            },            
            /////////////////////////////////////////////////////////////////////////////////////////
            shutdown: function() {
                dbg(">>>FireLogger.shutdown");
                module.stop();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onSuspendFirebug: function(context) {
                dbg(">>>FireLogger.onSuspendFirebug");
                module.stop();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onResumeFirebug: function(context) {
                dbg(">>>FireLogger.onResumeFirebug");
                module.start();
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
                            var panel = getCurrentContext().getPanel(module.panelName);
                            if (panel) {
                                panel.select(object, forceUpdate);
                                // usability: expand root item if there is only one root item
                                var watchesPanel = getCurrentContext().getPanel("fireloggerwatches");
                                if (watchesPanel) {
                                    try {
                                        var props = [];
                                        for (var prop in watchesPanel.toggles) {
                                            if (watchesPanel.toggles.hasOwnProperty(prop)) props.push(prop);
                                        }
                                        var counter = 0;
                                        for (prop in object) {
                                            if (object.hasOwnProperty(prop)) counter++;
                                        }
                                        if (props.length==0 && counter==1) {
                                            for (prop in object) {
                                                if (object.hasOwnProperty(prop)) watchesPanel.toggles[prop] = {};
                                            }
                                            watchesPanel.rebuild(true);
                                        }
                                    } catch(ex) {}
                                }
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
                dbg(">>>FireLogger.checkDependenciesOnOtherPanels");
                if ((!Firebug.NetMonitor.isEnabled(context) || !Firebug.Console.isEnabled(context)) && !context.fireLoggerWarningShown) {
                    dbg("  ... show warning");
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
                    panel.context.processRequestQueue();
                    this.checkDependenciesOnOtherPanels(panel.context);
                    this.currentPanel = panel;
                    this.updatePanel();
                
                    // default DOMPanel behavior is to show top level window object
                    // this is a good place to reset it to empty object
                    var watchesPanel = panel.context.getPanel("fireloggerwatches");
                    if (watchesPanel) {
                        watchesPanel.getDefaultSelection = function() {
                            return {};
                        };
                        watchesPanel.select({});
                    }
                } else {
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
            deferRendering: function() {
                if (!this.currentPanel) return;
                this.currentPanel.deferRendering();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            undeferRendering: function() {
                if (!this.currentPanel) return;
                this.currentPanel.undeferRendering();
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            togglePersist: function(context) {
                var panel = context.getPanel(this.panelName);
                panel.persistContent = !panel.persistContent;
                Firebug.chrome.setGlobalAttribute("cmd_FireLoggerTogglePersist", "checked", panel.persistContent);
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
                var event = this.prepareLog.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareLog: function(context, data, icon) {
                var type = "simple";
                if (data.exc_info && this._richFormatting) type = "exception";
                return new FireLoggerEvent(type, data, icon);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showRequest: function(context, data, icon) {
                var event = this.prepareRequest.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareRequest: function(context, data, icon) {
                var type = "request";
                var event = new FireLoggerEvent(type, data, icon);
                event.expanded = !module.collapsedRequests[data.url];
                event.renderedAsExpanded = true;
                return event;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showMessage: function(context, text, icon, exc_info) {
                var event = this.prepareMessage.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareMessage: function(context, text, icon, exc_info) {
                if (!icon) icon = "sys-info";
                var type = "message";
                if (exc_info) type = "messagewithexception";
                var event = new FireLoggerEvent(type, {
                    message: text,
                    time: this.getCurrentTime(),
                    exc_info: exc_info
                }, icon);
                return event;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showMessageWithData: function(context, text, data, icon) {
                var event = this.prepareMessageWithData.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareMessageWithData: function(context, text, data, icon) {
                if (!icon) icon = "sys-info";
                var type = "message";
                var event = new FireLoggerEvent(type, {
                    message: text,
                    time: this.getCurrentTime(),
                    data: data
                }, icon);
                return event;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showProfile: function(context, url, profile_info, profile_data) {
                var event = this.prepareProfile.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareProfile: function(context, url, profile_info, profile_data) {
                var type = "profile";
                var event = new FireLoggerEvent(type, {
                    message: (profile_info || "Request Profile available as Graphviz"),
                    time: this.getCurrentTime(),
                    profile_data: profile_data
                }, "sys-time");
                return event;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            showAppstats: function(context, appstats) {
                var event = this.prepareProfile.apply(this, arguments);
                this.publishEvent(context, event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            prepareAppstats: function(context, appstats) {
                var type = "appstats";
                var event = new FireLoggerEvent(type, {
                    message: "Appstats",
                    time: this.getCurrentTime(),
                    appstats: appstats
                }, "sys-appengine");
                return event;
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
                if (!this.isEnabled(context)) {
                    dbg("   ... context not enabled", arguments);
                    return;
                }
                var panel = context.getPanel(module.panelName);
                if (!panel) {
                    dbg("   ... panel not found", arguments);
                    return;
                }
                panel.publish(event);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            loadExternalEditors: function() {
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
                    externalEditors.push(item);
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
            showAppstatsTrace: function(el) {
                dbg(">>>FireLogger.showAppstatsTrace", el);
                var row = parseInt(el.getAttribute('data-row'), 10);
                var details = getAncestorByClass(el, 'rec-details');
                var appstats = details.appstatsData;
                var data = appstats.traces[row];
                var rep = Firebug.getRep(data);
                rep.inspectObject(data, getCurrentContext());
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            zoomAppstatsTable: function(td) {
                dbg(">>>FireLogger.zoomAppstatsTable", table);
                var bars, markerLast, markerLastZoom;
                var table = getAncestorByClass(td, 'rec-appstats-table');
                var zoom = parseInt(table.getAttribute('zoom'), 10);
                if (zoom) {
                    table.setAttribute('zoom', '0');
                    bars = getElementsByClass(table, 'bar-wrapper');
                    Array.forEach(bars, function(e,i,a) {
                        e.style.MozTransitionProperty = 'width';
                        e.style.MozTransitionDuration = '0.5s';
                        e.style.width = '100%';
                    }, this);
                    markerLast = getElementByClass(table, 'axis-marker-last');
                    markerLastZoom = getElementByClass(table, 'axis-marker-last-zoom');
                    markerLast.style.display = 'block';
                    markerLastZoom.style.display = 'none';
                } else {
                    table.setAttribute('zoom', '1');
                    var zoomCoef = table.getAttribute('data-zoom');
                    var coef = parseFloat(zoomCoef);
                    bars = getElementsByClass(table, 'bar-wrapper');
                    Array.forEach(bars, function(e,i,a) {
                        e.style.MozTransitionProperty = 'width';
                        e.style.MozTransitionDuration = '0.5s';
                        e.style.width = 100*(100 / zoomCoef)+'%';
                    }, this);
                    markerLast = getElementByClass(table, 'axis-marker-last');
                    markerLastZoom = getElementByClass(table, 'axis-marker-last-zoom');
                    markerLast.style.display = 'none';
                    markerLastZoom.style.display = 'block';
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            openSourceFile: function(path, line) {
                dbg(">>>FireLogger.openSourceFile", [path, line]);
                if (!path) return;
                // part PHP-style paths from eval
                // sample path: /Users/darwin/code/firelogger/tests/basic.php(62) : eval()'d code
                var m = path.match(/(.*)\(([0-9]+)\) : eval\(\)'d code$/);
                if (m) {
                    path = m[1];
                    line = parseInt(m[2], 10);
                    dbg(">>>  PHP-style eval found", [path, line]);
                }
                path = FireLogger.Rewriter.rewritePath(path);
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
                    var res = FBL.launchProgram(editor.executable, args);
                } catch (e) { 
                    alert("Failed to launch:\n"+editor.executable+" "+args.join(" ")+"\n\n"+e.message); 
                    dbg(">>>Launch exception", e); 
                }
                if (res===false) { // from FB1.5 FBL.launchProgram is not throwing, but returning false
                    alert("Failed to launch:\n"+editor.executable+" "+args.join(" "));
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            preprocessObject: function(o) {
                if (this._showInternal) return o;
        
                function isArray(o) {
                   return (o.constructor.toString().indexOf("Array") != -1);
                }
                
                var worker = function(x) {
                    if (typeof x != "object") return x;
                    if (x===null) return null; // handle special case, because typeof null === "object"
                    var res, i;
                    if (isArray(x)) {
                        res = [];
                        for (i=0; i<x.length; i++) {
                            res.push(worker(x[i]));
                        }
                    } else {
                        res = {};
                        for (i in x) {
                            if (x.hasOwnProperty(i)) {
                                if (i=="_") continue;
                                res[i] = worker(x[i]);
                            }
                        }
                    }
                    return res;
                };
                return worker(o);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getPrefDomain: function() {
                return Firebug.prefDomain + "." + this.panelName;
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
            loadFilterStates: function() {
                dbg(">>>FireLogger.loadFilterStates", arguments);
                var states = ["debug", "info", "warning", "error", "critical", "appengine"];
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
            maxAppstatsDuration: 30000, // assume 30s is maximum request duration for appengine
            timeAxisStep: 3000, // 3s
            /////////////////////////////////////////////////////////////////////////////////////////
            tagException: 
                DIV({ class: "rec-head closed $object|getIcon", onclick: "$onToggleDetails", _repObject: "$object"},
                    IMG({ class: "rec-icon", src: "blank.gif"}),
                    DIV({ class: "rec-date", title: "$object|getDateTitle" }, "$object|getDate"),
                    DIV({ class: "rec-file", onclick: "$onSourceNavigate" }, 
                        DIV({ title: "$object|getFileTitle" }, "$object|getFile")
                    ),
                    DIV({ class: "rec-logger", style:"$object|getLoggerStyle", title:"logger name" }, "$object|getLoggerName"),
                    DIV({ class: "rec-msg" }, ""),
                    DIV({ class: "rec-details" })
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagSimple:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", title: "$object|getDateTitle" }, "$object|getDate"),
                    DIV({ class: "rec-file", onclick: "$onSourceNavigate" }, 
                        DIV({ title: "$object|getFileTitle" }, "$object|getFile")
                    ),
                    DIV({ class: "rec-logger", style:"$object|getLoggerStyle", title:"logger name" }, "$object|getLoggerName"),
                    DIV({ class: "rec-msg" }, "")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagMessage:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", title: "$object|getDateTitle" }, "$object|getDate"),
                    DIV({ class: "rec-file", onclick: "$onSourceNavigate" }, 
                        DIV({ title: "$object|getFileTitle" }, "$object|getFile")
                    ),
                    DIV({ class: "rec-msg" }, "$object|getMessage")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagMessagewithexception:
                DIV({ class: "rec-head closed $object|getIcon", onclick: "$onToggleDetails", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", title: "$object|getDateTitle" }, "$object|getDate"),
                    DIV({ class: "rec-file", onclick: "$onSourceNavigate" }, 
                        DIV({ title: "$object|getFileTitle" }, "$object|getFile")
                    ),
                    DIV({ class: "rec-msg" }, "$object|getMessage"),
                    DIV({ class: "rec-details" })
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagProfile:
                DIV({ class: "rec-head $object|getIcon", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-date", title: "$object|getDateTitle" }, "$object|getDate"),
                    DIV({ class: "rec-file", onclick: "$onSourceNavigate" }, 
                        DIV({ title: "$object|getFileTitle" }, "$object|getFile")
                    ),
                    DIV({ class: "rec-msg", onclick: "$onProfileNavigate" }, "$object|getMessage")
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagAppstats:
                DIV({ class: "rec-head closed $object|getIcon", onclick: "$onToggleDetails", _repObject: "$object" },
                    IMG({ class: "rec-icon", src: "blank.gif" }),
                    DIV({ class: "rec-appstats-header" }, "$object|renderAppstatsHeader"),
                    DIV({ class: "rec-details" })
                ),
            /////////////////////////////////////////////////////////////////////////////////////////
            tagRequest:
                DIV({ class: "rec-head expanded rec-request", onclick: "$onToggleDetails", _repObject: "$object" },
                    SPAN({ class: "rec-request-url" }, "$object|getUrl"),
                    SPAN({ class: "rec-request-detail", onclick: "$onRequestDetail" }, "&#x25B6;") // BLACK RIGHT-POINTING TRIANGLE
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
            getUrl: function(event) {
                dbg(">>>FireLogger.Record.getUrl", arguments);
                return event.data.url;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getDate: function(event) {
                dbg(">>>FireLogger.Record.getDate", arguments);
                return '\u231A'; // unicode clock sign
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getDateTitle: function(event) {
                dbg(">>>FireLogger.Record.getDateTitle", arguments);
                return event.data.time;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getFile: function(event) {
                dbg(">>>FireLogger.Record.getFile", arguments);
                var pathname = event.data.pathname||"?";
                var lineno = event.data.lineno||"?";
                var formatFile = function(item) {
                    var path = item[0]||"";
                    var line = item[1];
                    var parts = path.split('/');
                    var res = parts[parts.length-1];
                    if (!res) res = "?";
                    if (line!==undefined && line!==null) res += ":"+line;
                    return res;
                };
                return formatFile([pathname, lineno]);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getFileTitle: function(event) {
                dbg(">>>FireLogger.Record.getFileTitle", arguments);
                var pathname = event.data.pathname||"?";
                var lineno = event.data.lineno||"?";
                if (pathname=="?" && lineno=="?") return "";
                var title = pathname+":"+lineno;
                return title;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getLoggerName: function(event) {
                dbg(">>>FireLogger.Record.getLogger", arguments);
                return event.data.name || "?";
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            getLoggerStyle: function(event) {
                dbg(">>>FireLogger.Record.getLoggerStyle", arguments);
                if (event.data.style) return event.data.style; // style supported by PHP backend
                var color = colorForName(event.data.name || "?"); // come up with some decent style if style not provided
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
            onRequestDetail: function(e) {
                dbg(">>>FireLogger.Record.onRequestDetail", arguments);
                if (!isLeftClick(e)) return;
                e.stopPropagation();
                var event = this.lookupEventObject(e.currentTarget);
                Firebug.chrome.selectPanel("net");
                var netPanel = getCurrentContext().getPanel('net');
                if (!netPanel) return;
                netPanel.updateSelection({request: {name:"?"}, href: event.data.url});
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onProfileNavigate: function(e) {
                dbg(">>>FireLogger.Record.onProfileNavigate", arguments);
                if (!isLeftClick(e)) return;
                e.stopPropagation();
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
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            turnSiblingRowsVisibility: function(startElement, stopper, visible) {
                var el = startElement;
                while (el = el.nextSibling) {
                    if (hasClass(el, stopper)) break;
                    el.style.display = visible?'block':'none';
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            doToggle: function(target) {
                dbg(">>>FireLogger.Record.doToggle", arguments);
                var event = this.lookupEventObject(target);
                var firelogger = getAncestorByClass(target, "firelogger-rec");
                var row = getChildByClass(firelogger, "rec-head")
                var details = getChildByClass(row, "rec-details");
        
                var isRequest = hasClass(row, "rec-request");
        
                toggleClass(row, "expanded");
                toggleClass(row, "closed");
        
                if (hasClass(row, "expanded")) {
                    event.expanded = true;
                    if (isRequest) {
                        module.collapsedRequests[event.data.url] = false;
                        this.turnSiblingRowsVisibility(firelogger, 'type-request', true);
                    } else {
                        this.showEventDetails(event, details);
                    }
                } else {
                    event.expanded = false;
                    if (isRequest) {
                        module.collapsedRequests[event.data.url] = true;
                        this.turnSiblingRowsVisibility(firelogger, 'type-request', false);
                    }
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            onToggleDetails: function(e) {
                dbg(">>>FireLogger.Record.onToggleDetails", arguments);
                if (!isLeftClick(e)) return;
                // do not toggle if clicked on locals property
                var clickedOnObjectLink = getAncestorByClass(e.target, "objectLink");
                if (clickedOnObjectLink) return;
        
                this.doToggle(e.currentTarget);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            niceDuration: function(n) {
                n = n/1000; // convert to seconds
                return Math.round(n*1000)/1000+'s';
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            formatGraph: function(start, width1, width2, hint) {
                return '<div class="bar-wrapper"><div title="'+hint+'" class="bar-duration" style="margin-left: '+start+'%; width: '+width1+'%;"></div><div title="'+hint+'" class="bar-api" style="margin-left: '+start+'%; width: '+width2+'%;"></div></div>';
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderAppstatsHeader: function(event) {
                dbg(">>>FireLogger.Record.renderAppstatsHeader", arguments);
                var appstats = event.data.appstats;
                if (!appstats) return "no appstats data available";
                var cpu = "cpu="+this.niceDuration(appstats.cpu);
                var that = this;
                var percentage = function(n) {
                    return 100*(n/that.maxAppstatsDuration); 
                };
                var width1 = percentage(appstats.duration);
                var width2 = percentage(appstats.duration+appstats.overhead);
                var hint = this.niceDuration(appstats.duration) + "/" + this.niceDuration(appstats.duration+appstats.overhead);
                var graph = this.formatGraph(0, width1, width2, hint);
                event.data.message = '<div class="appstats-cpu">'+cpu+'</div><div class="appstats-header-graph">'+graph+'</div><div class="clear-float"></div>';
                return ''; // HACK: see [***]
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderAppstats: function(root, event) {
                dbg(">>>FireLogger.Record.renderAppstats", arguments);
                var appstats = event.data.appstats;
                if (!appstats) return "no appstats data available";
                if (!appstats.traces || appstats.traces.length==0) {
                    return "no appstats traces available";
                }
                var that = this;
                var percentage = function(n) {
                    return 100*(n/that.maxAppstatsDuration); 
                };
                var max = 0;
                var s = [''];
                for (var i=0; i<appstats.traces.length; i++) {
                    var trace = appstats.traces[i];
                    s.push('<tr class="rec-appstats-row row-'+i+'">');
                    s.push('<td class="rec-appstats-call">');
                    s.push('<div title="'+escapeHTML(trace.request)+'"><a data-row="'+i+'" href="#" onclick="event.stopPropagation(); top.Firebug.FireLogger.showAppstatsTrace(this)">');
                    s.push(trace.call || "?");
                    s.push('</a></div>');
                    s.push('</td>');
                    s.push('<td class="rec-appstats-graph" onclick="event.stopPropagation();top.Firebug.FireLogger.zoomAppstatsTable(this);">');
                    var start = percentage(trace.start);
                    var width1 = percentage(trace.duration);
                    var width2 = percentage(trace.api);
                    var hint = this.niceDuration(trace.duration) + "/" + this.niceDuration(trace.api);
                    s.push(this.formatGraph(start, width1, width2, hint));
                    if (start+width1>max) max = start+width1;
                    if (start+width2>max) max = start+width2;
                    s.push('</td>');
                    s.push('</tr>');
                }
                s[0] = '<table class="rec-appstats-table" cellspacing="0" cellpadding="0" data-zoom="'+max+'">';
                // render horizontal axis
                s.push('<tr class="rec-appstats-row row-axis">');
                s.push('<td class="rec-appstats-call">');
                s.push('</td>');
                s.push('<td class="rec-appstats-graph-axis">');
                s.push('<div class="bar-wrapper">');
                for (var i=0; i<this.maxAppstatsDuration; i+=this.timeAxisStep) {
                    s.push('<div class="axis-marker" style="margin-left: '+percentage(i)+'%">'+parseInt(i/1000, 10)+'s</div>');
                }
                s.push('<div class="axis-marker-last">'+parseInt(i/1000, 10)+'s</div>');
                s.push('<div class="axis-marker-last-zoom" style="display:none; right:'+(100-max)+'%">'+this.niceDuration((max/100)*this.maxAppstatsDuration)+'</div>');
                s.push('</div>');
                s.push('</td>');
                s.push('</tr>')
                
                s.push('</table>');
                root.innerHTML = s.join('');
                
                // ok, Guido wanted graphs to be zoomed initially
                var graph = getElementByClass(root, 'rec-appstats-graph');
                if (graph) top.Firebug.FireLogger.zoomAppstatsTable(graph); // simulate click on the first graph bar
                
                root.appstatsData = appstats;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderTraceback: function(root, event) {
                dbg(">>>FireLogger.Record.renderTraceback", arguments);
                if (!event.data.exc_info) return "no exception info available";
                var exc_info = event.data.exc_info;
                if (exc_info['py/tuple']) exc_info = exc_info['py/tuple']; // FirePython specific hack
                if (!exc_info) return "no exception info available";
                var items = exc_info[2];
                if (!items) return "no traceback available";
        
                var formatFile = function(item) {
                    var path = item[0]||"";
                    var line = item[1];
                    var parts = path.split('/');
                    var res = parts[parts.length-1];
                    if (!res) res = "?";
                    if (line!==undefined && line!==null) res += ":"+line;
                    return res;
                };
                var formatFullFile = function(item) {
                    var res = item[0]||"?";
                    var line = item[1];
                    if (line!==undefined && line!==null) res += ":"+line;
                    return res;
                };
                var formatFunction = function(item) {
                    return item[2]||"";
                };
                var formatLocation = function(item) {
                    return item[3]||"";
                };
                var fileAction = function(path, line) {
                    return function() {
                        module.openSourceFile(path, line);
                    };
                };
        
                var s = ['<table class="rec-traceback-table cellspacing="0" cellpadding="0"">'];
                var fileActions = [];
                for (var i=0; i<items.length; i++) {
                    var item = items[i];
                    if (item['py/tuple']) item = item['py/tuple']; // FirePython specific hack
                    var extra = "";
                    if (i == items.length-1) extra = " current";
                    s.push('<tr class="rec-traceback-row row-'+i+''+extra+'">');
                    var path = item[0]||"";
                    var line = item[1]||"";
                    s.push('<td class="rec-traceback-icon"></td>');
                    var htmlAttrEscapedPath = formatFullFile(item).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
                    fileActions.push(fileAction(path, line));
                    s.push('<td class="rec-traceback-file" onclick="event.stopPropagation(); this.parentNode.parentNode.parentNode.fileActions['+i+']();" title="'+htmlAttrEscapedPath+'">');
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
                }
                s.push('</table>');
                root.innerHTML = s.join('');
                root.firstChild.fileActions = fileActions; // attach array of functions to the TABLE DOM node (see ^^^)
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
                switch (event.type) {
                    case "exception":
                    case "messagewithexception":
                        this.renderTraceback(details, event);
                        break;
                    case "appstats":
                        this.renderAppstats(details, event);
                        break;
                }
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
            renderDeferredCounter: 0,
            renderQueue: [],

            /////////////////////////////////////////////////////////////////////////////////////////
            onActivationChanged: function(enable) {
                dbg(">>>FireLoggerPanel.onActivationChanged enable:"+enable);
                if (enable)
                    module.addObserver(this);
                else
                    module.removeObserver(this);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            initialize: function() {
                dbg(">>>FireLoggerPanel.initialize");
                Firebug.ActivablePanel.initialize.apply(this, arguments);
                this.panelSplitter = $("fbPanelSplitter");
                this.sidePanelDeck = $("fbSidePanelDeck");
                this.applyCSS();
                this.renderQueue = [];
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            deferRendering: function() {
                this.renderDeferredCounter++;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            undeferRendering: function() {
                this.renderDeferredCounter--;
                if (!this.renderDeferredCounter) {
                    this.render();
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            enablePanel: function(module) {
                dbg(">>FireLoggerPanel.enablePanel; " + this.context.getName());
                Firebug.ActivablePanel.enablePanel.apply(this, arguments);
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
                if (!this.renderDeferredCounter) {
                    this.render();
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            clear: function() {
                dbg(">>>FireLoggerPanel.clear");
                this.renderQueue = [];
                if (this.panelNode) clearNode(this.panelNode);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            show: function(state) {
                dbg(">>>FireLoggerPanel.show", state);

                var that = this;
                var work = function() {
                    that.showToolbarButtons("fbFireLoggerFilters", true);
                    if (that.wasScrolledToBottom) {
                        scrollToBottom(that.panelNode);
                    }
                }
                
                // Firebug 1.6 removes Firebug.DisabledPanelPage, simplifies the activation
                // and the following code is not necessary any more.
                if (module.disabledPanelPage) {
                    var enabled = module.isAlwaysEnabled();
                    this.panelSplitter.collapsed = !enabled;
                    this.sidePanelDeck.collapsed = !enabled;
                    Firebug.chrome.setGlobalAttribute("cmd_FireLoggerTogglePersist", "checked", this.persistContent);
                    if (enabled) {
                         module.disabledPanelPage.hide(this);
                         work();
                    } else {
                        this.hide();
                        module.disabledPanelPage.show(this);
                    }
                } else {
                    work();
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
                var row = this.createRow("firelogger", className);
                this.appendObject.apply(this, [objects, row, rep]);
                this.renderQueue.push(row);
                return row;
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            render: function(objects, className, rep) {
                var scrolledToBottom = isScrolledToBottom(this.panelNode);
                var container = this.getTopContainer();
                for (var i=0; i < this.renderQueue.length; i++) {
                    var row = this.renderQueue[i];
                    container.appendChild(row);
                }
                this.renderQueue = [];
                if (scrolledToBottom) scrollToBottom(this.panelNode);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderFormattedMessage: function(object, row, rep) {
                var lookupArg = function(index) {
                    if (!object.data.args) return;
                    if (object.data.args["py/tuple"]) { // FirePython hack
                        return object.data.args["py/tuple"][index];
                    }
                    // is this here because of Python? -> http://github.com/darwin/firelogger/commit/33bac4a72a742dc57d5cfd9ff2aaa20751384926
                    if (index==0 && object.data.args.length===undefined) { 
                        return object.data.args;
                    }
                    return object.data.args[index];
                };
                var dest = getChildByClass(row.childNodes[0], "rec-msg");
                dest.innerHTML = "";
                var template = object.data.template;
                if (typeof template != "string") template = template._; // this is a special case for exceptions (FirePython hack)
                if (!template) template = "";
                var parts = template.split(/(%%|%[0123456789.-]*?[a-zA-Z])/);
                var i = 1;
                var eaten = 0;
                if (parts.length>0) {
                    for (i=0; i<parts.length; i++) {
                        var part = parts[i];
                        FirebugReps.Text.tag.append({object: part}, dest);
                        if (i<parts.length-1) {
                            if (parts[i+1]=='%%') {
                                // special case of escaped %
                                FirebugReps.Text.tag.append({object: "%"}, dest);
                                i++;
                            } else {
                                var arg = lookupArg(eaten);
                                if (arg!==undefined) {
                                    var r = Firebug.getRep(arg);
                                    r.tag.append({object: module.preprocessObject(arg)}, dest);
                                    i++; // skip matched delimiter
                                    eaten++;
                                } else {
                                    // arg is not available => render original text instead
                                    // see http://github.com/darwin/firepython/issues#issue/6
                                    i++;
                                    part = parts[i];
                                    FirebugReps.Text.tag.append({object: part}, dest);
                                }
                            }
                        }
                    }
                }
                // dump also unreferenced args
                if (object.data.args && object.data.args.length) {
                    if (parts.length>0) FirebugReps.Text.tag.append({object: " "}, dest);
                    var a = object.data.args;
                    if (object.data.args["py/tuple"]) a = object.data.args["py/tuple"]; // FirePython hack
                    for (var j=eaten; j<a.length; j++) {
                        if (j>eaten) FirebugReps.Text.tag.append({object: ", "}, dest);
                        var arg = lookupArg(j);
                        var r = Firebug.getRep(arg);
                        r.tag.append({object: module.preprocessObject(arg)}, dest);
                    }
                }
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            renderPlainMessage: function(object, row, rep) {
                var dest = getChildByClass(row.childNodes[0], "rec-msg");
                if (!dest) {
                    // HACK: I was unable to render arbitrary HTML in DOMPlate, see renderAppstatsHeader [***]
                    dest = getChildByClass(row.childNodes[0], "rec-appstats-header");
                    dest.innerHTML = object.data.message;
                    delete object.data.message;
                    return;
                }
                dest.innerHTML = "";
                FirebugReps.Text.tag.append({object: object.data.message}, dest);
            },
            /////////////////////////////////////////////////////////////////////////////////////////
            appendObject: function(object, row, rep) {
                dbg(">>>FireLoggerPanel.appendObject", arguments);
                var rep = rep?rep:Firebug.getRep(object);
                var typeName = "tag"+capitalize(object.type);
                setClass(row, "type-"+object.type);
                setClass(row, "icon-"+object.icon);
                var res = rep[typeName].append({ object: object }, row);
                if (object.data.message!==undefined) {
                    if (module._richFormatting && object.data.template!==undefined)
                        this.renderFormattedMessage(object, row, rep);
                    else
                        this.renderPlainMessage(object, row, rep);
                }
                if ((object.expanded && !object.renderedAsExpanded) ||
                    (!object.expanded && object.renderedAsExpanded)) {
                    setTimeout(function() {
                        rep.doToggle(row.childNodes[0].childNodes[0]);
                    }, 0); // HACK: want to be called after all rows are rendered
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
        
        ////////////////////////////////////////////////////////////////////////
        // support Logger tuples (FirePython specific)
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