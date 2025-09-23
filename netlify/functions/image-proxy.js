// netlify/functions/image-proxy.js

exports.handler = async (event) => {
    const url = event.queryStringParameters?.url;
    if (!url) {
        return { statusCode: 400, body: "Missing url query parameter" };
    }

    // fetch is global in Node 18+ (Netlify Functions default)
    const resp = await fetch(url);
    if (!resp.ok) {
        return { statusCode: resp.status, body: `Upstream error ${resp.status}` };
    }

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await resp.arrayBuffer();

    return {
        statusCode: 200,
        headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*"
        },
        body:      Buffer.from(arrayBuffer).toString("base64"),
        isBase64Encoded: true
    };
};