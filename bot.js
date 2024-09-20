  require('dotenv').config();
  const fs = require('fs');
  // Global error handling to log errors into a file
  process.on('unhandledRejection', (reason, promise) => {
    console.error('UserBot: Unhandled Rejection at:', promise, 'reason:', reason);
    fs.appendFileSync('userbot_error.log', `Unhandled Rejection: ${reason}\n`);
  });

  process.on('uncaughtException', (err) => {
    console.error('UserBot: Uncaught Exception:', err);
    fs.appendFileSync('userbot_error.log', `Uncaught Exception: ${err}\n`);
  });

  const { Telegraf, Markup } = require('telegraf');
  const LocalSession = require('telegraf-session-local');
  const pool = require('./database');
  const { Keyboard } = require('telegram-keyboard');

  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  const adminBot = new Telegraf(process.env.ADMIN_BOT_TOKEN);

  // Initialize session middleware
  const localSession = new LocalSession({ database: 'session_db.json' });
  bot.use(localSession.middleware());

  // Define persistent keyboard with Status, Assign, and Journey Details buttons
  const mainKeyboard = Keyboard.make(['Status', 'Assign', 'Journey Details'], {columns: 2}).reply();

  const startMessage = 
  `🚗🚦 WELCOME TO THE VEHICLE ASSIGNMENT BOT! 🚦🚗

  ` +
  `Use the commands below to manage vehicle assignments:
  ` +
  `────────────────────────────

  ` +
  `1️⃣ /status - Check the current status of all vehicles. 

  ` +
  `2️⃣ /assign - Assign a vehicle to an employee and set a destination.

  ` +
  `3️⃣ /journey - View your journey details for today.
  
  ` +
  `────────────────────────────
  ` +
  `👉 Ready to go? Just type a command to get started! 😊
  ` ;

  // Start command
  bot.start((ctx) => {
      ctx.reply(startMessage, mainKeyboard);
  });

  // Function to handle the status command and button for the admin
  const handleStatus = (ctx) => {
    // Modify the query to order the results: assigned vehicles first, then those in the pharmacy
    const query = `
        SELECT * 
        FROM vehicles 
        ORDER BY 
            CASE 
                WHEN status = 'pharmacy' THEN 1 
                ELSE 0 
            END, 
            name;
    `;
    
    pool.query(query, (err, results) => {
        if (err) throw err;

        let message = '<b>Vehicle Status:</b>\n\n';
        message += '<pre>'; // Use preformatted text for better alignment
        message += 'Vehicle         | Destination        | User       | Assigned At\n';
        message += '------------------------------------------------------------------\n';

        results.forEach(vehicle => {
            const vehicleName = vehicle.name.padEnd(15, ' ');
            const destination = (vehicle.current_destination || 'pharmacy').padEnd(20, ' ');
            const user = (vehicle.current_employee || 'Available').padEnd(10, ' ');
            const assignedAt = vehicle.assigned_at ? new Date(vehicle.assigned_at).toLocaleString() : 'N/A';

            if (vehicle.status !== 'pharmacy') {
                // Highlight the row in uppercase if the vehicle is not in the pharmacy
                message += `🚗${vehicleName.toUpperCase()} | ${destination.toUpperCase()} | ${user.toUpperCase()} | ${assignedAt}\n`;
            } else {
                // Regular row formatting for vehicles in the pharmacy
                message += `${vehicleName} | ${destination} | ${user} | ${assignedAt}\n`;
            }
        });

        message += '</pre>';
        
        // Send the message
        ctx.replyWithHTML(message);
    });
  };

  // Handle the status button and command
  bot.hears('Status', handleStatus);
  bot.command('status', handleStatus);

  // Function to handle journey details
    const handleJourneyDetails = (ctx) => {
        const userId = ctx.from.id;

        // Authenticate user
        pool.query('SELECT id FROM users WHERE telegram_id = ?', [userId], (err, userResults) => {
            if (err) throw err;

            if (userResults.length === 0) {
                ctx.reply('You are not authenticated to view journey details.');
                return;
            }

            const user_id = userResults[0].id;

            // Prompt the user with inline buttons for date selection
            ctx.reply('Select the date for your journey details:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Today', callback_data: `user_date_${user_id}_0` }],
                        [{ text: 'Yesterday', callback_data: `user_date_${user_id}_1` }],
                        [{ text: 'Day before Yesterday', callback_data: `user_date_${user_id}_2` }]
                    ]
                }
            });
        });
    };

    // Function to handle journey details based on selected date
    bot.action(/user_date_(\d+)_(\d+)/, (ctx) => {
        const [user_id, dayOffset] = ctx.match.slice(1);

        // Calculate the date based on the offset (0 = Today, 1 = Yesterday, 2 = Day before Yesterday)
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - parseInt(dayOffset));

        // Fetch journey details for the selected date
        pool.query(
            `SELECT vehicle_name, destination, assigned_at, returned_at, total_time 
            FROM journeys
            WHERE user_id = ? AND DATE(assigned_at) = DATE(?)`,
            [user_id, targetDate],
            (err, journeyResults) => {
                if (err) throw err;

                if (journeyResults.length === 0) {
                    ctx.reply('No journeys found for the selected date.');
                    return;
                }

                let message = `<b>Your Journey Details for ${targetDate.toDateString()}:</b>\n\n`;
                message += '<pre>';
                message += 'Vehicle       | Destination       | Assigned At          | Returned At          | Total Time\n';
                message += '------------------------------------------------------------------------------------------------\n';

                journeyResults.forEach(journey => {
                    const vehicleName = journey.vehicle_name.padEnd(13, ' ');
                    const destination = (journey.destination || 'N/A').padEnd(17, ' ');
                    const assignedAt = journey.assigned_at ? new Date(journey.assigned_at).toLocaleString() : 'N/A';
                    const returnedAt = journey.returned_at ? new Date(journey.returned_at).toLocaleString() : 'In Progress';
                    const totalTime = journey.total_time || 'N/A';

                    message += `${vehicleName} | ${destination} | ${assignedAt} | ${returnedAt} | ${totalTime}\n`;
                });

                message += '</pre>';
                ctx.replyWithHTML(message);
            }
        );
    });


    // Handle the journey details button and command
    bot.hears('Journey Details', handleJourneyDetails);
    bot.command('journey', handleJourneyDetails);

    // Assign vehicle command
    const assignVehicle = (ctx) => {
        const userId = ctx.from.id;

        // Fetch the user ID from the database
        pool.query('SELECT id, name FROM users WHERE telegram_id = ?', [userId], (err, userResults) => {
            if (err) throw err;

            if (userResults.length === 0) {
                ctx.reply('You are not authenticated to assign a vehicle.');
                return;
            }

            const userIdFromDB = userResults[0].id;
            const username = userResults[0].name;

            // Check if the user already has an assigned vehicle
            pool.query('SELECT * FROM vehicles WHERE user_id = ?', [userIdFromDB], (err, results) => {
                if (err) throw err;

                if (results.length > 0) {
                    const vehicleName = results[0].name;
                    ctx.reply(`You already have the vehicle "${vehicleName}" assigned. Please return it before assigning a new one.`);
                    return;
                }

                // Store username in session for use later
                ctx.session.username = username;

                // Fetch available vehicles
                pool.query('SELECT name FROM vehicles WHERE status = "pharmacy"', (err, vehicles) => {
                    if (err) throw err;

                    const vehicleNames = vehicles.map(vehicle => vehicle.name);
                    if (vehicleNames.length === 0) {
                        ctx.reply('No vehicles available.');
                        return;
                    }

                    // Arrange vehicle buttons in two columns
                    const vehicleButtons = [];
                    for (let i = 0; i < vehicleNames.length; i += 2) {
                        const buttonRow = [
                            Markup.button.callback(vehicleNames[i], `assign_${vehicleNames[i]}`)
                        ];
                        if (i + 1 < vehicleNames.length) {
                            buttonRow.push(Markup.button.callback(vehicleNames[i + 1], `assign_${vehicleNames[i + 1]}`));
                        }
                        vehicleButtons.push(buttonRow);
                    }
                    ctx.reply('Select a vehicle:', Markup.inlineKeyboard(vehicleButtons));
                });
            });
        });
    };

  // Handle vehicle assignment from both button and command
  bot.hears('Assign', assignVehicle);
  bot.command('assign', assignVehicle);

  // Handle vehicle selection
    bot.action(/assign_(.+)/, (ctx) => {
        const vehicleName = ctx.match[1];
        ctx.session.vehicleName = vehicleName;  // Store vehicleName in session
        const { username } = ctx.session;

        // Fetch predefined destinations not assigned to any vehicle
        pool.query('SELECT name FROM destinations WHERE name NOT IN (SELECT current_destination FROM vehicles WHERE status = "in_use")', (err, destinations) => {
            if (err) throw err;

            // Arrange destination buttons in two columns
            const destinationButtons = [];
            for (let i = 0; i < destinations.length; i += 2) {
                const buttonRow = [
                    Markup.button.callback(destinations[i].name, `destination_${destinations[i].name}`)
                ];
                if (i + 1 < destinations.length) {
                    buttonRow.push(Markup.button.callback(destinations[i + 1].name, `destination_${destinations[i + 1].name}`));
                }
                destinationButtons.push(buttonRow);
            }
            ctx.reply(`User ${username} selected. Now select the destination:`, Markup.inlineKeyboard(destinationButtons));
        });
    });

    // Handle destination selection and final assignment
    bot.action(/destination_(.+)/, (ctx) => {
        const destination = ctx.match[1];
        const { vehicleName, username } = ctx.session;
        const userId = ctx.from.id;

        const now = new Date();
        const currentTime = now.toLocaleString(); // Capture the current time
        
        pool.query('SELECT id FROM users WHERE telegram_id = ?', [userId], (err,userResults) => {

            if (err) {
                console.error('UserBot: Database query error:', err);
                ctx.reply('A database error occurred. Please try again later.');
                return;
            }
        
            console.log('UserBot: Query Result for userId:', userId, 'Results:', userResults); // Debugging line
        
            if (userResults.length === 0) {
                ctx.reply('Error: User not found in the database.');
                return;
            }

            const userIdFromDB = userResults[0].id;
            // Update the vehicle's status, destination, employee, and user_id
            pool.query(
                'UPDATE vehicles SET status = ?, current_destination = ?, current_employee = ?, user_id = ?, assigned_at = NOW() WHERE name = ?',
                ['in_use', destination, username, userIdFromDB, vehicleName],
                (err) => {
                    if (err) throw err;

                    // Log the journey
                    pool.query(
                        'INSERT INTO journeys (user_id, vehicle_name, destination, assigned_at) VALUES (?, ?, ?, NOW())',
                        [userIdFromDB, vehicleName, destination],
                        (err) => {
                            if (err) throw err;
                        }
                    );

                    // Log the user_id to verify that the correct user is being assigned
                    console.log(`UserBot: Vehicle assigned to user_id: ${userId}`);

                    ctx.reply(`Vehicle ${vehicleName} assigned to ${destination} with employee ${username} at ${currentTime}.`, mainKeyboard);
                    ctx.session.vehicleName = null; // Clear the session data
                    ctx.session.username = null; // Clear the session data

                    // Notify the admin about the vehicle assignment
                    const adminId = process.env.ADMIN_TELEGRAM_ID;
                    adminBot.telegram.sendMessage(adminId, `🚗 User ${ctx.from.username || ctx.from.id} has assigned the vehicle "${vehicleName}" to themselves at ${currentTime}.\n\nEmployee: ${username}\nDestination: ${destination}`)
                        .then(() => {
                            console.log(`UserBot: Acknowledgment sent to admin_id: ${adminId}`);
                        })
                        .catch((sendErr) => {
                            console.error(`UserBot: Failed to send acknowledgment to the admin. Error: ${sendErr.message}`);
                        });
                }
            );
        });
    });

  // Handle unknown commands
  bot.on('message', (ctx) => {
    const messageText = ctx.message.text;

    if (messageText.startsWith('/')) {
        // If the command is not /status or /assign, treat it as unknown
        if (messageText !== '/status' && messageText !== '/assign' && messageText !== '/journey') {
          ctx.reply("Unknown command. Please use the available commands.", mainKeyboard);
        }
    } else {
        // For any other text, respond with the start message and main keyboard
        ctx.reply("Unknown command. Please use the available commands.", mainKeyboard);
    }
  });

  module.exports = bot; // Export the bot so it can be used in index.js
