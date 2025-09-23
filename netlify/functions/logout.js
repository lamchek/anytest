// netlify/functions/logout.js
const cookie = require('cookie');

exports.handler = async () => {
    const deleteCookie = cookie.serialize(
        'patreon_tokens',
        '',                       // empty value
        {
            httpOnly : true,
            secure   : true,
            sameSite : 'lax',
            path     : '/',
            maxAge   : 0           // immediately expire
            // you can also add domain: 'your.domain.com' if you set it originally
        }
    );

    return {
        statusCode : 200,
        headers    : {
            'Set-Cookie'   : deleteCookie,
            'Content-Type' : 'application/json'
        },
        body : JSON.stringify({ loggedOut: true })
    };
};