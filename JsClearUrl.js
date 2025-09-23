// this must live in your WebGL template’s global scope
function clearURL() {
    console.log("clearURL: (JS): ");
    // build a URL with exactly the same origin+path but no query
    var base = window.location.origin + window.location.pathname;
    // replace the current history entry’s URL
    history.replaceState(/*state*/null, /*title*/"", /*url*/base);
    // ↳ no reload, no navigation, no “unload” event
}
