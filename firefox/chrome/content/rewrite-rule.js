var item;

function onLoad() {
    item = window.arguments[0];
    document.getElementById("original").value = item.original;
    document.getElementById("flags").value = item.flags;
    document.getElementById("replacement").value = item.replacement;
    onChange();
}

function onAccept() {
    item.original = document.getElementById("original").value;
    item.flags = document.getElementById("flags").value;
    item.replacement = document.getElementById("replacement").value;
    window.arguments[1].saveChanges = true;
}

function onChange() {
    var hasOriginal = document.getElementById("original").value!="";
    var hasReplacement = document.getElementById("replacement").value!="";
    document.documentElement.getButton("accept").disabled = !hasOriginal || !hasReplacement;
}