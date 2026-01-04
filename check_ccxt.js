const ccxt = require('ccxt');

async function check() {
    const ex = new ccxt.okx();
    console.log("Has Sandbox:", ex.has['sandbox']);
    console.log("URLs before:", ex.urls);

    if (ex.has['sandbox']) {
        ex.setSandboxMode(true);
        console.log("URLs after:", ex.urls);
    } else {
        console.log("No Sandbox support detected in metadata.");
    }
}

check();
