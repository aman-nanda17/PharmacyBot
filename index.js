    require('dotenv').config();
    const express = require('express');
    const bot = require('./bot');        // Import user bot setup from bot.js
    const adminBot = require('./admin'); // Import admin bot setup from admin.js

    // Create an Express app
    const app = express();

    // Define a basic route to confirm both bots are running
    app.get('/', (req, res) => {
    res.send('Both User Bot and Admin Bot are running');
    });

    // Bind to a port provided by Render, or default to 3000 for local development
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    });

    // Launch both bots
    bot.launch();        // Start the user bot
    adminBot.launch();   // Start the admin bot