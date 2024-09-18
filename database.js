const mysql = require('mysql');
require('dotenv').config();

let retryAttempts = 10;  // Set maximum number of retry attempts to 10

function handleDisconnect() {
    const connection = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    connection.connect(err => {
        if (err) {
            console.error('Error connecting to MySQL:', err);
            
            if (retryAttempts > 0) {
                retryAttempts--;  // Decrease retry attempts on failure
                console.log(`Retrying... attempts left: ${retryAttempts}`);
                setTimeout(handleDisconnect, 2000);  // Retry after 2 seconds
            } else {
                console.error('Max retry attempts reached. Exiting bot.');
                process.exit(1);  // Exit the process if max retries are reached
            }
        } else {
            console.log('MySQL connected...');
            retryAttempts = 10;  // Reset retry count on successful connection
        }
    });

    // Handle connection errors
    connection.on('error', err => {
        console.error('MySQL error:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
            console.error('MySQL connection lost. Reconnecting...');
            handleDisconnect();  // Automatically reconnect if the connection is lost
        } else {
            throw err;  // Other errors should be thrown and handled separately
        }
    });

    return connection;
}

// Initialize the connection
const connection = handleDisconnect();

module.exports = connection;
