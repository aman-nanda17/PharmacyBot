const mysql = require('mysql');
require('dotenv').config();

const pool = mysql.createPool({
    connectionLimit: 10,  // Adjust the limit as needed
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Log pool creation
console.log('MySQL connection pool created...');

// Handle errors for the pool
pool.on('error', (err) => {
    console.error('MySQL pool error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
        console.error('MySQL connection lost. Trying to reconnect...');
    } else {
        throw err;  // Other errors should be handled appropriately
    }
});

module.exports = pool;
