(function (root, factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.setupWebGLOverlayInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function setupWebGLOverlayInfo(options) {
        options = options || {};
        var canvas = elemOrQuery(options.canvas);
        var container = elemOrQuery(options.container);
        var config = options.config || (typeof window !== 'undefined' ? window.config : null) || {};
        var targetQuality = typeof options.qualityFactor === 'number' ? options.qualityFactor : null;
        var consoleLog = !!options.consoleLog;
        var corner = (options.position || 'bl').toLowerCase(); // 'tl','tr','bl','br'
        var toggleKey = (options.toggleKey || 'D').toUpperCase();
        var requireAlt = options.requireAltKey !== false; // default Alt+D
        var autoAppend = options.autoAppend !== false;

        var overlay = document.createElement('div');
        var zMax = 2147483647; // max 32-bit signed int
        overlay.style.position = 'fixed';
        overlay.style[corner.indexOf('t') >= 0 ? 'top' : 'bottom'] = '8px';
        overlay.style[corner.indexOf('l') >= 0 ? 'left' : 'right'] = '8px';
        overlay.style.zIndex = String(zMax);
        overlay.style.background = 'rgba(0,0,0,0.75)';
        overlay.style.color = '#0f0';
        overlay.style.font = '12px/1.25 monospace';
        overlay.style.whiteSpace = 'pre';
        overlay.style.padding = '8px';
        overlay.style.borderRadius = '4px';
        overlay.style.pointerEvents = 'none';
        overlay.style.maxWidth = '90vw';
        overlay.style.maxHeight = '90vh';
        overlay.style.overflow = 'auto';
        overlay.textContent = 'overlay initializing...';

        var appended = false;
        function ensureAppended() {
            if (!autoAppend || appended) return;
            var target = document.body || document.documentElement;
            if (target) {
                target.appendChild(overlay);
                appended = true;
            } else {
                document.addEventListener('DOMContentLoaded', function onDom() {
                    document.removeEventListener('DOMContentLoaded', onDom);
                    ensureAppended();
                });
            }
        }

        function isIOS() {
            var ua = navigator.userAgent || '';
            var iOSUA = /iPad|iPhone|iPod/.test(ua);
            var iPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            return iOSUA || iPadOS;
        }

        function n(x) {
            return typeof x === 'number' && isFinite(x) ? x : NaN;
        }
        function fix(x, k) {
            return isFinite(x) ? +x.toFixed(k || 3) : null;
        }

        function sample() {
            var vpMeta = document.querySelector('meta[name="viewport"]');
            var dpr = n(window.devicePixelRatio) || 1;
            var vv = window.visualViewport;
            var scale = vv ? n(vv.scale) || 1 : 1;
            var cssViewportW = Math.round(document.documentElement.clientWidth || 0);
            var cssViewportH = Math.round(document.documentElement.clientHeight || 0);

            var canvasRect = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
            var canvasCSSW = Math.round(canvasRect.width || 0);
            var canvasCSSH = Math.round(canvasRect.height || 0);
            var bufferW = canvas && typeof canvas.width === 'number' ? canvas.width : 0;
            var bufferH = canvas && typeof canvas.height === 'number' ? canvas.height : 0;

            var confDPR = (config && typeof config.devicePixelRatio === 'number') ? config.devicePixelRatio : NaN;
            var dprTimesScale = dpr * (scale || 1);
            var effectiveQuality = (isFinite(confDPR) && dprTimesScale) ? (confDPR / dprTimesScale) : NaN;

            var expectedW = (canvasCSSW && isFinite(confDPR)) ? Math.round(canvasCSSW * confDPR) : NaN;
            var expectedH = (canvasCSSH && isFinite(confDPR)) ? Math.round(canvasCSSH * confDPR) : NaN;

            var containerCSS = container
                ? (Math.round(container.clientWidth) + 'x' + Math.round(container.clientHeight))
                : '(none)';

            var data = {
                ua: navigator.userAgent,
                isIOS: !!isIOS(),
                mobileUA: /Mobi|Android/i.test(navigator.userAgent || ''),
                dpr: fix(dpr),
                vvScale: fix(scale),
                dprTimesScale: fix(dprTimesScale),
                configDevicePixelRatio: fix(confDPR),
                effectiveQualityFactor: fix(effectiveQuality),
                qualityFactorWanted: (targetQuality != null) ? targetQuality : null,
                suggestedConfigDPR: (targetQuality != null) ? fix(dprTimesScale * targetQuality) : null,
                viewportCSS: cssViewportW + 'x' + cssViewportH,
                containerCSS: containerCSS,
                canvasCSS: canvasCSSW + 'x' + canvasCSSH,
                canvasBuffer: bufferW + 'x' + bufferH,
                expectedBufferFromCSSxConfig: (isFinite(expectedW) && isFinite(expectedH)) ? (expectedW + 'x' + expectedH) : '(n/a)',
                metaViewport: vpMeta ? vpMeta.content : '(none)',
                matchWebGLToCanvasSize: (config && typeof config.matchWebGLToCanvasSize !== 'undefined') ? !!config.matchWebGLToCanvasSize : '(unknown)',
                orientation: (screen.orientation && screen.orientation.type) || String(window.orientation || 'unknown')
            };
            return data;
        }

        function format(o) {
            var lines = [];
            lines.push('WebGL Overlay Info');
            lines.push('UA iOS: ' + o.isIOS + '  mobileUA: ' + o.mobileUA);
            lines.push('dpr: ' + o.dpr + '  vv.scale: ' + o.vvScale + '  dpr*scale: ' + o.dprTimesScale);
            lines.push('config.dpr: ' + o.configDevicePixelRatio + '  quality: ' + o.effectiveQualityFactor +
                (o.qualityFactorWanted != null ? ('  targetQ: ' + o.qualityFactorWanted + '  suggest config.dpr: ' + o.suggestedConfigDPR) : ''));
            lines.push('viewportCSS: ' + o.viewportCSS);
            lines.push('containerCSS: ' + o.containerCSS);
            lines.push('canvasCSS: ' + o.canvasCSS + '  canvasBuffer: ' + o.canvasBuffer);
            lines.push('expectedBuffer: ' + o.expectedBufferFromCSSxConfig);
            lines.push('matchWebGLToCanvasSize: ' + o.matchWebGLToCanvasSize);
            lines.push('meta viewport: ' + o.metaViewport);
            lines.push('orientation: ' + o.orientation);
            return lines.join('\n');
        }

        function update(log) {
            try {
                var data = sample();
                overlay.textContent = format(data);
                ensureAppended();
                if (log || consoleLog) {
                    if (console.groupCollapsed) console.groupCollapsed('[WebGL Overlay Info]');
                    if (console.table) console.table(data); else console.log('Info:', data);
                    console.log('Full:', data);
                    if (console.groupEnd) console.groupEnd();
                }
            } catch (e) {
                if (console && console.warn) console.warn('Overlay info update failed:', e);
            }
        }

        function setQualityFactor(q) {
            targetQuality = (typeof q === 'number') ? q : null;
            update(false);
        }

        function setConfig(newConfig) {
            config = newConfig || config;
            update(false);
        }

        function setCanvas(newCanvas) {
            canvas = elemOrQuery(newCanvas) || canvas;
            update(false);
        }

        function setContainer(newContainer) {
            container = elemOrQuery(newContainer) || container;
            update(false);
        }

        function setOverlayVisible(visible) {
            overlay.style.display = visible === false ? 'none' : 'block';
        }

// Event wiring
        var unsubs = [];
        function on(target, evt, fn, opts) {
            if (target && target.addEventListener) {
                target.addEventListener(evt, fn, opts || false);
                unsubs.push(function () { try { target.removeEventListener(evt, fn, opts || false); } catch(e){} });
            }
        }

        on(window, 'resize', function(){ update(false); });
        on(window, 'orientationchange', function(){ setTimeout(function(){ update(false); }, 50); });
        if (window.visualViewport) {
            on(window.visualViewport, 'resize', function(){ update(false); });
            on(window.visualViewport, 'scroll', function(){ update(false); });
        }
        try {
            var mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
            if (mq && mq.addEventListener) {
                on(mq, 'change', function(){ update(false); });
            }
        } catch(_) {}

        on(window, 'keydown', function(ev){
            var key = (ev.key || '').toUpperCase();
            if (key === toggleKey && (!requireAlt || ev.altKey)) {
                overlay.style.display = (overlay.style.display === 'none') ? 'block' : 'none';
            }
        });

// Initial and a few delayed updates (to catch late layout and Unity buffer sizing).
        update(true);
        var timers = [
            setTimeout(function(){ update(true); }, 100),
            setTimeout(function(){ update(true); }, 500),
            setTimeout(function(){ update(true); }, 1500)
        ];

        function destroy() {
            timers.forEach(function(t){ try { clearTimeout(t); } catch(e){} });
            unsubs.forEach(function(off){ try { off(); } catch(e){} });
            unsubs.length = 0;
            if (overlay && overlay.parentNode) {
                try { overlay.parentNode.removeChild(overlay); } catch(e){}
            }
        }

        function elemOrQuery(ref) {
            if (!ref) return null;
            if (typeof ref === 'string') return document.querySelector(ref);
            return ref;
        }

        return {
            update: function(){ update(true); },
            sample: sample,
            overlay: overlay,
            setQualityFactor: setQualityFactor,
            setConfig: setConfig,
            setCanvas: setCanvas,
            setContainer: setContainer,
            setOverlayVisible: setOverlayVisible,
            destroy: destroy
        };
    }

    return setupWebGLOverlayInfo;
});
