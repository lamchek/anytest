(function () {
    if (window.__audioDiagInstalled) return;
    window.__audioDiagInstalled = true;

    const NativeAC = window.AudioContext || window.webkitAudioContext;
    const hasAudioContext = !!NativeAC;

    const diag = {
        version: "1.6.1",
        contexts: [],
        events: [],
        maxEvents: 30,

        panel: null,
        bodyEl: null,
        headerEl: null,
        reopenBtn: null,
        visible: true,

        updateIntervalMs: 500,
        intervalId: null,

        // Recovery state
        recoveryInProgress: false,
        autoRecoveryEnabled: true,
        recoveryScheduleToken: 0,
        recoveryDelaysMs: [120, 500, 1200],

        pendingGestureRecovery: false,
        pendingGestureRecoveryReason: "",
        gestureRecoveryListenerInstalled: false,
        gestureRecoveryEventType: "pointerup",
        _gestureRecoveryHandler: null,

        addEvent(msg) {
            const ts = new Date().toLocaleTimeString();
            this.events.unshift(`[${ts}] ${msg}`);
            if (this.events.length > this.maxEvents) {
                this.events.length = this.maxEvents;
            }
            this.render();
        },

        fmt(v, digits = 3) {
            if (v === undefined) return "n/a";
            if (v === null) return "null";
            if (typeof v === "number") {
                if (!Number.isFinite(v)) return String(v);
                return v.toFixed(digits);
            }
            return String(v);
        },

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        getAudioSessionInfo() {
            try {
                const s = navigator.audioSession;
                if (!s) return "n/a";
                const parts = [];
                if ("type" in s) parts.push(`type=${s.type}`);
                if ("state" in s) parts.push(`state=${s.state}`);
                return parts.length ? parts.join(", ") : "present";
            } catch (e) {
                return `error: ${e}`;
            }
        },

        getPageInfo() {
            return {
                href: location.href,
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : "n/a",
                audioSession: this.getAudioSessionInfo(),
                userAgent: navigator.userAgent
            };
        },

        isLikelyIOSWebKit() {
            const ua = navigator.userAgent || "";
            const isiOS =
                /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

            return isiOS && /AppleWebKit/i.test(ua);
        },

        findMeta(ctx) {
            return this.contexts.find(x => x.ctx === ctx) || null;
        },

        getPreferredContext() {
            const runningHealthy = this.contexts.find(x => x.ctx && x.ctx.state === "running" && !x.isStalled);
            if (runningHealthy) return runningHealthy.ctx;

            const runningAny = this.contexts.find(x => x.ctx && x.ctx.state === "running");
            if (runningAny) return runningAny.ctx;

            return this.contexts.length ? this.contexts[0].ctx : null;
        },

        registerContext(ctx, source) {
            let meta = this.findMeta(ctx);
            if (meta) return meta;

            meta = {
                id: this.contexts.length,
                ctx,
                source: source || ctx.__audioDiagSource || "wrapped",
                createdAt: performance.now(),

                lastWallTime: performance.now(),
                lastAudioTime: Number(ctx.currentTime) || 0,

                wallDelta: 0,
                audioDelta: 0,
                rate: 0,

                isStalled: false,
                stallCount: 0,
                wrapped: false
            };

            this.contexts.push(meta);

            this.addEvent(
                `create ctx#${meta.id} src=${meta.source} state=${ctx.state} sampleRate=${ctx.sampleRate}`
            );

            this.wrapContext(meta);
            this.render();
            return meta;
        },

        wrapContext(meta) {
            const ctx = meta.ctx;
            if (!ctx || meta.wrapped) return;
            meta.wrapped = true;

            const onStateChange = () => {
                this.addEvent(`ctx#${meta.id} statechange -> ${ctx.state}, t=${this.fmt(ctx.currentTime)}`);
                this.render();
            };

            try {
                if (ctx.addEventListener) {
                    ctx.addEventListener("statechange", onStateChange);
                } else {
                    ctx.onstatechange = onStateChange;
                }
            } catch (_) {}

            if (typeof ctx.resume === "function") {
                const origResume = ctx.resume.bind(ctx);
                ctx.resume = async () => {
                    this.addEvent(`ctx#${meta.id} resume() before=${ctx.state}`);
                    const result = await origResume();
                    this.addEvent(`ctx#${meta.id} resume() after=${ctx.state}`);
                    this.render();
                    return result;
                };
            }

            if (typeof ctx.suspend === "function") {
                const origSuspend = ctx.suspend.bind(ctx);
                ctx.suspend = async () => {
                    this.addEvent(`ctx#${meta.id} suspend() before=${ctx.state}`);
                    const result = await origSuspend();
                    this.addEvent(`ctx#${meta.id} suspend() after=${ctx.state}`);
                    this.render();
                    return result;
                };
            }

            if (typeof ctx.close === "function") {
                const origClose = ctx.close.bind(ctx);
                ctx.close = async () => {
                    this.addEvent(`ctx#${meta.id} close() before=${ctx.state}`);
                    const result = await origClose();
                    this.addEvent(`ctx#${meta.id} close() after=${ctx.state}`);
                    this.render();
                    return result;
                };
            }
        },

        updateSamples() {
            const now = performance.now();

            for (const meta of this.contexts) {
                const ctx = meta.ctx;
                const wasStalled = meta.isStalled;
                const currentAudioTime = Number(ctx.currentTime) || 0;
                const wallSec = (now - meta.lastWallTime) / 1000;
                const audioSec = currentAudioTime - meta.lastAudioTime;

                meta.wallDelta = wallSec;
                meta.audioDelta = audioSec;
                meta.rate = wallSec > 0 ? audioSec / wallSec : 0;

                // IMPORTANT:
                // "STALLED" means state=running, but currentTime barely moves.
                // This is exactly the Safari / iOS WebKit state we want to detect.
                const stalledNow =
                    ctx.state === "running" &&
                    wallSec >= 0.35 &&
                    meta.rate < 0.25 &&
                    audioSec < 0.05;

                if (stalledNow) meta.stallCount++;
                else meta.stallCount = 0;

                meta.isStalled = meta.stallCount >= 2;

                // IMPORTANT:
                // scheduleAutoRecovery() handles interrupted / suspended shortly after
                // focus/pageshow/visibilitychange. But STALLED may appear later, after those
                // delayed checks already passed. Therefore we also arm gesture recovery here,
                // from the continuous polling path, on the rising edge false -> true.
                if (
                    !wasStalled &&
                    meta.isStalled &&
                    document.visibilityState === "visible" &&
                    !this.recoveryInProgress &&
                    !this.pendingGestureRecovery
                ) {
                    this.addEvent(`ctx#${meta.id} stalled detected`);
                    this.armGestureRecovery(`stalled-detected:ctx#${meta.id}`);
                }

                meta.lastWallTime = now;
                meta.lastAudioTime = currentAudioTime;
            }
        },

        getStalledRunningContexts() {
            return this.contexts.filter(meta => meta.ctx && meta.ctx.state === "running" && meta.isStalled);
        },

        hasInterruptedOrSuspended() {
            return this.contexts.some(x =>
                x.ctx &&
                (x.ctx.state === "interrupted" || x.ctx.state === "suspended")
            );
        },

        hasRecoverableIssue() {
            if (!this.contexts.length) return false;
            return this.hasInterruptedOrSuspended() || this.getStalledRunningContexts().length > 0;
        },

        getOverallStatus() {
            if (!hasAudioContext) {
                return {
                    label: "UNSUPPORTED",
                    color: "#ff6b6b",
                    details: "AudioContext not supported"
                };
            }

            if (this.contexts.length === 0) {
                return {
                    label: "NO CONTEXT",
                    color: "#9aa0a6",
                    details: "Unity/WebAudio has not created AudioContext yet"
                };
            }

            const states = this.contexts.map(x => x.ctx.state);
            const running = this.contexts.filter(x => x.ctx.state === "running");
            const suspended = this.contexts.filter(x => x.ctx.state === "suspended");
            const interrupted = this.contexts.filter(x => x.ctx.state === "interrupted");
            const closed = this.contexts.filter(x => x.ctx.state === "closed");
            const stalledRunning = running.filter(x => x.isStalled);

            if (interrupted.length > 0) {
                return {
                    label: "INTERRUPTED",
                    color: "#ff4d4f",
                    details: `${interrupted.length}/${this.contexts.length} context(s) interrupted`
                };
            }

            if (running.length > 0) {
                if (stalledRunning.length === running.length) {
                    return {
                        label: "RUNNING / STALLED",
                        color: "#ff8c42",
                        details: "Context state=running, but currentTime barely moves"
                    };
                }

                if (stalledRunning.length > 0) {
                    return {
                        label: "RUNNING / PARTIAL STALL",
                        color: "#ffd166",
                        details: "Some running contexts look stalled"
                    };
                }

                return {
                    label: "RUNNING",
                    color: "#35d07f",
                    details: `${running.length}/${this.contexts.length} context(s) running`
                };
            }

            if (suspended.length === this.contexts.length) {
                return {
                    label: "SUSPENDED",
                    color: "#f4c542",
                    details: "All contexts suspended"
                };
            }

            if (closed.length === this.contexts.length) {
                return {
                    label: "CLOSED",
                    color: "#b0b0b0",
                    details: "All contexts closed"
                };
            }

            return {
                label: `MIXED: ${states.join(", ")}`,
                color: "#8ab4f8",
                details: "Mixed context states"
            };
        },

        async resumeAll(reason) {
            if (!this.contexts.length) {
                this.addEvent(`resumeAll(${reason || "manual"}): no contexts`);
                return;
            }

            for (const meta of this.contexts) {
                const ctx = meta.ctx;
                if (typeof ctx.resume !== "function") continue;

                try {
                    await ctx.resume();
                } catch (e) {
                    this.addEvent(`ctx#${meta.id} resume failed: ${e}`);
                    console.error("[audio-diag] resume failed", e);
                }
            }

            this.render();
        },

        async cycleAllRunningContexts() {
            const running = this.contexts.filter(meta => meta.ctx && meta.ctx.state === "running");
            this.addEvent(`cycleAllRunning candidates=${running.map(x => x.id).join(",") || "none"}`);

            if (!running.length) return false;

            for (const meta of running) {
                try {
                    if (typeof meta.ctx.suspend === "function") {
                        await meta.ctx.suspend();
                    }
                } catch (e) {
                    this.addEvent(`ctx#${meta.id} suspend failed: ${e}`);
                }
            }

            await this.sleep(60);

            for (const meta of running) {
                try {
                    if (typeof meta.ctx.resume === "function") {
                        await meta.ctx.resume();
                    }
                } catch (e) {
                    this.addEvent(`ctx#${meta.id} resume failed: ${e}`);
                }
            }

            return true;
        },

        async recoverAudio(reason = "manual") {
            if (this.recoveryInProgress) {
                this.addEvent(`recoverAudio(${reason}) skipped: already running`);
                return false;
            }

            this.recoveryInProgress = true;
            this.render();

            try {
                this.addEvent(`recoverAudio(${reason}) start`);

                this.updateSamples();
                this.render();

                const hasRunning = this.contexts.some(x => x.ctx && x.ctx.state === "running");

                // Manual/UI recovery is itself a user gesture, so it is safe to try
                // the cycle path directly for running contexts.
                if (hasRunning) {
                    await this.cycleAllRunningContexts();
                    await this.sleep(40);
                }

                await this.resumeAll(`recover:${reason}:resume1`);
                await this.sleep(100);

                this.updateSamples();
                this.render();

                if (!this.hasRecoverableIssue()) {
                    this.disarmGestureRecovery();
                    this.addEvent(`recoverAudio(${reason}) success`);
                    return true;
                }

                // If still broken, next real gesture gets one direct cycle attempt.
                this.armGestureRecovery(`after-${reason}`);
                this.addEvent(`recoverAudio(${reason}) incomplete`);
                return false;
            } catch (e) {
                this.addEvent(`recoverAudio(${reason}) failed: ${e}`);
                console.error("[audio-diag] recoverAudio failed", e);
                this.armGestureRecovery(`error-after-${reason}`);
                return false;
            } finally {
                this.recoveryInProgress = false;
                this.render();
            }
        },

        async autoResumeInterruptedOrSuspended(reason) {
            if (this.recoveryInProgress) {
                this.addEvent(`autoResume(${reason}) skipped: already running`);
                return false;
            }

            this.recoveryInProgress = true;
            this.render();

            try {
                const hadInterruptedOrSuspended = this.hasInterruptedOrSuspended();
                const shouldArmPostResumeGesture = hadInterruptedOrSuspended && this.isLikelyIOSWebKit();

                this.addEvent(`autoResume(${reason}) start`);

                await this.resumeAll(`auto:${reason}:resume1`);
                await this.sleep(80);
                this.updateSamples();
                this.render();

                if (!this.hasRecoverableIssue()) {
                    if (shouldArmPostResumeGesture) {
                        this.armGestureRecovery(`post-resume-output-rearm:${reason}`);
                        this.addEvent(`autoResume(${reason}) success after resume1, armed post-resume gesture cycle`);
                    } else {
                        this.disarmGestureRecovery();
                        this.addEvent(`autoResume(${reason}) success after resume1`);
                    }
                    return true;
                }

                await this.resumeAll(`auto:${reason}:resume2`);
                await this.sleep(120);
                this.updateSamples();
                this.render();

                if (!this.hasRecoverableIssue()) {
                    if (shouldArmPostResumeGesture) {
                        this.armGestureRecovery(`post-resume-output-rearm:${reason}`);
                        this.addEvent(`autoResume(${reason}) success after resume2, armed post-resume gesture cycle`);
                    } else {
                        this.disarmGestureRecovery();
                        this.addEvent(`autoResume(${reason}) success after resume2`);
                    }
                    return true;
                }

                this.armGestureRecovery(`after-auto-${reason}`);
                this.addEvent(`autoResume(${reason}) incomplete`);
                return false;
            } catch (e) {
                this.addEvent(`autoResume(${reason}) failed: ${e}`);
                console.error("[audio-diag] autoResume failed", e);
                this.armGestureRecovery(`error-after-auto-${reason}`);
                return false;
            } finally {
                this.recoveryInProgress = false;
                this.render();
            }
        },

        installGestureRecoveryListener() {
            if (this.gestureRecoveryListenerInstalled) return;

            this._gestureRecoveryHandler = async (e) => {
                this.addEvent(`gesture recovery event: ${e.type} target=${e.target?.tagName || "?"}`);

                if (!this.pendingGestureRecovery) return;
                if (this.recoveryInProgress) return;

                const reason = this.pendingGestureRecoveryReason || "pending";

                this.pendingGestureRecovery = false;
                this.pendingGestureRecoveryReason = "";
                this.removeGestureRecoveryListener();

                this.recoveryInProgress = true;
                this.render();

                try {
                    this.addEvent(`gesture recovery start: ${reason}`);

                    await this.cycleAllRunningContexts();
                    await this.sleep(40);
                    await this.resumeAll(`gesture:${reason}`);
                    await this.sleep(100);

                    this.updateSamples();
                    this.render();

                    const ok = !this.hasRecoverableIssue();
                    this.addEvent(`gesture recovery ${ok ? "success" : "incomplete"}: ${reason}`);

                    if (!ok) {
                        this.armGestureRecovery(`retry-after-${reason}`);
                    }
                } catch (err) {
                    this.addEvent(`gesture recovery failed: ${err}`);
                    this.armGestureRecovery(`error-after-${reason}`);
                } finally {
                    this.recoveryInProgress = false;
                    this.render();
                }
            };

            document.addEventListener(
                this.gestureRecoveryEventType,
                this._gestureRecoveryHandler,
                { capture: true }
            );

            this.gestureRecoveryListenerInstalled = true;
            this.addEvent(`gesture recovery listener installed: ${this.gestureRecoveryEventType}`);
        },

        removeGestureRecoveryListener() {
            if (!this.gestureRecoveryListenerInstalled || !this._gestureRecoveryHandler) return;

            document.removeEventListener(
                this.gestureRecoveryEventType,
                this._gestureRecoveryHandler,
                { capture: true }
            );

            this._gestureRecoveryHandler = null;
            this.gestureRecoveryListenerInstalled = false;
            this.addEvent("gesture recovery listener removed");
        },

        armGestureRecovery(reason) {
            const nextReason = reason || "unknown";

            // IMPORTANT:
            // Make arming idempotent. If recovery is already armed and the one-shot
            // listener is already installed, do not spam logs or reinstall listeners.
            // We only refresh the reason.
            if (this.pendingGestureRecovery && this.gestureRecoveryListenerInstalled) {
                this.pendingGestureRecoveryReason = nextReason;
                this.render();
                return;
            }

            this.pendingGestureRecovery = true;
            this.pendingGestureRecoveryReason = nextReason;
            this.addEvent(`gesture recovery armed: ${this.pendingGestureRecoveryReason}`);
            this.installGestureRecoveryListener();
            this.render();
        },

        disarmGestureRecovery() {
            if (!this.pendingGestureRecovery && !this.gestureRecoveryListenerInstalled) return;
            this.pendingGestureRecovery = false;
            this.pendingGestureRecoveryReason = "";
            this.removeGestureRecoveryListener();
            this.addEvent("gesture recovery disarmed");
            this.render();
        },

        scheduleAutoRecovery(reason) {
            if (!this.autoRecoveryEnabled) return;
            if (!this.contexts.length) return;

            const token = ++this.recoveryScheduleToken;

            for (const delay of this.recoveryDelaysMs) {
                setTimeout(async () => {
                    if (token !== this.recoveryScheduleToken) return;
                    if (document.visibilityState !== "visible") return;

                    this.updateSamples();
                    this.render();

                    // IMPORTANT:
                    // Delayed checks after focus/pageshow/visibilitychange are now used
                    // only for interrupted / suspended states.
                    // STALLED is handled by continuous polling in updateSamples().
                    const hasInterruptedOrSuspended = this.hasInterruptedOrSuspended();

                    if (!hasInterruptedOrSuspended) return;

                    await this.autoResumeInterruptedOrSuspended(`${reason}+${delay}ms`);
                }, delay);
            }
        },

        async beep(options = {}) {
            const {
                resume = false,
                createIfMissing = false,
                frequency = 440,
                gainValue = 0.1,
                duration = 0.25
            } = options;

            let ctx = this.getPreferredContext();

            if (!ctx) {
                if (!createIfMissing) {
                    this.addEvent("beep skipped: no existing AudioContext");
                    this.render();
                    return;
                }

                try {
                    try { window.__audioDiagNextSource = "beep-created"; } catch (_) {}
                    ctx = new NativeAC();
                    this.registerContext(ctx, "beep-created");
                } catch (e) {
                    this.addEvent(`beep create ctx failed: ${e}`);
                    console.error("[audio-diag] beep create ctx failed", e);
                    return;
                } finally {
                    try { window.__audioDiagNextSource = undefined; } catch (_) {}
                }
            }

            try {
                if (resume && typeof ctx.resume === "function") {
                    await ctx.resume();
                }

                if (ctx.state !== "running") {
                    this.addEvent(`beep skipped: ctx state=${ctx.state} (resume ${resume ? "enabled" : "disabled"})`);
                    this.render();
                    return;
                }

                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = "sine";
                osc.frequency.value = frequency;
                gain.gain.value = gainValue;

                osc.connect(gain);
                gain.connect(ctx.destination);

                const startAt = ctx.currentTime;
                const stopAt = startAt + duration;

                osc.start(startAt);
                osc.stop(stopAt);

                this.addEvent(`beep() on ctx state=${ctx.state}, t=${this.fmt(ctx.currentTime)}, resume=${resume}`);
            } catch (e) {
                this.addEvent(`beep failed: ${e}`);
                console.error("[audio-diag] beep failed", e);
            }

            this.render();
        },

        createToneWavUrl({ durationMs = 120, sampleRate = 8000, frequency = 440, amplitude = 0.02 } = {}) {
            const numChannels = 1;
            const bitsPerSample = 16;
            const bytesPerSample = bitsPerSample / 8;
            const sampleCount = Math.max(1, Math.floor(sampleRate * durationMs / 1000));
            const dataSize = sampleCount * numChannels * bytesPerSample;
            const buffer = new ArrayBuffer(44 + dataSize);
            const view = new DataView(buffer);

            const writeString = (offset, str) => {
                for (let i = 0; i < str.length; i++) {
                    view.setUint8(offset + i, str.charCodeAt(i));
                }
            };

            writeString(0, "RIFF");
            view.setUint32(4, 36 + dataSize, true);
            writeString(8, "WAVE");
            writeString(12, "fmt ");
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
            view.setUint16(32, numChannels * bytesPerSample, true);
            view.setUint16(34, bitsPerSample, true);
            writeString(36, "data");
            view.setUint32(40, dataSize, true);

            let offset = 44;
            for (let i = 0; i < sampleCount; i++) {
                const t = i / sampleRate;
                const fadeIn = Math.min(1, i / 64);
                const fadeOut = Math.min(1, (sampleCount - i) / 64);
                const fade = Math.min(fadeIn, fadeOut);
                const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude * fade;
                const s = Math.max(-1, Math.min(1, sample));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
                offset += 2;
            }

            return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
        },

        async htmlAudioBeep(options = {}) {
            const {
                durationMs = 120,
                frequency = 440,
                amplitude = 0.02
            } = options;

            let url = null;
            let audio = null;

            try {
                url = this.createToneWavUrl({ durationMs, frequency, amplitude });

                audio = document.createElement("audio");
                audio.preload = "auto";
                audio.playsInline = true;
                audio.src = url;
                audio.style.display = "none";

                (document.body || document.documentElement).appendChild(audio);

                await audio.play();
                this.addEvent("htmlAudioBeep play() ok");

                await this.sleep(durationMs + 40);

                try { audio.pause(); } catch (_) {}
                try { audio.currentTime = 0; } catch (_) {}

                return true;
            } catch (e) {
                this.addEvent(`htmlAudioBeep failed: ${e}`);
                console.warn("[audio-diag] htmlAudioBeep failed", e);
                return false;
            } finally {
                try {
                    if (audio && audio.parentNode) {
                        audio.parentNode.removeChild(audio);
                    }
                } catch (_) {}

                try {
                    if (url) URL.revokeObjectURL(url);
                } catch (_) {}
            }
        },

        dump() {
            const out = {
                version: this.version,
                page: this.getPageInfo(),
                overall: this.getOverallStatus(),
                recoveryInProgress: this.recoveryInProgress,
                autoRecoveryEnabled: this.autoRecoveryEnabled,
                pendingGestureRecovery: this.pendingGestureRecovery,
                pendingGestureRecoveryReason: this.pendingGestureRecoveryReason,
                gestureRecoveryListenerInstalled: this.gestureRecoveryListenerInstalled,
                gestureRecoveryEventType: this.gestureRecoveryEventType,
                contexts: this.contexts.map(meta => ({
                    id: meta.id,
                    source: meta.source,
                    state: meta.ctx.state,
                    currentTime: meta.ctx.currentTime,
                    sampleRate: meta.ctx.sampleRate,
                    baseLatency: meta.ctx.baseLatency,
                    outputLatency: meta.ctx.outputLatency,
                    destinationChannelCount: meta.ctx.destination ? meta.ctx.destination.channelCount : undefined,
                    destinationMaxChannelCount: meta.ctx.destination ? meta.ctx.destination.maxChannelCount : undefined,
                    wallDelta: meta.wallDelta,
                    audioDelta: meta.audioDelta,
                    rate: meta.rate,
                    isStalled: meta.isStalled,
                    stallCount: meta.stallCount
                })),
                events: [...this.events]
            };

            console.log("[audio-diag] dump", out);
            return out;
        },

        show() {
            this.visible = true;
            if (this.panel) this.panel.style.display = "block";
            if (this.reopenBtn) this.reopenBtn.style.display = "none";
        },

        hide() {
            this.visible = false;
            if (this.panel) this.panel.style.display = "none";
            if (this.reopenBtn) this.reopenBtn.style.display = "block";
        },

        toggle() {
            if (this.visible) this.hide();
            else this.show();
        },

        createButton(text, onClick) {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.style.cssText = [
                "font: 12px monospace",
                "padding: 4px 6px",
                "background: #1f1f1f",
                "color: #fff",
                "border: 1px solid #555",
                "border-radius: 4px",
                "cursor: pointer",
                "pointer-events: auto"
            ].join(";");
            btn.addEventListener("click", onClick);
            return btn;
        },

        createUI() {
            if (this.panel) return;

            const panel = document.createElement("div");
            panel.id = "audio-diag-panel";
            panel.style.cssText = [
                "position: fixed",
                "left: 8px",
                "bottom: 8px",
                "z-index: 2147483647",
                "width: min(300px, calc(100vw - 16px))",
                "height: auto",
                "overflow: visible",
                "background: rgba(0,0,0,0.25)",
                "color: rgba(215,255,215,0.9)",
                "font: 10px/1.35 monospace",
                "border: 1px solid rgba(255,255,255,0.22)",
                "border-radius: 8px",
                "padding: 8px",
                "box-shadow: 0 4px 14px rgba(0,0,0,0.35)",
                "white-space: pre-wrap",
                "word-break: break-word",
                "user-select: text",
                "pointer-events: none"
            ].join(";");

            const header = document.createElement("div");
            header.style.cssText = [
                "margin-bottom: 6px",
                "padding: 6px",
                "border-radius: 6px",
                "font-weight: bold"
            ].join(";");

            const controls = document.createElement("div");
            controls.style.cssText = [
                "display:flex",
                "gap:6px",
                "margin-bottom:6px",
                "flex-wrap:wrap"
            ].join(";");

            const resumeBtn = this.createButton("Resume all", () => this.resumeAll("button"));
            const recoverBtn = this.createButton("Recover", () => this.recoverAudio("button"));
            const htmlBeepBtn = this.createButton("HTML beep", () => this.htmlAudioBeep());
            const beepBtn = this.createButton("Beep(no resume)", () => this.beep());
            const dumpBtn = this.createButton("Dump", () => this.dump());
            const hideBtn = this.createButton("Hide", () => this.hide());

            controls.appendChild(resumeBtn);
            controls.appendChild(recoverBtn);
            controls.appendChild(htmlBeepBtn);
            controls.appendChild(beepBtn);
            controls.appendChild(dumpBtn);
            controls.appendChild(hideBtn);

            const body = document.createElement("div");
            body.id = "audio-diag-body";

            panel.appendChild(header);
            panel.appendChild(controls);
            panel.appendChild(body);

            const reopenBtn = document.createElement("button");
            reopenBtn.textContent = "Audio";
            reopenBtn.style.cssText = [
                "position: fixed",
                "left: 8px",
                "bottom: 8px",
                "z-index: 2147483647",
                "display: none",
                "font: 12px monospace",
                "padding: 6px 8px",
                "background: rgba(0,0,0,0.86)",
                "color: #fff",
                "border: 1px solid #555",
                "border-radius: 6px",
                "cursor: pointer",
                "pointer-events: auto"
            ].join(";");
            reopenBtn.addEventListener("click", () => this.show());

            (document.body || document.documentElement).appendChild(panel);
            (document.body || document.documentElement).appendChild(reopenBtn);

            this.panel = panel;
            this.bodyEl = body;
            this.headerEl = header;
            this.reopenBtn = reopenBtn;

            this.render();
        },

        render() {
            if (!this.panel || !this.bodyEl || !this.headerEl) return;

            const st = this.getOverallStatus();
            const recoveringSuffix = this.recoveryInProgress ? " [RECOVERING]" : "";

            this.headerEl.textContent = `${st.label}${recoveringSuffix} — ${st.details}`;
            this.headerEl.style.background = st.color;
            this.headerEl.style.color = "#111";

            const p = this.getPageInfo();
            const lines = [];

            lines.push(`audio-diag v${this.version}`);
            lines.push(`visibility: ${p.visibilityState} | hidden=${p.hidden} | hasFocus=${p.hasFocus}`);
            lines.push(`audioSession: ${p.audioSession}`);
            lines.push(`contexts: ${this.contexts.length}`);
            lines.push(
                `autoRecovery: ${this.autoRecoveryEnabled ? "on" : "off"} | recovering: ${this.recoveryInProgress} | gestureRecovery: ${this.pendingGestureRecovery ? "ARMED" : "idle"} | listener: ${this.gestureRecoveryListenerInstalled ? "on" : "off"}`
            );
            if (this.pendingGestureRecovery) {
                lines.push(`next gesture recovery reason: ${this.pendingGestureRecoveryReason}`);
            }
            lines.push("");

            if (!hasAudioContext) {
                lines.push("AudioContext not supported in this browser.");
            } else if (!this.contexts.length) {
                lines.push("No AudioContext created yet.");
            } else {
                for (const meta of this.contexts) {
                    const ctx = meta.ctx;
                    const stateColor =
                        ctx.state === "running" ? "OK" :
                            ctx.state === "suspended" ? "WARN" :
                                ctx.state === "interrupted" ? "ERR" :
                                    ctx.state === "closed" ? "CLOSED" : "INFO";

                    lines.push(`ctx#${meta.id} [${stateColor}] src=${meta.source}`);
                    lines.push(`  state:         ${ctx.state}${meta.isStalled ? "  <-- STALLED?" : ""}`);
                    lines.push(`  currentTime:   ${this.fmt(ctx.currentTime)}`);
                    lines.push(`  Δaudio:        ${this.fmt(meta.audioDelta)} s`);
                    lines.push(`  Δwall:         ${this.fmt(meta.wallDelta)} s`);
                    lines.push(`  rate:          ${this.fmt(meta.rate)}x`);
                    lines.push(`  sampleRate:    ${this.fmt(ctx.sampleRate, 0)}`);
                    lines.push(`  baseLatency:   ${this.fmt(ctx.baseLatency)}`);
                    lines.push(`  outputLatency: ${this.fmt(ctx.outputLatency)}`);
                    lines.push(
                        `  destination:   ch=${ctx.destination ? ctx.destination.channelCount : "n/a"} / max=${ctx.destination ? ctx.destination.maxChannelCount : "n/a"}`
                    );
                    lines.push("");
                }
            }

            lines.push("recent events:");
            if (!this.events.length) {
                lines.push("  (none)");
            } else {
                for (const e of this.events) lines.push(`  ${e}`);
            }

            this.bodyEl.textContent = lines.join("\n");
        },

        installPageHooks() {
            window.addEventListener("focus", () => {
                this.addEvent("window focus");
                this.scheduleAutoRecovery("window-focus");
            });

            window.addEventListener("blur", () => {
                this.addEvent("window blur");
                this.recoveryScheduleToken++;
            });

            window.addEventListener("pageshow", () => {
                this.addEvent("pageshow");
                this.scheduleAutoRecovery("pageshow");
            });

            window.addEventListener("pagehide", () => {
                this.addEvent("pagehide");
                this.recoveryScheduleToken++;
            });

            document.addEventListener("visibilitychange", () => {
                this.addEvent(`visibilitychange -> ${document.visibilityState}`);

                if (document.visibilityState === "visible") {
                    this.scheduleAutoRecovery("visibility-visible");
                } else {
                    this.recoveryScheduleToken++;
                }
            });

            window.addEventListener("error", (e) => {
                this.addEvent(`window error: ${e.message || e.type}`);
            });

            window.addEventListener("unhandledrejection", (e) => {
                this.addEvent(`unhandledrejection: ${e.reason}`);
            });
        },

        installAudioContextWrapper() {
            if (!hasAudioContext) return;

            const self = this;

            function WrappedAudioContext(...args) {
                const source = window.__audioDiagNextSource || "wrapped";
                const ctx = new NativeAC(...args);

                try {
                    ctx.__audioDiagSource = source;
                } catch (_) {}

                self.registerContext(ctx, source);
                return ctx;
            }

            try {
                WrappedAudioContext.prototype = NativeAC.prototype;
                Object.setPrototypeOf(WrappedAudioContext, NativeAC);
            } catch (_) {}

            try {
                window.AudioContext = WrappedAudioContext;
            } catch (e) {
                this.addEvent(`assign AudioContext failed: ${e}`);
            }

            try {
                window.webkitAudioContext = WrappedAudioContext;
            } catch (e) {
                this.addEvent(`assign webkitAudioContext failed: ${e}`);
            }
        },

        start() {
            this.installPageHooks();
            this.installAudioContextWrapper();

            const buildUI = () => {
                this.createUI();
                this.addEvent("audio diag initialized");
            };

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", buildUI, { once: true });
            } else {
                buildUI();
            }

            this.intervalId = window.setInterval(() => {
                this.updateSamples();
                this.render();
            }, this.updateIntervalMs);

            window.__audioDiag = this;
        }
    };

    diag.start();
})();
