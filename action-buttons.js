(function setupActionButtons(global) {
    const PLACEHOLDER_WAIT_MS = 100;
    const PLACEHOLDER_MAX_ATTEMPTS = 100;
    const MIN_POSITION_INDEX = 0;
    const MAX_POSITION_INDEX = 3;

    const ICONS = {
        UnionJack: {
            normalIcon: 'TemplateData/union-jack.png',
            hoverIcon: 'TemplateData/union-jack-hover.png',
            blockedIcon: 'TemplateData/union-jack-blocked.png',
            idleIcon: 'TemplateData/union-jack-idle.gif',
            widthPercent: 100,
            heightPercent: 100
        },
        CheckMark: {
            normalIcon: 'TemplateData/check-mark.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 100,
            heightPercent: 100
        },
        Update: {
            normalIcon: 'TemplateData/update-icon.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 75,
            heightPercent: 75
        },
        Exit: {
            normalIcon: 'TemplateData/exit-icon.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 80,
            heightPercent: 80
        },
        Stop: {
            normalIcon: 'TemplateData/stop-icon.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 100,
            heightPercent: 100
        },
        Skip: {
            normalIcon: 'TemplateData/skip-icon.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 100,
            heightPercent: 100
        },
        FontSizeDecrease: {
            normalIcon: 'TemplateData/font-size-decrease.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 50,
            heightPercent: 50
        },
        FontSizeIncrease: {
            normalIcon: 'TemplateData/font-size-increase.png',
            hoverIcon: '',
            blockedIcon: '',
            idleIcon: '',
            widthPercent: 50,
            heightPercent: 50
        }
    };

    let placeholderWaitTimer = 0;
    let placeholderWaitAttempts = 0;

    const buttonsByPosition = new Map();
    const buttonsByIconKey = new Map();
    const checkedIconUrls = new Map();

    function isValidPositionIndex(positionIndex) {
        return Number.isInteger(positionIndex) &&
            positionIndex >= MIN_POSITION_INDEX &&
            positionIndex <= MAX_POSITION_INDEX;
    }

    function getPlaceholderManager() {
        return global.extraButtonPlaceholders || null;
    }

    function getPlaceholder(index) {
        const manager = getPlaceholderManager();
        if (!manager || typeof manager.getPlaceholder !== 'function') {
            return null;
        }

        return manager.getPlaceholder(index) || null;
    }

    function clearPlaceholderWaitTimer() {
        if (placeholderWaitTimer) {
            clearTimeout(placeholderWaitTimer);
            placeholderWaitTimer = 0;
        }
    }

    function schedulePlaceholderRetry(action) {
        if (placeholderWaitTimer) {
            return;
        }

        if (placeholderWaitAttempts >= PLACEHOLDER_MAX_ATTEMPTS) {
            console.error('[ActionButtons] placeholder wait limit reached');
            return;
        }

        placeholderWaitAttempts++;
        placeholderWaitTimer = global.setTimeout(function () {
            placeholderWaitTimer = 0;
            action();
        }, PLACEHOLDER_WAIT_MS);
    }

    function validateIconUrl(iconKey, stateName, iconUrl) {
        if (!iconUrl) {
            return;
        }

        if (checkedIconUrls.has(iconUrl)) {
            return;
        }

        checkedIconUrls.set(iconUrl, 'pending');

        const image = new Image();
        image.onload = function () {
            checkedIconUrls.set(iconUrl, 'ok');
        };
        image.onerror = function () {
            checkedIconUrls.set(iconUrl, 'error');
            console.error(`[ActionButtons] failed to load ${stateName} icon for key "${iconKey}" by path "${iconUrl}"`);
        };
        image.src = iconUrl;
    }

    function validateIconConfig(iconKey, config) {
        validateIconUrl(iconKey, 'normalIcon', config.normalIcon);
        validateIconUrl(iconKey, 'hoverIcon', config.hoverIcon);
        validateIconUrl(iconKey, 'blockedIcon', config.blockedIcon);
        validateIconUrl(iconKey, 'idleIcon', config.idleIcon);
    }

    function getIconConfig(iconKey) {
        const config = ICONS[iconKey];
        if (!config) {
            console.error('[ActionButtons] unknown iconKey:', iconKey);
            return null;
        }

        const normalizedConfig = {
            normalIcon: config.normalIcon || '',
            hoverIcon: config.hoverIcon || '',
            blockedIcon: config.blockedIcon || '',
            idleIcon: config.idleIcon || '',
            widthPercent: typeof config.widthPercent === 'number' ? config.widthPercent : 100,
            heightPercent: typeof config.heightPercent === 'number' ? config.heightPercent : 100
        };

        validateIconConfig(iconKey, normalizedConfig);
        return normalizedConfig;
    }

    function isIconUrlUsable(iconUrl) {
        if (!iconUrl) {
            return false;
        }

        const state = checkedIconUrls.get(iconUrl);
        return state !== 'error';
    }

    function resolveDisplayIcon(config, preferredIconUrl) {
        if (preferredIconUrl && isIconUrlUsable(preferredIconUrl)) {
            return preferredIconUrl;
        }

        if (config.normalIcon && isIconUrlUsable(config.normalIcon)) {
            return config.normalIcon;
        }

        return config.normalIcon || preferredIconUrl || '';
    }

    function applyBackgroundImage(button, iconUrl) {
        if (iconUrl) {
            button.style.backgroundImage = `url("${iconUrl}")`;
        } else {
            button.style.backgroundImage = 'none';
        }
    }

    function applyResolvedBackgroundImage(button, config, preferredIconUrl) {
        applyBackgroundImage(button, resolveDisplayIcon(config, preferredIconUrl));
    }

    function applyBaseButtonStyle(button, config) {
        button.style.width = `${config.widthPercent}%`;
        button.style.height = `${config.heightPercent}%`;
        button.style.minWidth = '0';
        button.style.minHeight = '0';
        button.style.padding = '0';
        button.style.margin = '0';
        button.style.border = 'none';
        button.style.borderRadius = '0';
        button.style.backgroundColor = 'transparent';
        button.style.backgroundRepeat = 'no-repeat';
        button.style.backgroundPosition = 'center';
        button.style.backgroundSize = '100% 100%';
        button.style.color = 'transparent';
        button.style.fontSize = '0';
        button.style.touchAction = 'manipulation';
        button.style.webkitTapHighlightColor = 'transparent';
        button.style.boxShadow = 'none';
        button.style.outline = 'none';
        button.style.display = 'none';
        button.style.pointerEvents = 'auto';

        applyResolvedBackgroundImage(button, config, config.normalIcon);
    }

    function applyFallbackBlockedVisualState(button) {
        button.style.opacity = button.disabled ? '0.45' : '1';
        button.style.cursor = button.disabled ? 'default' : 'pointer';
        button.style.filter = button.disabled ? 'grayscale(1)' : 'none';
    }

    function updateVisualState(entry) {
        const button = entry.button;
        const config = entry.config;

        button.disabled = !!entry.isBlocked;
        button.style.display = entry.isVisible ? 'block' : 'none';

        if (entry.isBlocked) {
            if (isIconUrlUsable(config.blockedIcon)) {
                applyResolvedBackgroundImage(button, config, config.blockedIcon);
                button.style.opacity = '1';
                button.style.cursor = 'default';
                button.style.filter = 'none';
            } else {
                applyResolvedBackgroundImage(button, config, config.normalIcon);
                applyFallbackBlockedVisualState(button);
            }

            return;
        }
    
        if (entry.isIdle && isIconUrlUsable(config.idleIcon)) {
            applyResolvedBackgroundImage(button, config, config.idleIcon);
        } else {
            applyResolvedBackgroundImage(button, config, config.normalIcon);
        }

        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        button.style.filter = 'none';
    }

    function mountButton(entry) {
        const placeholder = getPlaceholder(entry.positionIndex);
        if (!placeholder) {
            schedulePlaceholderRetry(function () {
                mountButton(entry);
            });
            return false;
        }

        clearPlaceholderWaitTimer();

        if (entry.button.parentElement !== placeholder) {
            placeholder.appendChild(entry.button);
        }

        return true;
    }

    function createButtonElement(positionIndex, iconKey, callback, config) {
        const button = document.createElement('button');
        button.id = `action-button-${positionIndex}-${iconKey}`;
        button.type = 'button';
        button.setAttribute('aria-label', iconKey);
        button.title = iconKey;

        applyBaseButtonStyle(button, config);

        const entry = {
            positionIndex: positionIndex,
            iconKey: iconKey,
            button: button,
            callback: typeof callback === 'function' ? callback : function () {},
            config: config,
            isVisible: false,
            isBlocked: false,
            isIdle: false
        };

        button.addEventListener('click', function () {
            if (entry.isBlocked) {
                return;
            }

            entry.callback();
        });

        button.addEventListener('mouseenter', function () {
            if (!entry.isVisible || entry.isBlocked) {
                return;
            }

            if (isIconUrlUsable(entry.config.hoverIcon)) {
                applyResolvedBackgroundImage(button, entry.config, entry.config.hoverIcon);
            } else {
                updateVisualState(entry);
            }
        });

        button.addEventListener('mouseleave', function () {
            if (!entry.isVisible) {
                return;
            }
            
            updateVisualState(entry);
        });

        return entry;
    }

    function resolveEntry(value) {
        if (typeof value === 'number') {
            return buttonsByPosition.get(value) || null;
        }

        if (typeof value === 'string') {
            return buttonsByIconKey.get(value) || null;
        }

        return null;
    }

    function ensureEntry(value, methodName) {
        const entry = resolveEntry(value);
        if (!entry) {
            console.error(`[ActionButtons] ${methodName} failed: button is not initialized for`, value);
            return null;
        }

        return entry;
    }

    function init(positionIndex, iconKey, callback) {
        if (!isValidPositionIndex(positionIndex)) {
            console.error('[ActionButtons] init failed: invalid positionIndex =', positionIndex);
            return;
        }

        if (typeof iconKey !== 'string' || iconKey.length === 0) {
            console.error('[ActionButtons] init failed: iconKey is empty');
            return;
        }

        const config = getIconConfig(iconKey);
        if (!config) {
            return;
        }

        const existingByIconKey = buttonsByIconKey.get(iconKey);
        if (existingByIconKey && existingByIconKey.positionIndex !== positionIndex) {
            console.error(
                `[ActionButtons] init cancelled: iconKey "${iconKey}" is already used by position ${existingByIconKey.positionIndex}, requested position ${positionIndex}`
            );
            return;
        }

        const existingByPosition = buttonsByPosition.get(positionIndex);
        if (existingByPosition) {
            const previousIconKey = existingByPosition.iconKey;

            if (previousIconKey !== iconKey) {
                console.error(
                    `[ActionButtons] position ${positionIndex} was occupied by key "${previousIconKey}", now it will be reused as "${iconKey}"`
                );
                buttonsByIconKey.delete(previousIconKey);
            }

            existingByPosition.iconKey = iconKey;
            existingByPosition.callback = typeof callback === 'function' ? callback : function () {};
            existingByPosition.config = config;
            existingByPosition.isVisible = false;
            existingByPosition.isBlocked = false;
            existingByPosition.isIdle = false;

            existingByPosition.button.id = `action-button-${positionIndex}-${iconKey}`;
            existingByPosition.button.setAttribute('aria-label', iconKey);
            existingByPosition.button.title = iconKey;

            applyBaseButtonStyle(existingByPosition.button, existingByPosition.config);
            buttonsByIconKey.set(iconKey, existingByPosition);
            mountButton(existingByPosition);
            updateVisualState(existingByPosition);
            return;
        }

        const entry = createButtonElement(positionIndex, iconKey, callback, config);

        buttonsByPosition.set(positionIndex, entry);
        buttonsByIconKey.set(iconKey, entry);

        mountButton(entry);
        updateVisualState(entry);
    }

    function show(value) {
        const entry = ensureEntry(value, 'show');
        if (!entry) return;

        entry.isIdle = false;
        entry.isVisible = true;
        updateVisualState(entry);
    }

    function hide(value) {
        const entry = ensureEntry(value, 'hide');
        if (!entry) return;

        entry.isIdle = false;
        entry.isVisible = false;
        updateVisualState(entry);
    }

    function idle(value) {
        const entry = ensureEntry(value, 'idle');
        if (!entry) return;

        entry.isIdle = true;
        updateVisualState(entry);
    }

    function block(value) {
        const entry = ensureEntry(value, 'block');
        if (!entry) return;

        entry.isIdle = false;
        entry.isBlocked = true;
        updateVisualState(entry);
    }

    function unblock(value) {
        const entry = ensureEntry(value, 'unblock');
        if (!entry) return;

        entry.isIdle = false;
        entry.isBlocked = false;
        updateVisualState(entry);
    }

    global.ActionButtonsService = {
        init: init,
        show: show,
        hide: hide,
        idle: idle,
        block: block,
        unblock: unblock,
        icons: ICONS
    };
})(window);
