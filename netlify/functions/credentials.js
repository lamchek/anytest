// netlify/functions/credentials.js
const cookie = require('cookie');
const axios  = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    var patreonId = "";
    const cookies = cookie.parse(event.headers.cookie || '')
    if (!cookies.patreon_tokens) {
        return { statusCode:401, body: JSON.stringify({ error:'no cookies' }) }
    }
    const { access_token } = JSON.parse(cookies.patreon_tokens)
    const url = new URL('https://www.patreon.com/api/oauth2/v2/identity');
    // we still want to see which tiers you’re on…
    url.searchParams.set('include', 'memberships.currently_entitled_tiers');
    // …and we still want title & amount on those tiers
    url.searchParams.set('fields[tier]', 'title,amount_cents');
    // but now ALSO ask for the user’s thumbnail
    url.searchParams.set('fields[user]', 'full_name,thumb_url');
    try {
        console.warn("credentials.js: axois.get ")
        const resp = await axios.get(url, {headers: {Authorization: `Bearer ${access_token}`}})
        console.warn("credentials.js: axois.get: ", resp.data);
        patreonId = resp.data.data.id;
        console.warn("credentials.js: patreonId: ", patreonId);
        if (patreonId == "undefined" || patreonId == "null") {throw new Error("patreonId == \"undefined\" || patreonId == \"null\"")}
    } catch (e) {
        return { statusCode:500, body:'get identity failed' }
    }
    
    // pull your string out of event.body (POST) or event.queryStringParameters (GET)
    let payload = "";
    if (event.httpMethod === "POST" && event.body) {
        try {
            const data = JSON.parse(event.body);
            payload = {
                hash1: crypto.createHash('sha1').update(process.env.SECRET_KEY_2 + patreonId).digest('hex'),
                hash2: crypto.createHash('sha1').update(process.env.SECRET_KEY_3 + patreonId).digest('hex')
            };
            console.log("payload: ", payload);
        } catch (e) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "invalid JSON" }),
            };
        }
    } else if (event.queryStringParameters && event.queryStringParameters.text) {
        payload = event.queryStringParameters.text;
    }

    return {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json",
            // only needed if your WebGL is hosted on a different domain
            "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify(payload),
    };
};