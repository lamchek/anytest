// netlify/functions/start.js
const crypto = require('crypto');
const cookie = require('cookie');

exports.handler = async () => {
    // 1) generate PKCE & state
    const state          = crypto.randomBytes(16).toString('hex');
    const code_verifier  = crypto.randomBytes(32).toString('base64url');
    const code_challenge = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest()
        .toString('base64url');

    // stash them in a cookie
    const oauth = JSON.stringify({ state, code_verifier });

    // 2) build Patreon authorize URL
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     process.env.PATRON_CLIENT_ID,
        redirect_uri:  `${process.env.BASE_URL}/.netlify/functions/callback`,
        scope:         'identity',
        state,
        code_challenge,
        code_challenge_method: 'S256'
    });

    // 3) redirect the user
    return {
        statusCode: 302,
        headers: {
            'Set-Cookie': cookie.serialize('oauth', oauth, {
                httpOnly : true,
                secure   : true,
                sameSite : 'lax',
                path     : '/',
                maxAge   : 60 * 10          // 10-minute lifetime (optional)
            }),
            Location: `https://www.patreon.com/oauth2/authorize?${params}`
        }
    };
};