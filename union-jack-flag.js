(function () {
    const BUTTON_ID = 'union-jack-button';
    const PLACEHOLDER_INDEX = 0;
    const PLACEHOLDER_WAIT_MS = 100;
    const PLACEHOLDER_MAX_ATTEMPTS = 100;
    const ICON_URL = 'TemplateData/union-jack.png';

    let initialized = false;
    let placeholderWaitTimer = 0;
    let placeholderWaitAttempts = 0;
    let unionJackCallback = function () {};

    console.log('[UnionJackFlag.js] script loaded');

    function styleButton(button) {
        button.style.width = '100%';
        button.style.height = '100%';
        button.style.minWidth = '0';
        button.style.minHeight = '0';
        button.style.padding = '0';
        button.style.margin = '0';
        button.style.border = 'none';
        button.style.borderRadius = '0';
        button.style.backgroundColor = 'transparent';
        button.style.backgroundImage = `url("${ICON_URL}")`;
        button.style.backgroundRepeat = 'no-repeat';
        button.style.backgroundPosition = 'center';
        button.style.backgroundSize = '100% 100%';
        button.style.color = 'transparent';
        button.style.fontSize = '0';
        button.style.cursor = 'pointer';
        button.style.touchAction = 'manipulation';
        button.style.webkitTapHighlightColor = 'transparent';
        button.style.boxShadow = 'none';
        button.style.outline = 'none';
        button.style.display = 'block';
    }

    function updateButtonVisualState(button) {
        button.style.opacity = button.disabled ? '0.45' : '1';
        button.style.cursor = button.disabled ? 'default' : 'pointer';
    }

    function getPlaceholderManager() {
        const manager = window.extraButtonPlaceholders;
        console.log('[UnionJackFlag.js] getPlaceholderManager: exists =', !!manager);
        return manager || null;
    }

    function getPlaceholder(index) {
        const manager = getPlaceholderManager();
        if (!manager || typeof manager.getPlaceholder !== 'function') {
            console.warn('[UnionJackFlag.js] getPlaceholder: manager not ready for index =', index);
            return null;
        }

        const placeholder = manager.getPlaceholder(index);
        console.log('[UnionJackFlag.js] getPlaceholder:', index, '=>', !!placeholder);
        return placeholder || null;
    }

    function clearPlaceholderWaitTimer() {
        if (placeholderWaitTimer) {
            clearTimeout(placeholderWaitTimer);
            placeholderWaitTimer = 0;
        }
    }

    function schedulePlaceholderRetry(reason) {
        if (initialized) {
            console.log('[UnionJackFlag.js] schedulePlaceholderRetry skipped: already initialized');
            return;
        }

        if (placeholderWaitTimer) {
            console.log('[UnionJackFlag.js] schedulePlaceholderRetry skipped: timer already scheduled, reason =', reason);
            return;
        }

        if (placeholderWaitAttempts >= PLACEHOLDER_MAX_ATTEMPTS) {
            console.error('[UnionJackFlag.js] placeholders wait limit reached, last reason =', reason);
            return;
        }

        placeholderWaitAttempts++;
        console.warn('[UnionJackFlag.js] placeholder not ready, retry scheduled. attempt =', placeholderWaitAttempts, 'reason =', reason);

        placeholderWaitTimer = window.setTimeout(function () {
            placeholderWaitTimer = 0;
            ensureDom();
        }, PLACEHOLDER_WAIT_MS);
    }

    function ensureButton() {
        let button = document.getElementById(BUTTON_ID);
        if (!button) {
            console.log('[UnionJackFlag.js] creating button');
            button = document.createElement('button');
            button.id = BUTTON_ID;
            button.type = 'button';
            button.textContent = 'Union Jack';
            button.setAttribute('aria-label', 'Union Jack');
            button.title = 'Union Jack';
        } else {
            console.log('[UnionJackFlag.js] reusing existing button');
        }

        styleButton(button);
        updateButtonVisualState(button);

        return button;
    }

    function mountButtonToPlaceholder(button, placeholder) {
        if (!button) {
            console.warn('[UnionJackFlag.js] mountButtonToPlaceholder skipped: button missing');
            return false;
        }

        if (!placeholder) {
            console.warn('[UnionJackFlag.js] mountButtonToPlaceholder skipped: placeholder missing');
            return false;
        }

        if (button.parentElement !== placeholder) {
            console.log('[UnionJackFlag.js] mounting button to placeholder index =', placeholder.dataset.index);
            placeholder.appendChild(button);
        } else {
            console.log('[UnionJackFlag.js] button already mounted');
        }

        return true;
    }

    function ensureDom() {
        console.log('[UnionJackFlag.js] ensureDom called, initialized =', initialized);

        if (initialized) return;

        const placeholder = getPlaceholder(PLACEHOLDER_INDEX);
        if (!placeholder) {
            console.warn('[UnionJackFlag.js] ensureDom: placeholder is not ready yet');
            schedulePlaceholderRetry('placeholder is not ready');
            return;
        }

        clearPlaceholderWaitTimer();

        const button = ensureButton();

        if (!mountButtonToPlaceholder(button, placeholder)) {
            schedulePlaceholderRetry('failed to mount button');
            return;
        }

        button.addEventListener('click', function () {
            console.log('[UnionJackFlag.js] click');
            console.log('[UnionJackFlag.js] button.disabled =', button.disabled);
            console.log('[UnionJackFlag.js] typeof unionJackCallback =', typeof unionJackCallback);

            if (button.disabled) return;

            console.log('[UnionJackFlag.js] invoking callback');
            unionJackCallback();
        });

        initialized = true;
        console.log('[UnionJackFlag.js] DOM initialized');
    }

    window.UnionJackFlag_SetCallback = function (callback) {
        console.log('[UnionJackFlag.js] UnionJackFlag_SetCallback called, typeof =', typeof callback);
        unionJackCallback = typeof callback === 'function' ? callback : function () {};
    };

    window.UnionJackFlag_Init = function () {
        console.log('[UnionJackFlag.js] Init called');
        ensureDom();
        window.UnionJackFlag_Hide();
    };

    window.UnionJackFlag_Show = function () {
        console.log('[UnionJackFlag.js] Show called');
        ensureDom();

        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.style.display = 'block';
            console.log('[UnionJackFlag.js] button shown');
        } else {
            console.warn('[UnionJackFlag.js] Show: button not found');
        }
    };

    window.UnionJackFlag_Hide = function () {
        console.log('[UnionJackFlag.js] Hide called');
        ensureDom();

        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.style.display = 'none';
            console.log('[UnionJackFlag.js] button hidden');
        } else {
            console.warn('[UnionJackFlag.js] Hide: button not found');
        }
    };

    window.UnionJackFlag_SetInteractable = function (interactable) {
        console.log('[UnionJackFlag.js] SetInteractable called:', interactable);
        ensureDom();

        const button = document.getElementById(BUTTON_ID);
        if (!button) {
            console.warn('[UnionJackFlag.js] SetInteractable: button not found');
            return;
        }

        button.disabled = !interactable;
        updateButtonVisualState(button);

        console.log('[UnionJackFlag.js] button.disabled =', button.disabled);
    };

    window.UnionJackFlag_InvokeFromUnity = function () {
        console.log('[UnionJackFlag.js] InvokeFromUnity called');
        if (typeof unionJackCallback === 'function') {
            unionJackCallback();
        }
    };
})();
