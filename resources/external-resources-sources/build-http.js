#!/usr/bin/env node

import playwright from "@softvisio/playwright";
import * as config from "#lib/config";

const browser = await playwright.chromium.launch( {

    // "headless": true,
} );

const page = await browser.newPage( {} );

const data = {
    "userAgent": null,
};

var headers = await getHeaders( "http://httpbin.org/headers" );
parseHeaders( "http", headers );

headers = await getHeaders( "https://httpbin.org/headers" );
parseHeaders( "https", headers );

const http = config.readConfig( "http.ysml" );

http["edge-windows"] = data;

config.writeConfig( "http.ysml", http );

process.exit();

async function getHeaders ( url ) {
    await page.goto( url );

    const content = await page.content();

    // console.log( content );

    const match = content.match( /{\s+"headers":(.+?\})/s );

    const json = match[1].trim();

    const data = JSON.parse( json );

    return data;
}

function parseHeaders ( type, headers ) {
    data[type] = {};

    for ( const [header, value] of Object.entries( headers ) ) {
        const name = header.toLowerCase();

        if ( name === "user-agent" ) {
            data["userAgent"] = value;
        }
        else if ( name === "dnt" ) {
            data[type][header] = value;
        }
        else if ( name === "accept" ) {
            data[type][header] = value;
        }
        else if ( name === "accept-language" ) {
            data[type][header] = value;
        }
        else if ( name.startsWith( "sec-" ) ) {
            data[type][header] = value;
        }
    }
}
