// API:
// window.extraButtonPlaceholders.getPlaceholders()
// window.extraButtonPlaceholders.getPlaceholder(0)
// window.extraButtonPlaceholders.getInfo()
// window.extraButtonPlaceholders.relayout()
// window.extraButtonPlaceholders.requestRelayout()
// Как нумеруются кнопки
// Сейчас логика такая:
// 0 — одиночная кнопка
// в portrait: сверху
// в landscape: слева
// 1, 2, 3 — группа из трёх
// в portrait: снизу, слева направо
// в landscape: справа, сверху вниз

(function setupActionPlaceholders(global) {
    const DEFAULT_OPTIONS = {
        containerId: 'unity-container',
        placeholderCount: 4,
        buttonSizeFactor: 0.1079365, // 0.08
        gapFactor: 1.00,
        layoutSwitchReserveFactor: 1.00,
        portraitBottomSideInsetFactor: 0.5,
        rootClassName: 'action-placeholders-root',
        itemClassName: 'action-placeholder'
    };

    function createManager(userOptions) {
        const options = Object.assign({}, DEFAULT_OPTIONS, userOptions || {});
        const container = document.getElementById(options.containerId);

        if (!container) {
            console.warn('[ActionPlaceholders] unity-container not found');
            return null;
        }

        let root = null;
        let items = [];
        let currentLayout = null;
        let resizeRaf = 0;

        function ensureRoot() {
            if (root) return root;

            root = document.createElement('div');
            root.className = options.rootClassName;
            root.style.position = 'fixed';
            root.style.left = '0';
            root.style.top = '0';
            root.style.width = '100%';
            root.style.height = '100%';
            root.style.pointerEvents = 'none';
            root.style.zIndex = '1';
            root.style.boxSizing = 'border-box';
            root.style.transform = 'translateZ(0)';
            root.style.willChange = 'transform';

            document.body.appendChild(root);

            for (let i = 0; i < options.placeholderCount; i++) {
                const item = document.createElement('div');
                item.className = options.itemClassName;
                item.dataset.index = String(i);
                item.style.position = 'absolute';
                item.style.boxSizing = 'border-box';
                item.style.pointerEvents = 'auto';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'center';
                item.style.transform = 'translateZ(0)';
                item.style.willChange = 'transform, left, top, width, height';
                // item.style.background = 'rgba(0, 0, 0, 0.5)';
                item.style.background = 'rgba(0, 0, 0, 0)';

                root.appendChild(item);
                items.push(item);
            }

            return root;
        }

        function getViewportRect() {
            const vv = window.visualViewport;
            return {
                width: vv ? vv.width : window.innerWidth,
                height: vv ? vv.height : window.innerHeight,
                left: vv ? vv.offsetLeft : 0,
                top: vv ? vv.offsetTop : 0
            };
        }

        function getContainerRect() {
            return container.getBoundingClientRect();
        }

        function computeMetrics() {
            const viewport = getViewportRect();
            const rect = getContainerRect();

            const minCanvasSide = Math.min(rect.width, rect.height);
            const buttonSize = Math.max(1, Math.round(minCanvasSide * options.buttonSizeFactor));
            const gap = Math.max(1, Math.round(buttonSize * options.gapFactor));
            const layoutSwitchReserve = Math.max(0, Math.round(buttonSize * options.layoutSwitchReserveFactor));
            const portraitBottomSideInset = Math.max(0, Math.round(buttonSize * options.portraitBottomSideInsetFactor));

            const freeTop = rect.top - viewport.top;
            const freeBottom = (viewport.top + viewport.height) - rect.bottom;
            const freeLeft = rect.left - viewport.left;
            const freeRight = (viewport.left + viewport.width) - rect.right;

            return {
                viewport,
                rect,
                buttonSize,
                gap,
                layoutSwitchReserve,
                portraitBottomSideInset,
                freeTop,
                freeBottom,
                freeLeft,
                freeRight
            };
        }

        function getPortraitNeed(buttonSize, inset, viewportWidth) {
            return {
                top: buttonSize,
                bottom: buttonSize,
                horizontal: buttonSize * 3 + inset * 2 <= viewportWidth
            };
        }

        function getLandscapeNeed(buttonSize, gap) {
            return {
                left: buttonSize,
                right: buttonSize,
                vertical: buttonSize * 3 + gap * 2
            };
        }

        function canUsePortrait(metrics, reserve) {
            const portraitNeed = getPortraitNeed(metrics.buttonSize, metrics.portraitBottomSideInset, metrics.viewport.width);
            return (
                metrics.freeTop >= portraitNeed.top + reserve &&
                metrics.freeBottom >= portraitNeed.bottom + reserve &&
                portraitNeed.horizontal
            );
        }

        function canUseLandscape(metrics, reserve) {
            const landscapeNeed = getLandscapeNeed(metrics.buttonSize, metrics.gap);
            return (
                metrics.freeLeft >= landscapeNeed.left + reserve &&
                metrics.freeRight >= landscapeNeed.right + reserve &&
                metrics.rect.height >= landscapeNeed.vertical
            );
        }

        function choosePreferredLayout(metrics) {
            const portraitReserve = Math.min(
                metrics.freeTop - metrics.buttonSize,
                metrics.freeBottom - metrics.buttonSize
            );

            const landscapeNeed = getLandscapeNeed(metrics.buttonSize, metrics.gap);
            const landscapeReserve = Math.min(
                metrics.freeLeft - landscapeNeed.left,
                metrics.freeRight - landscapeNeed.right,
                metrics.rect.height - landscapeNeed.vertical
            );

            return portraitReserve >= landscapeReserve ? 'portrait' : 'landscape';
        }

        function chooseLayout(metrics) {
            const reserve = metrics.layoutSwitchReserve;
            const portraitFits = canUsePortrait(metrics, reserve);
            const landscapeFits = canUseLandscape(metrics, reserve);

            if (currentLayout === 'portrait' && portraitFits) return 'portrait';
            if (currentLayout === 'landscape' && landscapeFits) return 'landscape';

            if (portraitFits && !landscapeFits) return 'portrait';
            if (!portraitFits && landscapeFits) return 'landscape';

            if (portraitFits && landscapeFits) {
                return choosePreferredLayout(metrics);
            }

            const portraitFitsWithoutReserve = canUsePortrait(metrics, 0);
            const landscapeFitsWithoutReserve = canUseLandscape(metrics, 0);

            if (currentLayout === 'portrait' && portraitFitsWithoutReserve) return 'portrait';
            if (currentLayout === 'landscape' && landscapeFitsWithoutReserve) return 'landscape';

            if (portraitFitsWithoutReserve && !landscapeFitsWithoutReserve) return 'portrait';
            if (!portraitFitsWithoutReserve && landscapeFitsWithoutReserve) return 'landscape';

            return choosePreferredLayout(metrics);
        }

        function setRect(element, left, top, size) {
            element.style.left = `${Math.round(left)}px`;
            element.style.top = `${Math.round(top)}px`;
            element.style.width = `${Math.round(size)}px`;
            element.style.height = `${Math.round(size)}px`;
        }

        function applyPortrait(metrics) {
            const { rect, freeTop, freeBottom, buttonSize, portraitBottomSideInset, viewport } = metrics;

            const topX = rect.left + (rect.width - buttonSize) / 2;
            const topY = viewport.top + (freeTop - buttonSize) / 2;
            const bottomY = rect.bottom + (freeBottom - buttonSize) / 2;

            const leftX = viewport.left + portraitBottomSideInset;
            const centerX = viewport.left + (viewport.width - buttonSize) / 2;
            const rightX = viewport.left + viewport.width - portraitBottomSideInset - buttonSize;

            setRect(items[0], topX, topY, buttonSize);
            setRect(items[1], leftX, bottomY, buttonSize);
            setRect(items[2], centerX, bottomY, buttonSize);
            setRect(items[3], rightX, bottomY, buttonSize);
        }

        function applyLandscape(metrics) {
            const { rect, freeLeft, freeRight, buttonSize, gap, viewport } = metrics;

            const leftX = viewport.left + (freeLeft - buttonSize) / 2;
            const leftY = rect.top + (rect.height - buttonSize) / 2;

            const stackHeight = buttonSize * 3 + gap * 2;
            const stackTop = rect.top + (rect.height - stackHeight) / 2;
            const rightX = rect.right + (freeRight - buttonSize) / 2;

            setRect(items[0], leftX, leftY, buttonSize);
            setRect(items[1], rightX, stackTop, buttonSize);
            setRect(items[2], rightX, stackTop + buttonSize + gap, buttonSize);
            setRect(items[3], rightX, stackTop + (buttonSize + gap) * 2, buttonSize);
        }

        function relayout() {
            ensureRoot();

            const metrics = computeMetrics();
            const layout = chooseLayout(metrics);

            currentLayout = layout;

            if (layout === 'portrait') {
                applyPortrait(metrics);
            } else {
                applyLandscape(metrics);
            }
        }

        function requestRelayout() {
            cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = requestAnimationFrame(relayout);
            });
        }

        function getPlaceholder(index) {
            return items[index] || null;
        }

        function getPlaceholders() {
            return items.slice();
        }

        function getInfo() {
            return {
                layout: currentLayout,
                items: getPlaceholders()
            };
        }

        function destroy() {
            cancelAnimationFrame(resizeRaf);

            window.removeEventListener('resize', requestRelayout);
            window.removeEventListener('orientationchange', requestRelayout);

            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', requestRelayout);
                window.visualViewport.removeEventListener('scroll', requestRelayout);
            }

            if (root && root.parentNode) {
                root.parentNode.removeChild(root);
            }

            root = null;
            items = [];
            currentLayout = null;
        }

        ensureRoot();
        relayout();

        window.addEventListener('resize', requestRelayout, { passive: true });
        window.addEventListener('orientationchange', requestRelayout, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', requestRelayout, { passive: true });
            window.visualViewport.addEventListener('scroll', requestRelayout, { passive: true });
        }

        return {
            relayout,
            requestRelayout,
            destroy,
            getPlaceholder,
            getPlaceholders,
            getInfo
        };
    }

    global.ActionPlaceholders = {
        create: createManager
    };
})(window);
