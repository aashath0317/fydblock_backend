module.exports = {
    apps: [{
        name: "fydblock-backend",
        script: "server.js",
        watch: true,
        ignore_watch: ["logs", "node_modules", "public"],
        env: {
            NODE_ENV: "development",
        },
        env_production: {
            NODE_ENV: "production",
        }
    }]
};
