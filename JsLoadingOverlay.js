(function () {
    /**
     * ========================================================================
     * BritlinesLoadingOverlay
     * ========================================================================
     * Этот модуль управляет стартовым экраном WebGL до первого кадра Unity.
     *
     * Основные задачи:
     * 1. Показать аккуратный центральный блок загрузки.
     * 2. Плавно обновлять проценты, не доверяя напрямую Unity progress.
     * 3. Различать сценарии загрузки:
     *    - cold   : тяжёлые файлы реально скачиваются из сети;
     *    - warm   : тяжёлые файлы уже в кэше браузера;
     *    - updated: смешанный сценарий, например часть кэша устарела и
     *               была ревалидирована / перекачана.
     * 4. Не показывать 100% до тех пор, пока Unity не сообщит о первом кадре.
     * 5. После firstFrame() плавно скрыть экран и фон.
     *
     * Почему здесь своя логика процентов:
     * Unity WebGL progress часто даёт неудобный UX:
     * - может долго висеть на 90%;
     * - может мгновенно прыгать с низких значений почти к 100%;
     * - на кэшированных ресурсах реальный progress выглядит особенно грубо.
     *
     * Поэтому здесь используется "витринный" прогресс:
     * - он уважает реальные сигналы Unity;
     * - но отображается более плавно и ступенчато;
     * - обязательно проходит через десятки процентов;
     * - в хвосте медленно доползает до 99%, если идёт долгая внутренняя операция.
     */

    /**
     * Контентные настройки загрузчика.
     * Всё визуальное — в CSS.
     * В JS оставляем только тексты и идентификаторы DOM-узлов.
     */
    const DEFAULT_OPTIONS = {
        title: 'Britlines.app',
        subtitle: 'British English Line by Line',
        loadingScreenId: 'unity-custom-loading-screen',
        backgroundId: 'background'
    };

    const SCALE_CONFIG = {
        baseLayoutWidth: 680,
        baseReferenceSide: 1080,
        horizontalPaddingPx: 48
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function moveTowards(current, target, maxDelta) {
        if (current < target) return Math.min(current + maxDelta, target);
        if (current > target) return Math.max(current - maxDelta, target);
        return current;
    }

    function safeNow() {
        return (window.performance && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
    }

    /**
     * Для каждого интересующего ресурса храним короткую телеметрию.
     * Нас интересуют прежде всего .wasm и .data, потому что именно они
     * чаще всего определяют характер старта.
     */
    function createResourceWatch(pattern) {
        return {
            pattern: pattern,
            seen: false,
            transferSize: null,
            encodedBodySize: null,
            decodedBodySize: null,
            duration: null,
            responseEnd: null,
            delivery: "unknown"
        };
    }

    const overlay = {
        root: null,
        loadingScreen: null,
        background: null,
        panel: null,
        titleEl: null,
        subtitleEl: null,
        percentEl: null,
        leftDotsHost: null,
        rightDotsHost: null,
        leftDots: [],
        rightDots: [],
        rafId: 0,
        startedAt: 0,
        lastTs: 0,

        /**
         * displayedPercent — то, что реально видит пользователь.
         * targetPercent    — куда UI должен стремиться в ближайший момент.
         * unityProgress    — то, что приходит из createUnityInstance(progress).
         */
        displayedPercent: 0,
        targetPercent: 0,
        unityProgress: 0,

        /**
         * unityReady — createUnityInstance завершился, instance создан.
         * firstFrameReceived — Unity уже прислала сигнал первого кадра.
         */
        unityReady: false,
        firstFrameReceived: false,
        fadeStarted: false,
        hidden: false,

        /**
         * Логика шагов по 10%.
         * Мы специально задерживаемся на десятках очень коротко,
         * чтобы прогресс не перепрыгивал 0 -> 90 мгновенно.
         */
        progressStepHoldUntil: 0,
        currentStepPercent: 0,

        resourceObserver: null,
        resourceWatches: {
            wasm: createResourceWatch(/\/Build\/.*\.wasm(?:\?|$)/i),
            data: createResourceWatch(/\/Build\/.*\.data(?:\?|$)/i),
            framework: createResourceWatch(/\/Build\/.*\.framework\.js(?:\?|$)/i),
            loader: createResourceWatch(/\/Build\/.*\.loader\.js(?:\?|$)/i)
        },

        /**
         * loadProfile:
         * - cold   => сеть реально качает wasm/data
         * - warm   => wasm/data пришли из кэша
         * - updated=> смешанная ситуация
         * - unknown=> данных пока мало
         */
        loadProfile: "unknown",
        options: Object.assign({}, DEFAULT_OPTIONS),

        start: function () {
            this.options = Object.assign({}, DEFAULT_OPTIONS);

            this.root = document.getElementById('britlines-loading-overlay');
            this.loadingScreen = document.getElementById(this.options.loadingScreenId);
            this.background = document.getElementById(this.options.backgroundId);

            this.panel = this.root ? this.root.querySelector('.britlines-loading-panel') : null;
            this.titleEl = document.getElementById('britlines-loading-title');
            this.subtitleEl = document.getElementById('britlines-loading-subtitle');
            this.percentEl = document.getElementById('britlines-progress-percent');
            this.leftDotsHost = this.root ? this.root.querySelector('.britlines-dots-left') : null;
            this.rightDotsHost = this.root ? this.root.querySelector('.britlines-dots-right') : null;

            if (!this.root || !this.loadingScreen || !this.background || !this.panel ||
                !this.titleEl || !this.subtitleEl || !this.percentEl || !this.leftDotsHost || !this.rightDotsHost) {
                console.warn('BritlinesLoadingOverlay: required DOM nodes not found.');
                return;
            }

            this.resetState();
            this.applyContentSettings();
            this.buildDotsImmediately();
            this.installScaleHandlers();
            this.updateRootScale();
            this.installResourceObserver();
            this.detectExistingResourceEntries();

            this.loadingScreen.style.display = 'block';
            this.loadingScreen.classList.remove('britlines-loading-hidden');
            this.loadingScreen.classList.remove('britlines-loading-fadeout');
            this.root.classList.remove('britlines-loading-overlay-ready');

            this.background.style.display = 'block';
            this.background.classList.remove('britlines-background-hidden');
            this.background.classList.remove('britlines-background-fadeout');

            this.renderPercent(0);
            this.renderDots(0);

            /**
             * Форсируем layout до показа ready-state.
             * Это помогает убрать микро-сдвиг текста на первом кадре.
             */
            this.root.getBoundingClientRect();
            this.root.classList.add('britlines-loading-overlay-ready');

            this.startedAt = safeNow();
            this.lastTs = this.startedAt;
            this.progressStepHoldUntil = this.startedAt;
            this.kick();
        },

        resetState: function () {
            this.leftDots = [];
            this.rightDots = [];
            this.displayedPercent = 0;
            this.targetPercent = 0;
            this.currentStepPercent = 0;
            this.unityProgress = 0;
            this.unityReady = false;
            this.firstFrameReceived = false;
            this.fadeStarted = false;
            this.hidden = false;
            this.loadProfile = "unknown";

            this.resourceWatches = {
                wasm: createResourceWatch(/\/Build\/.*\.wasm(?:\?|$)/i),
                data: createResourceWatch(/\/Build\/.*\.data(?:\?|$)/i),
                framework: createResourceWatch(/\/Build\/.*\.framework\.js(?:\?|$)/i),
                loader: createResourceWatch(/\/Build\/.*\.loader\.js(?:\?|$)/i)
            };

            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = 0;
            }

            if (this.resourceObserver) {
                try {
                    this.resourceObserver.disconnect();
                } catch (e) {
                    console.warn('BritlinesLoadingOverlay: failed to disconnect previous observer.', e);
                }
                this.resourceObserver = null;
            }

            this.removeScaleHandlers();
        },

        /**
         * JS отвечает только за тексты.
         * Типографика, шрифты, размеры и прочий визуал живут в CSS.
         */
        applyContentSettings: function () {
            this.titleEl.textContent = this.options.title || '';
            this.subtitleEl.textContent = this.options.subtitle || '';
        },

        installScaleHandlers: function () {
            if (this._boundUpdateRootScale) return;

            this._boundUpdateRootScale = this.updateRootScale.bind(this);
            window.addEventListener('resize', this._boundUpdateRootScale, { passive: true });
            window.addEventListener('orientationchange', this._boundUpdateRootScale, { passive: true });

            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', this._boundUpdateRootScale, { passive: true });
            }
        },

        removeScaleHandlers: function () {
            if (!this._boundUpdateRootScale) return;

            window.removeEventListener('resize', this._boundUpdateRootScale);
            window.removeEventListener('orientationchange', this._boundUpdateRootScale);

            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', this._boundUpdateRootScale);
            }

            this._boundUpdateRootScale = null;
        },

        updateRootScale: function () {
            if (!this.root) return;

            const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
            const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const minViewportSide = Math.min(viewportWidth, viewportHeight);

            const availableWidth = Math.max(0, viewportWidth - SCALE_CONFIG.horizontalPaddingPx);
            const widthScale = availableWidth / SCALE_CONFIG.baseLayoutWidth;
            const orientationStableScale = minViewportSide / SCALE_CONFIG.baseReferenceSide;

            const scale = clamp(
                Math.min(1, widthScale, orientationStableScale),
                0.35,
                1
            );

            this.root.style.setProperty('--britlines-root-scale', String(scale));
        },

        /**
         * Создаём точки сразу, чтобы не было отдельного кадра,
         * на котором сначала виден текст, а потом внезапно появляются точки.
         */
        buildDotsImmediately: function () {
            this.leftDotsHost.innerHTML = '';
            this.rightDotsHost.innerHTML = '';

            for (let i = 0; i < 10; i++) {
                const leftDot = document.createElement('span');
                leftDot.className = 'britlines-dot';
                this.leftDotsHost.appendChild(leftDot);
                this.leftDots.push(leftDot);
            }

            for (let i = 0; i < 10; i++) {
                const rightDot = document.createElement('span');
                rightDot.className = 'britlines-dot';
                this.rightDotsHost.appendChild(rightDot);
                this.rightDots.push(rightDot);
            }
        },

        /**
         * PerformanceObserver позволяет поймать ресурсы даже если они уже
         * начали грузиться очень рано.
         */
        installResourceObserver: function () {
            if (typeof PerformanceObserver !== 'function') {
                this.evaluateLoadProfile();
                return;
            }

            try {
                this.resourceObserver = new PerformanceObserver((list) => {
                    const entries = list.getEntries();
                    for (let i = 0; i < entries.length; i++) {
                        this.consumeResourceEntry(entries[i]);
                    }
                    this.evaluateLoadProfile();
                });

                this.resourceObserver.observe({ type: 'resource', buffered: true });
            } catch (e) {
                console.warn('BritlinesLoadingOverlay: PerformanceObserver unavailable.', e);
            }
        },

        detectExistingResourceEntries: function () {
            if (!window.performance || typeof performance.getEntriesByType !== 'function') {
                this.evaluateLoadProfile();
                return;
            }

            const entries = performance.getEntriesByType('resource');
            for (let i = 0; i < entries.length; i++) {
                this.consumeResourceEntry(entries[i]);
            }

            this.evaluateLoadProfile();
        },

        /**
         * Здесь пытаемся понять, был ли ресурс реально скачан,
         * либо пришёл из browser cache.
         *
         * Частая эвристика:
         * - transferSize > 0  => сеть
         * - transferSize == 0 и body size есть => кэш
         */
        consumeResourceEntry: function (entry) {
            if (!entry || !entry.name) return;

            const watches = this.resourceWatches;
            const keys = Object.keys(watches);

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const watch = watches[key];

                if (!watch.pattern.test(entry.name)) continue;

                watch.seen = true;
                watch.transferSize = typeof entry.transferSize === 'number' ? entry.transferSize : null;
                watch.encodedBodySize = typeof entry.encodedBodySize === 'number' ? entry.encodedBodySize : null;
                watch.decodedBodySize = typeof entry.decodedBodySize === 'number' ? entry.decodedBodySize : null;
                watch.duration = typeof entry.duration === 'number' ? entry.duration : null;
                watch.responseEnd = typeof entry.responseEnd === 'number' ? entry.responseEnd : null;

                if (watch.transferSize === 0 && (watch.encodedBodySize || watch.decodedBodySize)) {
                    watch.delivery = 'cache';
                } else if (watch.transferSize > 0) {
                    watch.delivery = 'network';
                } else {
                    watch.delivery = 'unknown';
                }
            }
        },

        /**
         * Определяем профиль загрузки.
         *
         * cold:
         *   wasm и data пришли по сети
         * warm:
         *   wasm и data уже были в кеше
         * updated:
         *   один из файлов из кеша, другой из сети, либо ситуация смешанная
         */
        evaluateLoadProfile: function () {
            const wasm = this.resourceWatches.wasm;
            const data = this.resourceWatches.data;

            const networkCount = [wasm, data].filter(w => w.seen && w.delivery === 'network').length;
            const cacheCount = [wasm, data].filter(w => w.seen && w.delivery === 'cache').length;

            if (networkCount >= 2) {
                this.loadProfile = 'cold';
                return;
            }

            if (cacheCount >= 2) {
                this.loadProfile = 'warm';
                return;
            }

            if ((networkCount >= 1 && cacheCount >= 1) || (wasm.seen || data.seen)) {
                this.loadProfile = 'updated';
                return;
            }

            this.loadProfile = 'unknown';
        },

        setUnityProgress: function (progress) {
            if (typeof progress !== 'number' || !isFinite(progress)) return;
            this.unityProgress = clamp(progress, 0, 1);
        },

        markUnityReady: function () {
            this.unityReady = true;
        },

        notifyFirstFrame: function () {
            this.firstFrameReceived = true;
            this.targetPercent = 100;
        },

        kick: function () {
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = requestAnimationFrame(this.tick.bind(this));
        },

        tick: function (ts) {
            const now = ts || safeNow();
            const dt = Math.max(0.001, (now - this.lastTs) / 1000);
            const elapsed = Math.max(0, (now - this.startedAt) / 1000);
            this.lastTs = now;

            this.targetPercent = this.computeTargetPercent(elapsed);
            this.advanceDisplayedPercent(now, dt, elapsed);

            this.renderPercent(this.displayedPercent);
            this.renderDots(this.displayedPercent);

            if (this.firstFrameReceived && this.displayedPercent >= 100 && !this.fadeStarted) {
                this.beginFadeOut();
            }

            if (!this.hidden) {
                this.rafId = requestAnimationFrame(this.tick.bind(this));
            }
        },

        /**
         * Формируем целевой процент.
         *
         * Идея:
         * - реальный unityProgress учитывается, но не напрямую;
         * - warm load идёт бодрее;
         * - cold load идёт спокойнее;
         * - до first frame потолок = 99%.
         */
        computeTargetPercent: function (elapsed) {
            const realPercent = Math.round(this.unityProgress * 100);
            const profile = this.loadProfile;

            let floorPercent = 0;
            if (profile === 'warm') {
                floorPercent = Math.min(20, Math.floor(elapsed / 0.18) * 2);
            } else if (profile === 'updated') {
                floorPercent = Math.min(14, Math.floor(elapsed / 0.22) * 2);
            } else {
                floorPercent = Math.min(10, Math.floor(elapsed / 0.28) * 2);
            }

            let mappedReal;
            if (realPercent <= 90) {
                mappedReal = floorPercent + (realPercent / 90) * 85;
            } else {
                mappedReal = 85 + ((realPercent - 90) / 10) * 14;
            }

            let target = Math.max(floorPercent, mappedReal);

            if (realPercent >= 90) {
                const tailStart = profile === 'warm' ? 92 : 90;
                const creepRate = profile === 'warm' ? 1.6 : (profile === 'updated' ? 1.2 : 0.8);
                const creep = Math.floor(Math.max(0, elapsed - 1.5) * creepRate);
                target = Math.max(target, Math.min(99, tailStart + creep));
            }

            if (this.unityReady) {
                const readyElapsed = Math.max(0, elapsed - 0.8);
                const readyBase = profile === 'warm' ? 96 : 95;
                target = Math.max(target, Math.min(99, readyBase + Math.floor(readyElapsed * 1.2)));
            }

            if (this.firstFrameReceived) {
                target = 100;
            } else {
                target = Math.min(target, 99);
            }

            return clamp(Math.round(target), 0, 100);
        },

        /**
         * Двигаем UI к targetPercent.
         *
         * Поведение:
         * - если впереди следующий десяток, сначала добегаем до него;
         * - коротко держим этот десяток;
         * - потом двигаемся дальше;
         * - это убирает ощущение “7 -> 99 за полсекунды”.
         */
        advanceDisplayedPercent: function (now, dt, elapsed) {
            const current = this.displayedPercent;
            const target = this.targetPercent;

            if (this.firstFrameReceived) {
                this.displayedPercent = moveTowards(current, 100, Math.max(2.5, 18 * dt));
                return;
            }

            if (target <= current) {
                return;
            }

            const nextStep = Math.min(100, Math.floor(current / 10) * 10 + 10);

            if (current < nextStep && target >= nextStep) {
                const speedToStep = this.computeStepSpeed(elapsed, nextStep);
                const stepped = moveTowards(current, nextStep, speedToStep * dt);
                this.displayedPercent = stepped;

                if (stepped >= nextStep) {
                    this.currentStepPercent = nextStep;
                    this.progressStepHoldUntil = now + this.getStepHoldMs(nextStep);
                }
                return;
            }

            if (now < this.progressStepHoldUntil && target >= this.currentStepPercent) {
                return;
            }

            const finalSpeed = this.computeContinuousSpeed(elapsed, target - current);
            this.displayedPercent = moveTowards(current, target, finalSpeed * dt);
        },

        computeStepSpeed: function (elapsed, stepPercent) {
            if (this.loadProfile === 'warm') {
                if (stepPercent <= 50) return 85;
                if (stepPercent <= 80) return 65;
                return 36;
            }

            if (this.loadProfile === 'updated') {
                if (stepPercent <= 40) return 55;
                if (stepPercent <= 80) return 34;
                return 20;
            }

            if (stepPercent <= 30) return 32;
            if (stepPercent <= 70) return 20;
            return 12;
        },

        computeContinuousSpeed: function (elapsed, gap) {
            if (gap <= 0) return 0;

            /**
             * Если мы уже в хвосте и ждём первый кадр,
             * продолжаем очень медленно расти по 1%.
             */
            if (this.targetPercent >= 99 && !this.firstFrameReceived) {
                return 0.95;
            }

            if (this.loadProfile === 'warm') {
                return Math.max(2.4, gap * 1.8);
            }

            if (this.loadProfile === 'updated') {
                return Math.max(1.6, gap * 1.35);
            }

            return Math.max(1.0, gap * 1.1);
        },

        getStepHoldMs: function (stepPercent) {
            if (this.loadProfile === 'warm') {
                if (stepPercent <= 50) return 70;
                if (stepPercent <= 80) return 85;
                return 110;
            }

            if (this.loadProfile === 'updated') {
                if (stepPercent <= 50) return 95;
                if (stepPercent <= 80) return 115;
                return 135;
            }

            if (stepPercent <= 30) return 110;
            if (stepPercent <= 70) return 130;
            return 150;
        },

        renderPercent: function (percent) {
            this.percentEl.textContent = Math.round(percent) + '%';
        },

        /**
         * Слева: от левого края к центру.
         * Справа: от правого края к центру.
         */
        renderDots: function (percent) {
            const activePerSide = Math.floor(clamp(percent, 0, 100) / 10);

            for (let i = 0; i < this.leftDots.length; i++) {
                const active = i < activePerSide;
                this.leftDots[i].classList.toggle('is-active', active);
            }

            for (let i = 0; i < this.rightDots.length; i++) {
                const visualIndexFromRightEdge = this.rightDots.length - 1 - i;
                const active = visualIndexFromRightEdge < activePerSide;
                this.rightDots[i].classList.toggle('is-active', active);
            }
        },

        beginFadeOut: function () {
            if (this.fadeStarted || this.hidden) return;
            this.fadeStarted = true;

            this.loadingScreen.classList.add('britlines-loading-fadeout');
            this.background.classList.add('britlines-background-fadeout');

            window.setTimeout(() => {
                this.hideNow();
            }, 760);
        },

        hideNow: function () {
            if (this.hidden) return;
            this.hidden = true;

            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = 0;
            }

            if (this.resourceObserver) {
                try {
                    this.resourceObserver.disconnect();
                } catch (e) {
                    console.warn('BritlinesLoadingOverlay: failed to disconnect observer.', e);
                }
                this.resourceObserver = null;
            }

            this.removeScaleHandlers();

            this.loadingScreen.classList.add('britlines-loading-hidden');
            this.loadingScreen.style.display = 'none';

            this.background.classList.add('britlines-background-hidden');
            this.background.style.display = 'none';
        }
    };

    window.BritlinesLoadingOverlay = overlay;

    window.addEventListener('BritlinesFirstFrame', function () {
        overlay.notifyFirstFrame();
    });
})();
