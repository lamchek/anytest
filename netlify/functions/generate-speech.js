const { createHash } = require("crypto");
const { Redis }      = require("@upstash/redis");

// If you use node-fetch in your dependencies, import it like this:
// const fetch = require('node-fetch'); // (For Netlify Node 18+, global fetch is available.)

const redis = Redis.fromEnv();
const DEBUG = process.env.DEBUG_LOGS !== "0";
function log(...a) { if (DEBUG) console.log(...a); }

function mimeFor(fmt = "") {
    fmt = fmt.toLowerCase();
    if (fmt.startsWith("mp3"))   return "audio/mpeg";
    if (fmt.startsWith("wav"))   return "audio/wav";
    if (fmt.startsWith("pcm"))   return "audio/wav";
    if (fmt.startsWith("opus"))  return "audio/ogg";
    return "application/octet-stream";
}

// Netlify expects module.exports.handler for CommonJS
exports.handler = async (event) => {
    const start = Date.now();
    log("─── New invocation", { method: event.httpMethod, path: event.path });

    /* ───── NEW: dump raw event.body ─────────────────────── */
    log("Raw event.body:", event.body /*.substring(0, 800)*/ || "<empty>");
    // NOTE: .substring removed for clarity

    try {
        if (event.httpMethod !== "POST") {
            log("Rejected – wrong HTTP verb:", event.httpMethod);
            return { statusCode: 405, body: "Method Not Allowed" };
        }

        /* 1. Parse body ---------------------------------------------------- */
        let b;
        try { b = JSON.parse(event.body || "{}"); }
        catch (e) {
            log("JSON parse error:", e.message);
            return { statusCode: 400, body: "Body must be valid JSON" };
        }

        const {
            text,
            stage,
            language,
            guid,
            voiceId      = "21m00Tcm4TlvDq8ikWAM",
            modelId      = "eleven_multilingual_v2",
            outputFormat = "mp3_44100_128",
            speakerBoost = false,
            speed        = 1.0
        } = b;

        if (!text || typeof text !== "string") {
            log("Rejected – missing text field");
            return { statusCode: 400, body: "Missing 'text' field" };
        }

        /* 2. Cache key ----------------------------------------------------- */
        const uniqueHash = createHash("sha256")
            .update([voiceId, modelId, outputFormat, speakerBoost ? 1 : 0,
                speed.toFixed(2), text].join("|"))
            .digest("hex");
        const key = `SB:${stage}:${language}:${guid}:${uniqueHash}`;

        log("Params", { voiceId, modelId, outputFormat, speed, key });

        /* 3. Redis lookup -------------------------------------------------- */
        try {
            const cached = await redis.get(key);
            if (cached) {
                log("Cache HIT –", (cached.length/1024).toFixed(1), "KB",
                    "in", Date.now() - start, "ms");
                return {
                    statusCode: 200,
                    headers: {
                        "Content-Type": mimeFor(outputFormat),
                        "Access-Control-Allow-Origin": "*"
                    },
                    body: cached,
                    isBase64Encoded: true
                };
            }
            log("Cache MISS");
        } catch (e) {
            log("Redis error (ignored):", e);
        }

        /* 4. ElevenLabs ---------------------------------------------------- */
        const wantMime = mimeFor(outputFormat);
        log("Calling ElevenLabs …");
        const t0 = Date.now();

        const bodyData = {
            text,
            model_id:      modelId,
            output_format: outputFormat,
            speed,
            voice_settings: {
                stability: 0.75,
                similarity_boost: 0.75,
                use_speaker_boost: speakerBoost
            }
        };
        log("to ElevenLabs bodyData: ", bodyData);

        // Netlify Node 18+ supports global fetch; if on 16, you'll need node-fetch package.
        const elRes = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method:  "POST",
                headers: {
                    "xi-api-key":   process.env.ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                    "Accept":       wantMime
                },
                body: JSON.stringify(bodyData)
            }
        );

        log("ElevenLabs status", elRes.status, "after", Date.now() - t0, "ms");

        if (!elRes.ok) {
            const err = await elRes.text();
            log("ElevenLabs error payload:", err);
            return { statusCode: elRes.status, body: err };
        }

        const buf      = Buffer.from(await elRes.arrayBuffer());
        const audioB64 = buf.toString("base64");
        log("Clip size", (buf.length/1024).toFixed(1), "KB");

        /* 5. Store in Redis ----------------------------------------------- */
        try {
            await redis.set(key, audioB64, { ex: 60*60*24*7 });
            log("Stored in Redis (TTL 7d)");
        } catch (e) {
            log("Redis SET failed:", e);
        }

        /* 6. Respond ------------------------------------------------------- */
        log("Done – total", Date.now() - start, "ms");
        return {
            statusCode: 200,
            headers: {
                "Content-Type": wantMime,
                "Access-Control-Allow-Origin": "*"
            },
            body: audioB64,
            isBase64Encoded: true
        };

    } catch (err) {
        console.error("FATAL:", err);
        return { statusCode: 500, body: "Internal Server Error" };
    }
};