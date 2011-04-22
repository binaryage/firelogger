FireLogger.RuleEvents = {
    onLoad: function() {
        var item = window.arguments[0];
        document.getElementById("original").value = item.original;
        document.getElementById("flags").value = item.flags;
        document.getElementById("replacement").value = item.replacement;
        FireLogger.RuleEvents.onChange();
    },
    onAccept:function() {
        var item = window.arguments[0];
        item.original = document.getElementById("original").value;
        item.flags = document.getElementById("flags").value;
        item.replacement = document.getElementById("replacement").value;
        window.arguments[1].saveChanges = true;
    },
    onChange:function() {
        var hasOriginal = document.getElementById("original").value!="";
        var hasReplacement = document.getElementById("replacement").value!="";
        document.documentElement.getButton("accept").disabled = !hasOriginal || !hasReplacement;
    }    
};