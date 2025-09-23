// netlify/functions/whoami.js
const axios  = require('axios');
const cookie = require('cookie');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const COOKIE_NAME      = 'patreon_tokens';
const COOKIE_LIFETIME  = 60 * 60 * 24 * 30;  // 30 days  (in seconds)

const cookieOptions = {
    httpOnly : true,
    secure   : true,
    sameSite : 'lax',
    path     : '/',
    maxAge   : COOKIE_LIFETIME
};

// ─────────────────────────────────────────────────────────────────────────────
// Lambda
// ─────────────────────────────────────────────────────────────────────────────
exports.handler = async (evt) => {
    try {
        // 1) Pull the token-info out of the cookie
        const cookies = cookie.parse(evt.headers.cookie || '');

        const rndValue     = generateString(8);
        const sessionToken = crypto
            .createHash('sha1')
            .update(rndValue + process.env.SECRET_KEY_1)
            .digest('hex');

        const cloudCodeSecret = encryptString(
            process.env.CLOUD_CODE_SECRET,
            sessionToken.substring(0, 12)
        );

        if (!cookies[COOKIE_NAME]) {
            console.warn('whoami.js: (!cookies.patreon_tokens ⇒ 401) cloudCodeSecret:',
                         cloudCodeSecret);
            return {
                statusCode : 401,
                body       : JSON.stringify({ sessionToken, cloudCodeSecret })
            };
        }

        let patreonCookie = JSON.parse(cookies[COOKIE_NAME]);
        let accessToken   = patreonCookie.access_token;
        let setCookieHeader;

        // 2) Refresh if access token is about to expire (safety margin 60 s)
        const now = Date.now();
        if (now > patreonCookie.expires_at - 60_000) {
            console.warn('access_token expired!!! → try refresh now');
            const params = new URLSearchParams({
                grant_type    : 'refresh_token',
                refresh_token : patreonCookie.refresh_token,
                client_id     : process.env.PATRON_CLIENT_ID,
                client_secret : process.env.PATRON_CLIENT_SECRET
            });

            const refreshRequest = await axios.post(
                'https://www.patreon.com/api/oauth2/token',
                params
            );
            const data = refreshRequest.data;
            console.log('access_token refresh response:', data);

            // compute new absolute expiry timestamp
            patreonCookie = {
                access_token  : data.access_token,
                refresh_token : data.refresh_token,
                expires_at    : Date.now() + data.expires_in * 1000
            };
            accessToken = patreonCookie.access_token;
        } else {
            console.log('access_token is valid! no need to update! now:',
                        now, ', patreonCookie.expires_at:',
                        patreonCookie.expires_at);
        }

        // 2b) Always (re)write the cookie so that maxAge slides forward
        setCookieHeader = cookie.serialize(
            COOKIE_NAME,
            JSON.stringify(patreonCookie),
            cookieOptions
        );

        // 3) Call Patreon “whoami” /identity endpoint
        const url = new URL('https://www.patreon.com/api/oauth2/v2/identity');
        url.searchParams.set('include', 'memberships.currently_entitled_tiers');
        url.searchParams.set('fields[tier]', 'title,amount_cents');
        url.searchParams.set('fields[user]', 'full_name,thumb_url');

        console.warn('whoami.js: axios.get');
        const resp = await axios.get(url.toString(), {
            headers : { Authorization: `Bearer ${accessToken}` }
        });
        console.warn('whoami.js: axios.get:', resp.data);

        // 4) Massage the Patreon response into your session payload
        const pd        = resp.data.data;
        const patreonId = pd.id;
        const fullName  = pd.attributes.full_name;
        const icon      = pd.attributes.thumb_url;

        console.warn('whoami.js: patreonId:', patreonId);

        const tiers = (resp.data.included || []).filter(x => x.type === 'tier');
        tiers.forEach(tier => {
            console.log('---');
            console.log('Tier ID:      ', tier.id);
            console.log('Tier title:   ', tier.attributes.title);
            console.log('Amount (USD): ', tier.attributes.amount_cents / 100);
        });

        let tierId = 'FreeTier';
        if (tiers.length > 0) tierId = tiers[0].id;

        const tierHash = crypto
            .createHash('sha1')
            .update(patreonId + tierId + process.env.SECRET_KEY_4)
            .digest('hex');

        const dayString = getDayStringJS();
        const tierToken = crypto
            .createHash('sha1')
            .update(sessionToken + dayString + tierHash)
            .digest('hex');

        console.warn('whoami.js: dayString:', dayString);
        console.warn('whoami.js: sessionToken:', sessionToken);
        console.warn('whoami.js: tierHash:', tierHash);
        console.warn('whoami.js: tierToken:', tierToken);

        const payload = {
            cloudCodeSecret,
            sessionToken,
            tierToken,
            userData : { id: patreonId, name: fullName, icon }
        };

        // 5) Build the response
        return {
            statusCode : 200,
            headers    : {
                'Content-Type' : 'application/json',
                'Set-Cookie'   : setCookieHeader
            },
            body : JSON.stringify(payload)
        };

    } catch (err) {
        console.error('whoami.js error:', err);
        return { statusCode: 500, body: 'fetch failed' };
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – unchanged
// ─────────────────────────────────────────────────────────────────────────────
function generateString(length) {
    const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
                                                characters.length));
    }
    return result;
}

function getDayStringJS(date = new Date()) {
    // Midnight UTC of the date
    const msPerDay  = 24 * 60 * 60 * 1000;
    const epoch     = Date.UTC(date.getUTCFullYear(),
                               date.getUTCMonth(),
                               date.getUTCDate());
    const dayNumber = Math.floor(epoch / msPerDay);
    // Base36 for compactness (use .toString(36)), or just dayNumber.toString() for decimal
    return dayNumber.toString(36); // Most compact, still only numbers and letters
}

/**
 * Encrypt a string with password (AES-256-CBC + PBKDF2), returns base64.
 * Compatible with the C# example and browser-side versions.
 */
function encryptString(plainText, password) {
    const keySizeBytes = 32;   // AES-256
    const ivSize       = 16;
    const saltSize     = 16;
    const iterations   = 100_000;

    const salt   = crypto.randomBytes(saltSize);
    const iv     = crypto.randomBytes(ivSize);
    const key    = crypto.pbkdf2Sync(password, salt, iterations,
                                     keySizeBytes, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    const plainBytes = Buffer.from(plainText, 'utf8');
    const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);

    // Package: [salt][iv][ciphertext]
    const out = Buffer.concat([salt, iv, encrypted]);
    return out.toString('base64');
}