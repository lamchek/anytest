(function (global) {
    'use strict';

    const DEFAULT_CONFIGURATION = {
        unityCanvasId: 'unity-canvas',
        unityContainerId: 'unity-container',

        sliderMinValue: 0,
        sliderMaxValue: 1,
        sliderStepValue: 0.001,
        sliderInitialValue: 1,

        desiredSliderLongSidePixels: 260,
        desiredSliderThicknessPixels: 36,
        controlContainerPaddingPixels: 0, // for remove black background
        outwardGutterMarginPixels: 12,
        overlayInsideCanvasMarginPixels: 12,

        maxVerticalLengthFactorOfCanvas: 0.9,
        maxHorizontalLengthFactorOfCanvas: 0.9,
        maxLengthFactorOfViewport: 0.9,

        containerZIndex: 10000,
        containerBackgroundCss: 'transparent', // for remove black background
        containerBorderRadiusPixels: 0, // for remove black background

        // Новое: параметры возврата
        returnToMaxDurationMs: 1500,
        
        // Новое: параметры скина
        sliderThumbImageUrl: 'TemplateData/thumb.png',     // например: 'thumb.png'
        sliderTrackImageUrl: 'TemplateData/track.png',     // например: 'track.png'
        thumbWidthPixels: 64,        // по умолчанию = desiredSliderThicknessPixels
        thumbHeightPixels: 64,       // по умолчанию = desiredSliderThicknessPixels
        thumbBorderRadiusPixels: 0, // по умолчанию 50% (круг)
        trackBorderRadiusPixels: 0, // по умолчанию = половина толщины
        trackBackgroundSize: '100% 100%', // 'contain' / 'cover' / '100% 100%'
        trackBackgroundRepeat: 'no-repeat',
        thumbBackgroundSize: 'contain'  // 'contain' / 'cover' / '100% 100%'
    };

    const PLACEMENT_MODES = {
        LANDSCAPE_LEFT_VERTICAL_MAX_TOP: 'LANDSCAPE_LEFT_VERTICAL_MAX_TOP',
        TOP_HORIZONTAL_MAX_LEFT: 'TOP_HORIZONTAL_MAX_LEFT',
        PORTRAIT_RIGHT_VERTICAL_MAX_TOP: 'PORTRAIT_RIGHT_VERTICAL_MAX_TOP'
    };

    const INTERNAL_STATE = {
        hasCreatedDom: false,
        isShown: false,
        config: { ...DEFAULT_CONFIGURATION },

        containerElement: null,
        frameElement: null,
        sliderElement: null,

        currentPlacementMode: null,
        resizeObserverForCanvas: null,
        resizeObserverForContainer: null,

        pointerDragState: {
            isPointerDownOnThumb: false,
            hasAnyChangeWhilePointerDown: false
        },
        returnAnimationState: {
            active: false,
            rafId: 0,
            startTime: 0,
            startValue: 1
        }
    };

    const ExtSliderPositioner = {
        createAndInitializeExternalSliderControlsIfNeeded,
        showExternalSliderControlsAndPositionImmediately,
        hideExternalSliderControls,
        recalculateAndRepositionExternalSliderNow,
        setSliderValueAndPushToUnity,
        getElements: () => ({
            container: INTERNAL_STATE.containerElement,
            frame: INTERNAL_STATE.frameElement,
            slider: INTERNAL_STATE.sliderElement
        }),
        configure: (partialConfig) => Object.assign(INTERNAL_STATE.config, partialConfig || {})
    };

    function createAndInitializeExternalSliderControlsIfNeeded(optionalConfig) {
        if (optionalConfig) Object.assign(INTERNAL_STATE.config, optionalConfig);
        if (INTERNAL_STATE.hasCreatedDom) return;

        let container = document.getElementById('ext-controls');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ext-controls';
            document.body.appendChild(container);
        }

        Object.assign(container.style, {
            position: 'fixed',
            left: '0px',
            top: '0px',
            zIndex: String(INTERNAL_STATE.config.containerZIndex),
            display: 'block',
            background: INTERNAL_STATE.config.containerBackgroundCss,
            borderRadius: INTERNAL_STATE.config.containerBorderRadiusPixels + 'px',
            boxSizing: 'border-box',
            padding: INTERNAL_STATE.config.controlContainerPaddingPixels + 'px',
            userSelect: 'none'
        });

        while (container.firstChild) container.removeChild(container.firstChild);

        const frame = document.createElement('div');
        frame.className = 'ext-slider-frame';
        Object.assign(frame.style, {
            position: 'relative',
            width: '0px',
            height: '0px',
            display: 'block'
        });

        const slider = document.createElement('input');
        slider.id = 'ext-slider';
        slider.type = 'range';
        slider.min = String(INTERNAL_STATE.config.sliderMinValue);
        slider.max = String(INTERNAL_STATE.config.sliderMaxValue);
        slider.step = String(INTERNAL_STATE.config.sliderStepValue);
        slider.value = String(INTERNAL_STATE.config.sliderInitialValue);

        Object.assign(slider.style, {
            position: 'absolute',
            left: '50%',
            top: '50%',
            transformOrigin: '50% 50%',
            transform: 'translate(-50%, -50%)',
            width: INTERNAL_STATE.config.desiredSliderLongSidePixels + 'px',
            height: INTERNAL_STATE.config.desiredSliderThicknessPixels + 'px',
            margin: '0',
            padding: '0',
            WebkitAppearance: 'none',
            appearance: 'none',
            background: 'transparent',
            // чтобы не прокручивалась страница при перетаскивании, но не ломать нативный drag
            touchAction: 'manipulation',
            outline: 'none',
            border: 'none'
        });

        // Инжектируем стили для скина (картинки для трека и бегунка)
        injectOneTimeCssForCustomSliderSkin();
        // Применяем значения скина из конфигурации на CSS-переменные
        applySkinFromConfigToElement(slider, INTERNAL_STATE.config);

        // Значение -> Unity
        slider.addEventListener('input', handleSliderInputOrChange_PushToUnity);
        slider.addEventListener('change', handleSliderInputOrChange_PushToUnity);

        // Обработчики pointer/mouse/touch без preventDefault
        attachPointerDragHandlersToSlider(slider);

        frame.appendChild(slider);
        container.appendChild(frame);

        INTERNAL_STATE.containerElement = container;
        INTERNAL_STATE.frameElement = frame;
        INTERNAL_STATE.sliderElement = slider;

        container.hidden = true;

        attachRepositionEventHandlersOnce();
        tryAttachCanvasResizeObserver();
        tryAttachContainerResizeObserver();

        INTERNAL_STATE.hasCreatedDom = true;
    }

    function showExternalSliderControlsAndPositionImmediately() {
        createAndInitializeExternalSliderControlsIfNeeded();
        INTERNAL_STATE.containerElement.hidden = false;
        INTERNAL_STATE.isShown = true;

        recalculateAndRepositionExternalSliderNow();
        handleSliderInputOrChange_PushToUnity();
    }

    function hideExternalSliderControls() {
        if (!INTERNAL_STATE.hasCreatedDom) return;
        INTERNAL_STATE.containerElement.hidden = true;
        INTERNAL_STATE.isShown = false;
    }

    function recalculateAndRepositionExternalSliderNow() {
        if (!INTERNAL_STATE.hasCreatedDom || INTERNAL_STATE.containerElement.hidden) return;

        const viewportRect = getCurrentVisualViewportRect();
        const canvasRect = getUnityCanvasClientRect();
        if (!canvasRect) return;

        const calculatedGutters = computeCanvasGuttersRelativeToViewport(canvasRect, viewportRect);
        const chosenPlacementMode = selectSliderPlacementModeBasedOnOrientationAndGutters(viewportRect, canvasRect, calculatedGutters);

        applyChosenSliderPlacementMode(chosenPlacementMode, viewportRect, canvasRect, calculatedGutters);
    }

    // 1) ресайз-триггер
    function handleWindowOrViewportResizeRepositionRequest() {
        recalculateAndRepositionExternalSliderNow();
    }

    // 2) расчёт отступов вокруг canvas
    function computeCanvasGuttersRelativeToViewport(canvasRect, viewportRect) {
        const left = Math.max(0, canvasRect.left);
        const right = Math.max(0, viewportRect.vw - canvasRect.right);
        const top = Math.max(0, canvasRect.top);
        const bottom = Math.max(0, viewportRect.vh - canvasRect.bottom);
        return { left, right, top, bottom };
    }

    // 3) выбор сценария
    function selectSliderPlacementModeBasedOnOrientationAndGutters(viewportRect, canvasRect, gutters) {
        const cfg = INTERNAL_STATE.config;
        const isLandscape = viewportRect.vw >= viewportRect.vh;

        const containerPadding = cfg.controlContainerPaddingPixels * 2;
        const verticalControlTotalWidth = cfg.desiredSliderThicknessPixels + containerPadding;
        const horizontalControlTotalHeight = cfg.desiredSliderThicknessPixels + containerPadding;

        if (isLandscape) {
            if (gutters.left >= (verticalControlTotalWidth + cfg.outwardGutterMarginPixels)) {
                return PLACEMENT_MODES.LANDSCAPE_LEFT_VERTICAL_MAX_TOP;
            }
            return PLACEMENT_MODES.TOP_HORIZONTAL_MAX_LEFT;
        } else {
            if (gutters.top >= (horizontalControlTotalHeight + cfg.overlayInsideCanvasMarginPixels)) {
                return PLACEMENT_MODES.TOP_HORIZONTAL_MAX_LEFT;
            }
            return PLACEMENT_MODES.PORTRAIT_RIGHT_VERTICAL_MAX_TOP;
        }
    }

    // 4) применение позиции
    function applyChosenSliderPlacementMode(mode, viewportRect, canvasRect) {
        INTERNAL_STATE.currentPlacementMode = mode;

        switch (mode) {
            case PLACEMENT_MODES.LANDSCAPE_LEFT_VERTICAL_MAX_TOP:
                positionSliderLeftOfCanvasVertically_MaxTop(viewportRect, canvasRect);
                break;

            case PLACEMENT_MODES.TOP_HORIZONTAL_MAX_LEFT:
                positionSliderAboveCanvasHorizontally_MaxLeft(viewportRect, canvasRect);
                break;

            case PLACEMENT_MODES.PORTRAIT_RIGHT_VERTICAL_MAX_TOP:
            default:
                positionSliderRightOfCanvasVertically_MaxTop(viewportRect, canvasRect);
                break;
        }
    }

    // Конкретные позиции
    function positionSliderLeftOfCanvasVertically_MaxTop(viewportRect, canvasRect) {
        const { totalWidth, totalHeight } = setSliderOrientationAndFrameSize('verticalMaxTop', viewportRect, canvasRect);
        const cfg = INTERNAL_STATE.config;

        const x = Math.round(canvasRect.left - cfg.outwardGutterMarginPixels - totalWidth);
        const yCentered = Math.round(canvasRect.top + (canvasRect.height - totalHeight) / 2);

        placeContainerAtViewportPositionClamped(x, yCentered, totalWidth, totalHeight, viewportRect);
    }

    function positionSliderRightOfCanvasVertically_MaxTop(viewportRect, canvasRect) {
        const { totalWidth, totalHeight } = setSliderOrientationAndFrameSize('verticalMaxTop', viewportRect, canvasRect);
        const cfg = INTERNAL_STATE.config;

        const x = Math.round(canvasRect.right + cfg.outwardGutterMarginPixels);
        const yCentered = Math.round(canvasRect.top + (canvasRect.height - totalHeight) / 2);

        placeContainerAtViewportPositionClamped(x, yCentered, totalWidth, totalHeight, viewportRect);
    }

    function positionSliderAboveCanvasHorizontally_MaxLeft(viewportRect, canvasRect) {
        const { totalWidth, totalHeight } = setSliderOrientationAndFrameSize('horizontalMaxLeft', viewportRect, canvasRect);
        const cfg = INTERNAL_STATE.config;

        const xCentered = Math.round(canvasRect.left + (canvasRect.width - totalWidth) / 2);
        const y = Math.round(canvasRect.top - cfg.overlayInsideCanvasMarginPixels - totalHeight);

        placeContainerAtViewportPositionClamped(xCentered, y, totalWidth, totalHeight, viewportRect);
    }

    // размеры + поворот + скин
    function setSliderOrientationAndFrameSize(orientationKey, viewportRect, canvasRect) {
        const cfg = INTERNAL_STATE.config;
        const container = INTERNAL_STATE.containerElement;
        const frame = INTERNAL_STATE.frameElement;
        const slider = INTERNAL_STATE.sliderElement;

        const pad = cfg.controlContainerPaddingPixels;

        // Базовые длина/толщина
        let length, thickness;
        let transformRotation;

        if (orientationKey === 'verticalMaxTop') {
            const maxLenVsCanvas = Math.max(24, Math.floor(canvasRect.height * cfg.maxVerticalLengthFactorOfCanvas));
            const maxLenVsViewport = Math.max(24, Math.floor(viewportRect.vh * cfg.maxLengthFactorOfViewport));
            length = Math.min(cfg.desiredSliderLongSidePixels, maxLenVsCanvas, maxLenVsViewport);
            thickness = cfg.desiredSliderThicknessPixels;
            transformRotation = 'rotate(-90deg)'; // max сверху
        } else {
            const maxLenVsCanvas = Math.max(24, Math.floor(canvasRect.width * cfg.maxHorizontalLengthFactorOfCanvas));
            const maxLenVsViewport = Math.max(24, Math.floor(viewportRect.vw * cfg.maxLengthFactorOfViewport));
            length = Math.min(cfg.desiredSliderLongSidePixels, maxLenVsCanvas, maxLenVsViewport);
            thickness = cfg.desiredSliderThicknessPixels;
            transformRotation = 'rotate(180deg)'; // max слева
        }

        // Размеры бегунка (могут быть больше толщины)
        const thumbW = (cfg.thumbWidthPixels != null ? cfg.thumbWidthPixels : thickness) | 0;
        const thumbH = (cfg.thumbHeightPixels != null ? cfg.thumbHeightPixels : thickness) | 0;

        // «Поперечный» размер зоны клика/перетаскивания (чтобы не обрезать большой бегунок)
        const clickboxCross = Math.max(thickness, Math.max(thumbW, thumbH));

        // Проставляем CSS-переменные для скина
        slider.style.setProperty('--slider-thickness', Math.round(thickness) + 'px');
        slider.style.setProperty('--thumb-width', Math.round(thumbW) + 'px');
        slider.style.setProperty('--thumb-height', Math.round(thumbH) + 'px');

        // Вычисление габаритов контейнеров и самого input
        let frameWidth, frameHeight;
        let sliderCssWidth, sliderCssHeight;

        if (orientationKey === 'verticalMaxTop') {
            // Вертикальный: длина вдоль высоты, поперечник = clickboxCross
            frameWidth = clickboxCross + pad * 2;
            frameHeight = length + pad * 2;

            sliderCssWidth = length;
            sliderCssHeight = clickboxCross; // важно для Firefox, чтобы не обрезался большой thumb
        } else {
            // Горизонтальный
            frameWidth = length + pad * 2;
            frameHeight = clickboxCross + pad * 2;

            sliderCssWidth = length;
            sliderCssHeight = clickboxCross;
        }

        // Присваиваем размеры
        const totalWidth = frameWidth;
        const totalHeight = frameHeight;

        frame.style.width = Math.round(frameWidth - pad * 2) + 'px';
        frame.style.height = Math.round(frameHeight - pad * 2) + 'px';

        slider.style.width = Math.round(sliderCssWidth) + 'px';
        slider.style.height = Math.round(sliderCssHeight) + 'px';
        slider.style.transform = 'translate(-50%, -50%) ' + transformRotation;

        container.style.width = Math.round(totalWidth) + 'px';
        container.style.height = Math.round(totalHeight) + 'px';

        return { totalWidth, totalHeight };
    }

    function placeContainerAtViewportPositionClamped(x, y, width, height, viewportRect) {
        const minX = 0;
        const minY = 0;
        const maxX = viewportRect.vw - width;
        const maxY = viewportRect.vh - height;

        const clampedX = Math.max(minX, Math.min(x, maxX));
        const clampedY = Math.max(minY, Math.min(y, maxY));

        INTERNAL_STATE.containerElement.style.left = Math.round(clampedX) + 'px';
        INTERNAL_STATE.containerElement.style.top = Math.round(clampedY) + 'px';
    }

    // Значение -> Unity
    function handleSliderInputOrChange_PushToUnity() {
        if (!INTERNAL_STATE.sliderElement) return;
        const value = clamp01(parseFloat(INTERNAL_STATE.sliderElement.value));
        pushNormalizedValueToUnity(value);
        if (INTERNAL_STATE.pointerDragState.isPointerDownOnThumb) {
            INTERNAL_STATE.pointerDragState.hasAnyChangeWhilePointerDown = true;
        }
    }

    function setSliderValueAndPushToUnity(v) {
        createAndInitializeExternalSliderControlsIfNeeded();
        const clamped = clamp01(v);
        INTERNAL_STATE.sliderElement.value = String(clamped);
        pushNormalizedValueToUnity(clamped);
    }

    function pushNormalizedValueToUnity(val01) {
        const m = global.unityInstance && global.unityInstance.Module;
        if (m && typeof m.Slider_PushValue === 'function') {
            try { m.Slider_PushValue(val01); } catch (e) {}
        }
    }

    // Drag/Pointer + плавный возврат
    function attachPointerDragHandlersToSlider(slider) {
        // Pointer API без preventDefault / setPointerCapture — не ломаем нативный drag
        slider.addEventListener('pointerdown', onSliderPointerDown, { passive: true });
        slider.addEventListener('pointerup', onSliderPointerUp, { passive: true });
        slider.addEventListener('pointercancel', onSliderPointerCancel, { passive: true });

        // Fallback: mouse/touch (на случай отсутствия PointerEvents)
        if (!('onpointerdown' in window)) {
            slider.addEventListener('mousedown', onSliderMouseDown, { passive: true });
            window.addEventListener('mouseup', onSliderMouseUp, { passive: true });

            slider.addEventListener('touchstart', onSliderTouchStart, { passive: true });
            window.addEventListener('touchend', onSliderTouchEnd, { passive: true });
            window.addEventListener('touchcancel', onSliderTouchEnd, { passive: true });
        }
    }

    function onSliderPointerDown() {
        cancelReturnToMaxAnimationIfActive();
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = true;
        INTERNAL_STATE.pointerDragState.hasAnyChangeWhilePointerDown = false;
    }
    function onSliderPointerUp() {
        if (!INTERNAL_STATE.pointerDragState.isPointerDownOnThumb) return;
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = false;
        startSmoothReturnToMaxFromCurrentValue();
    }
    function onSliderPointerCancel() {
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = false;
        startSmoothReturnToMaxFromCurrentValue();
    }

    function onSliderMouseDown() {
        cancelReturnToMaxAnimationIfActive();
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = true;
        INTERNAL_STATE.pointerDragState.hasAnyChangeWhilePointerDown = false;
    }
    function onSliderMouseUp() {
        if (!INTERNAL_STATE.pointerDragState.isPointerDownOnThumb) return;
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = false;
        startSmoothReturnToMaxFromCurrentValue();
    }

    function onSliderTouchStart() {
        cancelReturnToMaxAnimationIfActive();
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = true;
        INTERNAL_STATE.pointerDragState.hasAnyChangeWhilePointerDown = false;
    }
    function onSliderTouchEnd() {
        if (!INTERNAL_STATE.pointerDragState.isPointerDownOnThumb) return;
        INTERNAL_STATE.pointerDragState.isPointerDownOnThumb = false;
        startSmoothReturnToMaxFromCurrentValue();
    }

    function startSmoothReturnToMaxFromCurrentValue() {
        const slider = INTERNAL_STATE.sliderElement;
        if (!slider) return;

        const current = clamp01(parseFloat(slider.value));
        if (current >= 1 - 1e-6) return;

        cancelReturnToMaxAnimationIfActive();

        INTERNAL_STATE.returnAnimationState.active = true;
        INTERNAL_STATE.returnAnimationState.startTime = performance.now();
        INTERNAL_STATE.returnAnimationState.startValue = current;

        const duration = Math.max(16, INTERNAL_STATE.config.returnToMaxDurationMs | 0);

        const step = () => {
            if (!INTERNAL_STATE.returnAnimationState.active) return;

            const now = performance.now();
            const t = Math.min(1, (now - INTERNAL_STATE.returnAnimationState.startTime) / duration);
            const eased = easeOutCubic(t);
            const v = clamp01(lerp(INTERNAL_STATE.returnAnimationState.startValue, 1, eased));

            // квантуем по step
            const q = Number(INTERNAL_STATE.sliderElement.step) || 0.001;
            const quantized = Math.min(1, Math.round(v / q) * q);

            INTERNAL_STATE.sliderElement.value = String(quantized);
            pushNormalizedValueToUnity(quantized);

            if (t < 1) {
                INTERNAL_STATE.returnAnimationState.rafId = requestAnimationFrame(step);
            } else {
                INTERNAL_STATE.returnAnimationState.active = false;
                INTERNAL_STATE.returnAnimationState.rafId = 0;
            }
        };

        INTERNAL_STATE.returnAnimationState.rafId = requestAnimationFrame(step);
    }

    function cancelReturnToMaxAnimationIfActive() {
        if (INTERNAL_STATE.returnAnimationState.active) {
            INTERNAL_STATE.returnAnimationState.active = false;
            if (INTERNAL_STATE.returnAnimationState.rafId) {
                cancelAnimationFrame(INTERNAL_STATE.returnAnimationState.rafId);
                INTERNAL_STATE.returnAnimationState.rafId = 0;
            }
        }
    }

    function easeOutCubic(t) {
        const u = 1 - t;
        return 1 - u * u * u;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    // Стили для скина (картинки бегунка/трека) через CSS-переменные
    function injectOneTimeCssForCustomSliderSkin() {
        if (document.getElementById('ext-slider-skin-style')) return;

        const style = document.createElement('style');
        style.id = 'ext-slider-skin-style';

        const css = `
#ext-controls #ext-slider {
  -webkit-tap-highlight-color: transparent;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  border: none;
  outline: none;
}

/* WEBKIT (Chrome, Safari, Edge Chromium) */
#ext-controls #ext-slider::-webkit-slider-runnable-track {
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  height: var(--slider-thickness, 8px);
  background-image: var(--track-image, none);
  background-color: transparent;
  background-repeat: var(--track-repeat, no-repeat);
  background-size: var(--track-bg-size, 100% 100%);
  background-position: center center;
  border: none;
  border-radius: var(--track-radius, calc(var(--slider-thickness, 8px)/2));
  cursor: pointer;
}
#ext-controls #ext-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-shadow: none !important;
  -webkit-box-shadow: none !important;
  width: var(--thumb-width, var(--slider-thickness, 8px));
  height: var(--thumb-height, var(--slider-thickness, 8px));
  background-image: var(--thumb-image, none);
  background-color: transparent !important;
  background-repeat: no-repeat;
  background-size: var(--thumb-bg-size, contain);
  background-position: center center;
  border: none;
  border-radius: var(--thumb-radius, 50%) !important;
  /* Центровка thumb по высоте трека */
  margin-top: calc((var(--slider-thickness, 8px) - var(--thumb-height, var(--slider-thickness, 8px))) / 2);
  cursor: grab;
}
#ext-controls #ext-slider:active::-webkit-slider-thumb {
  cursor: grabbing;
}

/* FIREFOX */
#ext-controls #ext-slider::-moz-range-track {
  height: var(--slider-thickness, 8px);
  background-image: var(--track-image, none);
  background-color: transparent;
  background-repeat: var(--track-repeat, no-repeat);
  background-size: var(--track-bg-size, 100% 100%);
  background-position: center center;
  border: none;
  border-radius: var(--track-radius, calc(var(--slider-thickness, 8px)/2));
  cursor: pointer;
}
#ext-controls #ext-slider::-moz-range-thumb {
  width: var(--thumb-width, var(--slider-thickness, 8px));
  height: var(--thumb-height, var(--slider-thickness, 8px));
  background-image: var(--thumb-image, none);
  background-color: transparent;
  background-repeat: no-repeat;
  background-size: var(--thumb-bg-size, contain);
  background-position: center center;
  border: none;
  border-radius: var(--thumb-radius, 50%);
  cursor: grab;
}
#ext-controls #ext-slider:active::-moz-range-thumb {
  cursor: grabbing;
}

/* Старый Edge/IE можно опустить, если не нужен */
`;

        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    // Проставляем CSS-переменные из конфигурации
    function applySkinFromConfigToElement(slider, cfg) {
        // Картинки
        const trackImage = cfg.sliderTrackImageUrl ? `url("${cfg.sliderTrackImageUrl}")` : 'none';
        const thumbImage = cfg.sliderThumbImageUrl ? `url("${cfg.sliderThumbImageUrl}")` : 'none';
        slider.style.setProperty('--track-image', trackImage);
        slider.style.setProperty('--thumb-image', thumbImage);

        // Размеры
        const thumbW = (cfg.thumbWidthPixels != null ? cfg.thumbWidthPixels : cfg.desiredSliderThicknessPixels) | 0;
        const thumbH = (cfg.thumbHeightPixels != null ? cfg.thumbHeightPixels : cfg.desiredSliderThicknessPixels) | 0;
        slider.style.setProperty('--thumb-width', Math.round(thumbW) + 'px');
        slider.style.setProperty('--thumb-height', Math.round(thumbH) + 'px');

        // Радиусы
        if (cfg.thumbBorderRadiusPixels != null)
            slider.style.setProperty('--thumb-radius', Math.round(cfg.thumbBorderRadiusPixels) + 'px');
        else
            slider.style.removeProperty('--thumb-radius');

        if (cfg.trackBorderRadiusPixels != null)
            slider.style.setProperty('--track-radius', Math.round(cfg.trackBorderRadiusPixels) + 'px');
        else
            slider.style.removeProperty('--track-radius');

        // Поведение background
        slider.style.setProperty('--track-bg-size', cfg.trackBackgroundSize || '100% 100%');
        slider.style.setProperty('--track-repeat', cfg.trackBackgroundRepeat || 'no-repeat');
        slider.style.setProperty('--thumb-bg-size', cfg.thumbBackgroundSize || 'contain');
    }

    // Helpers
    function clamp01(n) {
        n = Number(n);
        return n < 0 ? 0 : (n > 1 ? 1 : n);
    }

    function getUnityCanvasClientRect() {
        const id = INTERNAL_STATE.config.unityCanvasId || 'unity-canvas';
        const el = document.getElementById(id);
        if (!el) return null;
        return el.getBoundingClientRect();
    }

    function getCurrentVisualViewportRect() {
        const vv = global.visualViewport;
        const vw = vv ? vv.width : global.innerWidth;
        const vh = vv ? vv.height : global.innerHeight;
        return { vw, vh };
    }

    function attachRepositionEventHandlersOnce() {
        global.addEventListener('resize', handleWindowOrViewportResizeRepositionRequest, { passive: true });
        global.addEventListener('orientationchange', () => setTimeout(handleWindowOrViewportResizeRepositionRequest, 0), { passive: true });

        if (global.visualViewport) {
            global.visualViewport.addEventListener('resize', handleWindowOrViewportResizeRepositionRequest, { passive: true });
            global.visualViewport.addEventListener('scroll', handleWindowOrViewportResizeRepositionRequest, { passive: true });
        }
    }

    function tryAttachCanvasResizeObserver() {
        if (!('ResizeObserver' in global)) return;
        const canvasEl = document.getElementById(INTERNAL_STATE.config.unityCanvasId);
        if (!canvasEl) return;

        if (INTERNAL_STATE.resizeObserverForCanvas) {
            try { INTERNAL_STATE.resizeObserverForCanvas.disconnect(); } catch (e) {}
            INTERNAL_STATE.resizeObserverForCanvas = null;
        }

        INTERNAL_STATE.resizeObserverForCanvas = new ResizeObserver(() => {
            handleWindowOrViewportResizeRepositionRequest();
        });
        INTERNAL_STATE.resizeObserverForCanvas.observe(canvasEl);
    }

    function tryAttachContainerResizeObserver() {
        if (!('ResizeObserver' in global)) return;
        const container = INTERNAL_STATE.containerElement;
        if (!container) return;

        if (INTERNAL_STATE.resizeObserverForContainer) {
            try { INTERNAL_STATE.resizeObserverForContainer.disconnect(); } catch (e) {}
            INTERNAL_STATE.resizeObserverForContainer = null;
        }

        INTERNAL_STATE.resizeObserverForContainer = new ResizeObserver(() => {
            handleWindowOrViewportResizeRepositionRequest();
        });
        INTERNAL_STATE.resizeObserverForContainer.observe(container);
    }

    global.ExtSliderPositioner = ExtSliderPositioner;
})(window);
