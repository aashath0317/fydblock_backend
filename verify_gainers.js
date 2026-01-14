const axios = require('axios');

async function test() {
    try {
        console.log("Fetching Top Gainers...");
        const res = await axios.get('http://localhost:5000/api/user/market-top-gainers');
        console.log("Status:", res.status);
        console.log("Data:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("Error:", e.message);
        if (e.response) {
            console.error("Response Data:", e.response.data);
        }
    }
}

test();
