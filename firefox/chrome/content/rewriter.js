var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
const rewritesColumns = ["original", "flags", "replacement"];
const rewritesPrefName = "extensions.firepython.rewrites";

var rewriter = {
    /////////////////////////////////////////////////////////////////////////////////////////
    rewritePath: function(path, details) {
        var rules = this.loadItems();
        var result = path;
        var op = "no matching rule found";
        for (var i=0; i<rules.length; i++) {
            try {
                var rule = rules[i];
                var r = new RegExp(rule.original, rule.flags);
                if (path.match(r)) {
                    result = path.replace(r, rule.replacement);
                    op = "matched rule #"+(i+1);
                    break;
                }
            } catch (e) {
                op = "error in rule #"+(i+1)+": "+e.message;
                break;
            }
        }
        if (!details) return result;
        return [result, op];
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    loadItem: function(id) {
        var item = {id:id, flags:"", original:"", replacement:""};
        for (var i=0; i<rewritesColumns.length; ++i) {
            try {
                item[rewritesColumns[i]] = prefs.getCharPref(rewritesPrefName+"."+item.id+"."+rewritesColumns[i]);
            } catch (e) {}
        }
        return item;
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    saveItem: function(item) {
        for (var i=0; i<rewritesColumns.length; ++i) {
            var value = item[rewritesColumns[i]];
            try {
                if (value) {
                    prefs.setCharPref(rewritesPrefName+"."+item.id+"."+rewritesColumns[i], value);
                } else {
                    prefs.clearUserPref(rewritesPrefName+"."+item.id+"."+rewritesColumns[i]);
                }
            } catch (e) {}
        }
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    loadItems: function() {
        var data = [];
        var list = prefs.getCharPref(rewritesPrefName).split(",");
        for (var i=0; i<list.length; ++i) {
            var id = list[i];
            if (!id) continue;
            data.push(this.loadItem(id));
        }
        return data;
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    moveUpItem: function(item) {
        var rules = [];
        var prefString = prefs.getCharPref(rewritesPrefName);
        if (prefString) rules = prefString.split(",");
        var index = rules.indexOf(item.id);
        if (index==-1) return;
        if (index==0) return;
        rules[index] = rules[index-1];
        rules[index-1] = item.id;
        prefs.setCharPref(rewritesPrefName, rules.join(","));
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    moveDownItem: function(item) {
        var rules = [];
        var prefString = prefs.getCharPref(rewritesPrefName);
        if (prefString) rules = prefString.split(",");
        var index = rules.indexOf(item.id);
        if (index==-1) return;
        if (index==rules.length-1) return;
        rules[index] = rules[index+1];
        rules[index+1] = item.id;
        prefs.setCharPref(rewritesPrefName, rules.join(","));
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    addItem: function(item) {
        item.id = parseInt(Math.random()*1000000000, 10);
        this.saveItem(item);
        var rules = [];
        var prefString = prefs.getCharPref(rewritesPrefName);
        if (prefString) rules = prefString.split(",");
        rules.push(item.id);
        prefs.setCharPref(rewritesPrefName, rules.join(","));
    },
    /////////////////////////////////////////////////////////////////////////////////////////
    removeItem: function(item) {
        var remove = function(list, item) {
            for (var i=0; i<list.length; ++i) {
                if (list[i] == item) {
                    list.splice(i, 1);
                    break;
                }
            }
        };
        var rules = prefs.getCharPref(rewritesPrefName).split(",");
        remove(rules, item.id);
        prefs.setCharPref(rewritesPrefName, rules.join(","));
        prefs.deleteBranch(rewritesPrefName+"."+item.id);
    }
};