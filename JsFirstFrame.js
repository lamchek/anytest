function firstFrame() {
    console.warn("JsFirstFrame: first frame received from Unity.");

    const buildInfo = document.getElementById("build-info");
    if (buildInfo) {
        buildInfo.style.display = "none";
    }
    
    if (window.BritlinesLoadingOverlay &&
        typeof window.BritlinesLoadingOverlay.notifyFirstFrame === "function") {
        window.BritlinesLoadingOverlay.notifyFirstFrame();
        return;
    }

    window.dispatchEvent(new CustomEvent("BritlinesFirstFrame"));
}
