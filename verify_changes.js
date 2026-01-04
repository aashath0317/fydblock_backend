const { getSupportedExchanges } = require('./controllers/userController');

async function testExchangeLogic() {
    console.log("Starting verification...");

    const mockRes = {
        json: (data) => console.log("Supported Exchanges:", JSON.stringify(data, null, 2))
    };

    try {
        getSupportedExchanges({}, mockRes);
    } catch (e) {
        console.error("Error testing getSupportedExchanges:", e);
    }
}

testExchangeLogic();
