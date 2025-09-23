// netlify/functions/callback.js
const axios  = require('axios');
const cookie = require('cookie');

exports.handler = async (evt) => {
    console.warn("callback.js: exports.handler");
    const { code, state } = evt.queryStringParameters;
    const cookies = cookie.parse(evt.headers.cookie || '');
    if (!cookies.oauth)           return { statusCode: 400, body: 'no oauth cookie' };
    
    const { state: origState, code_verifier } = JSON.parse(cookies.oauth);
    if (state !== origState)      return { statusCode: 400, body: 'invalid state' };
    
    // 1. Exchange code → access & refresh tokens
    const tok = (await axios.post(
        'https://www.patreon.com/api/oauth2/token',
        new URLSearchParams({
            grant_type    : 'authorization_code',
            code,
            client_id     : process.env.PATRON_CLIENT_ID,
            client_secret : process.env.PATRON_CLIENT_SECRET,
            redirect_uri  : `${process.env.BASE_URL}/.netlify/functions/callback`,
            code_verifier
        })
    )).data;
    console.log("tok.expires_in: ", tok.expires_in);
    
    // 2. Put what we want to keep in a cookie
    const toSaveTokens = JSON.stringify({
        access_token  : tok.access_token,
        refresh_token : tok.refresh_token,
        expires_at    : Date.now() + tok.expires_in * 1000       // absolute ms-timestamp
    });
    console.log("toSaveTokens: ", toSaveTokens);
    
    // 3. Cookie options – keep for 30 days
    const cookieOpts = {
        httpOnly : true,
        secure   : true,               // assumes you serve over https
        sameSite : 'lax',
        path     : '/',
        maxAge   : 60 * 60 * 24 * 30   // 30 days in seconds
        // or expires : new Date(Date.now() + 30*24*60*60*1000)
    };

    return {
        statusCode: 302,
        headers: {
            Location: '/'
        },
        multiValueHeaders: {
            'Set-Cookie': [
                cookie.serialize('patreon_tokens', toSaveTokens, cookieOpts),
                cookie.serialize('oauth',           '',          { path: '/', maxAge: 0 })
            ]
        }
    };
};

