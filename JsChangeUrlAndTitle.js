// this must live in your WebGL template’s global scope
function changeUrlAndTitle(newUrl, newTitle) {
    console.log("changeUrlAndTitle: (JS): newUrl: ", newUrl, ", newTitle: ", newTitle);
    history.replaceState(null, '', newUrl);
    /*  or, if you want to create a new history entry:
    window.history.pushState(null, '', url); */
    document.title = newTitle;
}
