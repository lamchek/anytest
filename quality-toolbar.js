(function (root, factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.attachQualityButtons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function isFiniteNum(x) { return typeof x === 'number' && isFinite(x); }

    function attachQualityButtons(debugHelper, opts) {
        opts = opts || {};
        if (!debugHelper || typeof debugHelper.setQualityFactor !== 'function' || typeof debugHelper.sample !== 'function') {
            throw new Error('attachQualityButtons: first arg must be the object returned by setupWebGLOverlayInfo()');
        }

        var corner = (opts.position || 'tr').toLowerCase(); // default to 'tr' to avoid overlapping your overlay
        var offsetX = isFiniteNum(opts.offsetX) ? opts.offsetX : 8;
        var offsetY = isFiniteNum(opts.offsetY) ? opts.offsetY : 8;
        var step = isFiniteNum(opts.step) ? opts.step : 0.1;
        var min = isFiniteNum(opts.min) ? opts.min : 0.1;
        var max = isFiniteNum(opts.max) ? opts.max : 4;
        var showSuggested = opts.showSuggestedDpr !== false;
        var z = isFiniteNum(opts.zIndex) ? opts.zIndex : 2147483647;
        var initialQuality = isFiniteNum(opts.initialQuality) ? opts.initialQuality : null;

        var bar = document.createElement('div');
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Quality controls');
        bar.style.position = 'fixed';
        bar.style[corner.indexOf('t') >= 0 ? 'top' : 'bottom'] = (offsetY | 0) + 'px';
        bar.style[corner.indexOf('l') >= 0 ? 'left' : 'right'] = (offsetX | 0) + 'px';
        bar.style.zIndex = String(z);
        bar.style.background = 'rgba(0,0,0,0.80)';
        bar.style.color = '#0f0';
        bar.style.font = '12px/1 monospace';
        bar.style.display = 'inline-flex';
        bar.style.gap = '6px';
        bar.style.alignItems = 'center';
        bar.style.padding = '4px 6px';
        bar.style.borderRadius = '4px';
        bar.style.border = '1px solid #0f0';
        bar.style.pointerEvents = 'auto';
        bar.style.userSelect = 'none';

        function mkBtn(txt, title) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = txt;
            if (title) b.title = title;
            b.style.width = '22px';
            b.style.height = '22px';
            b.style.lineHeight = '20px';
            b.style.textAlign = 'center';
            b.style.background = 'transparent';
            b.style.color = '#0f0';
            b.style.border = '1px solid #0f0';
            b.style.borderRadius = '3px';
            b.style.cursor = 'pointer';
            b.style.padding = '0';
            b.style.minWidth = '22px';
            return b;
        }

        var minus = mkBtn('–', 'Decrease quality (Shift: x5 step, Alt: x0.5 step)');
        var plus = mkBtn('+', 'Increase quality (Shift: x5 step, Alt: x0.5 step)');
        var label = document.createElement('span');
        label.textContent = 'Q: —';
        label.style.minWidth = '110px';

        bar.appendChild(minus);
        bar.appendChild(label);
        bar.appendChild(plus);

        function clamp(v) { return Math.max(min, Math.min(max, v)); }
        function baseStep(ev) {
            var k = step;
            if (ev && ev.shiftKey) k *= 5;
            if (ev && ev.altKey) k *= 0.5;
            return k;
        }
        function safeSample() {
            try { return debugHelper.sample(); } catch (e) { return {}; }
        }
        function getQ() {
            var s = safeSample();
            if (initialQuality != null) return initialQuality;
            return isFiniteNum(s.qualityFactorWanted) ? s.qualityFactorWanted : 1;
        }
        function setQ(q) {
            initialQuality = null;
            q = clamp(+q);
            debugHelper.setQualityFactor(q);
            if (typeof debugHelper.update === 'function') {
                try { debugHelper.update(); } catch (_) {}
            }
            refresh();
            if (typeof opts.onChange === 'function') {
                var s = safeSample();
                opts.onChange(q, s.suggestedConfigDPR, s);
            }
        }
        function refresh() {
            var s = safeSample();
            var q = isFiniteNum(s.qualityFactorWanted) ? s.qualityFactorWanted : getQ();
            var text = 'Q: ' + (isFiniteNum(q) ? q.toFixed(2) : '—');
            if (showSuggested && isFiniteNum(s.suggestedConfigDPR)) {
                text += '  → dpr ' + (+s.suggestedConfigDPR).toFixed(2);
            }
            label.textContent = text;
        }

        minus.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            setQ(getQ() - baseStep(ev));
        });
        plus.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            setQ(getQ() + baseStep(ev));
        });

// Keep label updated on viewport/DPR changes
        var unsubs = [];
        function on(t, e, f, o) {
            if (t && t.addEventListener) {
                t.addEventListener(e, f, o || false);
                unsubs.push(function () { try { t.removeEventListener(e, f, o || false); } catch (_) {} });
            }
        }
        on(window, 'resize', refresh);
        on(window, 'orientationchange', function () { setTimeout(refresh, 50); });
        if (window.visualViewport) {
            on(window.visualViewport, 'resize', refresh);
            on(window.visualViewport, 'scroll', refresh);
        }
        try {
            var mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
            if (mq && mq.addEventListener) on(mq, 'change', refresh);
        } catch (_) {}

        function ensureAppended() {
            if (document.body) {
                try { if (!bar.parentNode) document.body.appendChild(bar); } catch (_) {}
                refresh();
            } else {
                document.addEventListener('DOMContentLoaded', function onDom() {
                    document.removeEventListener('DOMContentLoaded', onDom);
                    ensureAppended();
                });
            }
        }
        ensureAppended();

        if (initialQuality != null) {
            setQ(initialQuality);
        } else {
            refresh();
        }

        function destroy() {
            unsubs.forEach(function (off) { try { off(); } catch (_) {} });
            unsubs.length = 0;
            try { bar.parentNode && bar.parentNode.removeChild(bar); } catch (_) {}
        }

        return {
            element: bar,
            refresh: refresh,
            setQuality: setQ,
            destroy: destroy
        };
    }

    return attachQualityButtons;
});
