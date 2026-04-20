// ### Что он делает
// - перехватывает создание `AudioContext` / `webkitAudioContext`
// - отслеживает:
//   - `interrupted`
//   - `suspended`
//   - `running / stalled`
// - после `focus/pageshow/visibilitychange -> visible`:
//   - пытается автоматически поднять `interrupted/suspended`
// - если пойман `STALLED`:
//   - armed-ит **одноразовый** recovery на следующий `pointerup`
// - на iOS WebKit после `interrupted/suspended -> running`:
//   - дополнительно armed-ит **post-resume gesture cycle**, потому что `running` там иногда ещё не значит “слышно”
// - логирует основные события в `console`
// - хранит короткий ring buffer событий
// - даёт `dump()` и `recoverNow()` через `window.__audioRecoveryGuard`
// 
// # Что можно вызывать руками из консоли
// Если захочешь иногда проверить в проде:
// window.__audioRecoveryGuard.dump()
// window.__audioRecoveryGuard.recoverNow("manual-console")
// префикс логов [audio-recovery]
(function () {
    if (window.__audioRecoveryGuardInstalled) return;
    window.__audioRecoveryGuardInstalled = true;

    const NativeAC = window.AudioContext || window.webkitAudioContext;
    const hasAudioContext = !!NativeAC;

    if (!hasAudioContext) {
        console.warn("[audio-recovery] AudioContext not supported");
        return;
    }

    class UnityWebAudioRecoveryGuard {
        constructor(options = {}) {
            this.version = "1.0.0";

            this.contexts = [];
            this.events = [];
            this.maxEvents = options.maxEvents ?? 40;

            this.updateIntervalMs = options.updateIntervalMs ?? 500;
            this.recoveryDelaysMs = options.recoveryDelaysMs ?? [120, 500, 1200];

            this.autoRecoveryEnabled = options.autoRecoveryEnabled ?? true;
            this.consoleLoggingEnabled = options.consoleLoggingEnabled ?? true;

            this.intervalId = null;
            this.recoveryScheduleToken = 0;
            this.recoveryInProgress = false;

            this.pendingGestureRecovery = false;
            this.pendingGestureRecoveryReason = "";
            this.gestureRecoveryListenerInstalled = false;
            this.gestureRecoveryEventType = "pointerup";
            this._gestureRecoveryHandler = null;
        }

        log(msg, level = "log") {
            const ts = new Date().toLocaleTimeString();
            const line = `[${ts}] ${msg}`;

            this.events.unshift(line);
            if (this.events.length > this.maxEvents) {
                this.events.length = this.maxEvents;
            }

            if (this.consoleLoggingEnabled) {
                const fn = console[level] || console.log;
                fn.call(console, `[audio-recovery] ${line}`);
            }
        }

        fmt(v, digits = 3) {
            if (v === undefined) return "n/a";
            if (v === null) return "null";
            if (typeof v === "number") {
                if (!Number.isFinite(v)) return String(v);
                return v.toFixed(digits);
            }
            return String(v);
        }

        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

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
        }

        getPageInfo() {
            return {
                href: location.href,
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : "n/a",
                audioSession: this.getAudioSessionInfo(),
                userAgent: navigator.userAgent
            };
        }

        isLikelyIOSWebKit() {
            const ua = navigator.userAgent || "";
            const isiOS =
                /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

            return isiOS && /AppleWebKit/i.test(ua);
        }

        findMeta(ctx) {
            return this.contexts.find(x => x.ctx === ctx) || null;
        }

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
            this.log(`create ctx#${meta.id} src=${meta.source} state=${ctx.state} sampleRate=${ctx.sampleRate}`);

            this.wrapContext(meta);
            return meta;
        }

        wrapContext(meta) {
            const ctx = meta.ctx;
            if (!ctx || meta.wrapped) return;
            meta.wrapped = true;

            const onStateChange = () => {
                this.log(`ctx#${meta.id} statechange -> ${ctx.state}, t=${this.fmt(ctx.currentTime)}`);
            };

            try {
                if (ctx.addEventListener) {
                    ctx.addEventListener("statechange", onStateChange);
                } else {
                    ctx.onstatechange = onStateChange;
                }
            } catch (_) {}
        }

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
                // Delayed recovery checks after visibility/focus are good for
                // interrupted/suspended states, but STALLED may appear later.
                // Therefore we also arm gesture recovery from the continuous
                // polling path, on the rising edge false -> true.
                if (
                    !wasStalled &&
                    meta.isStalled &&
                    document.visibilityState === "visible" &&
                    !this.recoveryInProgress &&
                    !this.pendingGestureRecovery
                ) {
                    this.log(`ctx#${meta.id} stalled detected`);
                    this.armGestureRecovery(`stalled-detected:ctx#${meta.id}`);
                }

                meta.lastWallTime = now;
                meta.lastAudioTime = currentAudioTime;
            }
        }

        getStalledRunningContexts() {
            return this.contexts.filter(meta => meta.ctx && meta.ctx.state === "running" && meta.isStalled);
        }

        hasInterruptedOrSuspended() {
            return this.contexts.some(x =>
                x.ctx &&
                (x.ctx.state === "interrupted" || x.ctx.state === "suspended")
            );
        }

        hasRecoverableIssue() {
            if (!this.contexts.length) return false;
            return this.hasInterruptedOrSuspended() || this.getStalledRunningContexts().length > 0;
        }

        async resumeAll(reason) {
            if (!this.contexts.length) {
                this.log(`resumeAll(${reason || "manual"}): no contexts`);
                return;
            }

            for (const meta of this.contexts) {
                const ctx = meta.ctx;
                if (typeof ctx.resume !== "function") continue;

                try {
                    this.log(`ctx#${meta.id} resumeAll(${reason}) before=${ctx.state}`);
                    await ctx.resume();
                    this.log(`ctx#${meta.id} resumeAll(${reason}) after=${ctx.state}`);
                } catch (e) {
                    this.log(`ctx#${meta.id} resume failed: ${e}`, "warn");
                }
            }
        }

        async cycleAllRunningContexts() {
            const running = this.contexts.filter(meta => meta.ctx && meta.ctx.state === "running");
            this.log(`cycleAllRunning candidates=${running.map(x => x.id).join(",") || "none"}`);

            if (!running.length) return false;

            for (const meta of running) {
                try {
                    if (typeof meta.ctx.suspend === "function") {
                        this.log(`ctx#${meta.id} cycle suspend before=${meta.ctx.state}`);
                        await meta.ctx.suspend();
                        this.log(`ctx#${meta.id} cycle suspend after=${meta.ctx.state}`);
                    }
                } catch (e) {
                    this.log(`ctx#${meta.id} suspend failed: ${e}`, "warn");
                }
            }

            await this.sleep(60);

            for (const meta of running) {
                try {
                    if (typeof meta.ctx.resume === "function") {
                        this.log(`ctx#${meta.id} cycle resume before=${meta.ctx.state}`);
                        await meta.ctx.resume();
                        this.log(`ctx#${meta.id} cycle resume after=${meta.ctx.state}`);
                    }
                } catch (e) {
                    this.log(`ctx#${meta.id} resume failed: ${e}`, "warn");
                }
            }

            return true;
        }

        async recoverNow(reason = "manual-api") {
            if (this.recoveryInProgress) {
                this.log(`recoverNow(${reason}) skipped: already running`);
                return false;
            }

            this.recoveryInProgress = true;

            try {
                this.log(`recoverNow(${reason}) start`);

                this.updateSamples();

                const hasRunning = this.contexts.some(x => x.ctx && x.ctx.state === "running");

                // IMPORTANT:
                // This path is intentionally simple and mirrors the experimentally
                // working recovery path for fake-running/stalled or audibly-dead WebAudio:
                // suspend() -> short wait -> resume() -> resumeAll()
                if (hasRunning) {
                    await this.cycleAllRunningContexts();
                    await this.sleep(40);
                }

                await this.resumeAll(`recoverNow:${reason}`);
                await this.sleep(100);

                this.updateSamples();

                const ok = !this.hasRecoverableIssue();
                if (ok) {
                    this.disarmGestureRecovery();
                    this.log(`recoverNow(${reason}) success`);
                } else {
                    this.armGestureRecovery(`after-${reason}`);
                    this.log(`recoverNow(${reason}) incomplete`, "warn");
                }

                return ok;
            } catch (e) {
                this.log(`recoverNow(${reason}) failed: ${e}`, "warn");
                this.armGestureRecovery(`error-after-${reason}`);
                return false;
            } finally {
                this.recoveryInProgress = false;
            }
        }

        async autoResumeInterruptedOrSuspended(reason) {
            if (this.recoveryInProgress) {
                this.log(`autoResume(${reason}) skipped: already running`);
                return false;
            }

            this.recoveryInProgress = true;

            try {
                const hadInterruptedOrSuspended = this.hasInterruptedOrSuspended();
                const shouldArmPostResumeGesture = hadInterruptedOrSuspended && this.isLikelyIOSWebKit();

                this.log(`autoResume(${reason}) start`);

                await this.resumeAll(`auto:${reason}:resume1`);
                await this.sleep(80);
                this.updateSamples();

                if (!this.hasRecoverableIssue()) {
                    if (shouldArmPostResumeGesture) {
                        this.armGestureRecovery(`post-resume-output-rearm:${reason}`);
                        this.log(`autoResume(${reason}) success after resume1, armed post-resume gesture cycle`);
                    } else {
                        this.disarmGestureRecovery();
                        this.log(`autoResume(${reason}) success after resume1`);
                    }
                    return true;
                }

                await this.resumeAll(`auto:${reason}:resume2`);
                await this.sleep(120);
                this.updateSamples();

                if (!this.hasRecoverableIssue()) {
                    if (shouldArmPostResumeGesture) {
                        this.armGestureRecovery(`post-resume-output-rearm:${reason}`);
                        this.log(`autoResume(${reason}) success after resume2, armed post-resume gesture cycle`);
                    } else {
                        this.disarmGestureRecovery();
                        this.log(`autoResume(${reason}) success after resume2`);
                    }
                    return true;
                }

                this.armGestureRecovery(`after-auto-${reason}`);
                this.log(`autoResume(${reason}) incomplete`, "warn");
                return false;
            } catch (e) {
                this.log(`autoResume(${reason}) failed: ${e}`, "warn");
                this.armGestureRecovery(`error-after-auto-${reason}`);
                return false;
            } finally {
                this.recoveryInProgress = false;
            }
        }

        installGestureRecoveryListener() {
            if (this.gestureRecoveryListenerInstalled) return;

            this._gestureRecoveryHandler = async (e) => {
                this.log(`gesture recovery event: ${e.type} target=${e.target?.tagName || "?"}`);

                if (!this.pendingGestureRecovery) return;
                if (this.recoveryInProgress) return;

                const reason = this.pendingGestureRecoveryReason || "pending";

                this.pendingGestureRecovery = false;
                this.pendingGestureRecoveryReason = "";
                this.removeGestureRecoveryListener();

                this.recoveryInProgress = true;

                try {
                    this.log(`gesture recovery start: ${reason}`);

                    await this.cycleAllRunningContexts();
                    await this.sleep(40);
                    await this.resumeAll(`gesture:${reason}`);
                    await this.sleep(100);

                    this.updateSamples();

                    const ok = !this.hasRecoverableIssue();
                    this.log(`gesture recovery ${ok ? "success" : "incomplete"}: ${reason}`);

                    if (!ok) {
                        this.armGestureRecovery(`retry-after-${reason}`);
                    }
                } catch (err) {
                    this.log(`gesture recovery failed: ${err}`, "warn");
                    this.armGestureRecovery(`error-after-${reason}`);
                } finally {
                    this.recoveryInProgress = false;
                }
            };

            document.addEventListener(
                this.gestureRecoveryEventType,
                this._gestureRecoveryHandler,
                { capture: true }
            );

            this.gestureRecoveryListenerInstalled = true;
            this.log(`gesture recovery listener installed: ${this.gestureRecoveryEventType}`);
        }

        removeGestureRecoveryListener() {
            if (!this.gestureRecoveryListenerInstalled || !this._gestureRecoveryHandler) return;

            document.removeEventListener(
                this.gestureRecoveryEventType,
                this._gestureRecoveryHandler,
                { capture: true }
            );

            this._gestureRecoveryHandler = null;
            this.gestureRecoveryListenerInstalled = false;
            this.log("gesture recovery listener removed");
        }

        armGestureRecovery(reason) {
            const nextReason = reason || "unknown";

            // IMPORTANT:
            // Make arming idempotent. If recovery is already armed and the one-shot
            // listener is already installed, do not spam logs or reinstall listeners.
            // We only refresh the reason.
            if (this.pendingGestureRecovery && this.gestureRecoveryListenerInstalled) {
                this.pendingGestureRecoveryReason = nextReason;
                return;
            }

            this.pendingGestureRecovery = true;
            this.pendingGestureRecoveryReason = nextReason;
            this.log(`gesture recovery armed: ${this.pendingGestureRecoveryReason}`);
            this.installGestureRecoveryListener();
        }

        disarmGestureRecovery() {
            if (!this.pendingGestureRecovery && !this.gestureRecoveryListenerInstalled) return;
            this.pendingGestureRecovery = false;
            this.pendingGestureRecoveryReason = "";
            this.removeGestureRecoveryListener();
            this.log("gesture recovery disarmed");
        }

        scheduleAutoRecovery(reason) {
            if (!this.autoRecoveryEnabled) return;
            if (!this.contexts.length) return;

            const token = ++this.recoveryScheduleToken;

            for (const delay of this.recoveryDelaysMs) {
                setTimeout(async () => {
                    if (token !== this.recoveryScheduleToken) return;
                    if (document.visibilityState !== "visible") return;

                    this.updateSamples();

                    // IMPORTANT:
                    // Delayed checks after focus/pageshow/visibilitychange are used
                    // only for interrupted / suspended states.
                    // STALLED is handled by continuous polling in updateSamples().
                    const hasInterruptedOrSuspended = this.hasInterruptedOrSuspended();

                    if (!hasInterruptedOrSuspended) return;

                    await this.autoResumeInterruptedOrSuspended(`${reason}+${delay}ms`);
                }, delay);
            }
        }

        getOverallStatus() {
            if (!this.contexts.length) {
                return {
                    label: "NO CONTEXT",
                    details: "Unity/WebAudio has not created AudioContext yet"
                };
            }

            const running = this.contexts.filter(x => x.ctx.state === "running");
            const suspended = this.contexts.filter(x => x.ctx.state === "suspended");
            const interrupted = this.contexts.filter(x => x.ctx.state === "interrupted");
            const closed = this.contexts.filter(x => x.ctx.state === "closed");
            const stalledRunning = running.filter(x => x.isStalled);

            if (interrupted.length > 0) {
                return {
                    label: "INTERRUPTED",
                    details: `${interrupted.length}/${this.contexts.length} interrupted`
                };
            }

            if (running.length > 0) {
                if (stalledRunning.length === running.length) {
                    return {
                        label: "RUNNING / STALLED",
                        details: "currentTime barely moves"
                    };
                }

                if (stalledRunning.length > 0) {
                    return {
                        label: "RUNNING / PARTIAL STALL",
                        details: "some contexts stalled"
                    };
                }

                return {
                    label: "RUNNING",
                    details: `${running.length}/${this.contexts.length} running`
                };
            }

            if (suspended.length === this.contexts.length) {
                return {
                    label: "SUSPENDED",
                    details: "all suspended"
                };
            }

            if (closed.length === this.contexts.length) {
                return {
                    label: "CLOSED",
                    details: "all closed"
                };
            }

            return {
                label: "MIXED",
                details: "mixed context states"
            };
        }

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

            console.log("[audio-recovery] dump", out);
            return out;
        }

        installPageHooks() {
            window.addEventListener("focus", () => {
                this.log("window focus");
                this.scheduleAutoRecovery("window-focus");
            });

            window.addEventListener("blur", () => {
                this.log("window blur");
                this.recoveryScheduleToken++;
            });

            window.addEventListener("pageshow", () => {
                this.log("pageshow");
                this.scheduleAutoRecovery("pageshow");
            });

            window.addEventListener("pagehide", () => {
                this.log("pagehide");
                this.recoveryScheduleToken++;
            });

            document.addEventListener("visibilitychange", () => {
                this.log(`visibilitychange -> ${document.visibilityState}`);

                if (document.visibilityState === "visible") {
                    this.scheduleAutoRecovery("visibility-visible");
                } else {
                    this.recoveryScheduleToken++;
                }
            });

            window.addEventListener("error", (e) => {
                this.log(`window error: ${e.message || e.type}`, "warn");
            });

            window.addEventListener("unhandledrejection", (e) => {
                this.log(`unhandledrejection: ${e.reason}`, "warn");
            });
        }

        installAudioContextWrapper() {
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
                this.log(`assign AudioContext failed: ${e}`, "warn");
            }

            try {
                window.webkitAudioContext = WrappedAudioContext;
            } catch (e) {
                this.log(`assign webkitAudioContext failed: ${e}`, "warn");
            }
        }

        start() {
            this.installPageHooks();
            this.installAudioContextWrapper();

            this.intervalId = window.setInterval(() => {
                this.updateSamples();
            }, this.updateIntervalMs);

            this.log(`started v${this.version}`);
        }
    }

    const guard = new UnityWebAudioRecoveryGuard({
        autoRecoveryEnabled: true,
        consoleLoggingEnabled: true,
        updateIntervalMs: 500,
        recoveryDelaysMs: [120, 500, 1200],
        maxEvents: 40
    });

    guard.start();
    window.__audioRecoveryGuard = guard;
})();
