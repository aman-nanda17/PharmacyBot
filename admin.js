    require('dotenv').config();
    const fs = require('fs');
    // Global error handling to log errors into a file
    process.on('unhandledRejection', (reason, promise) => {
        console.error('AdminBot: Unhandled Rejection at:', promise, 'reason:', reason);
        fs.appendFileSync('admin_error.log', `Unhandled Rejection: ${reason}\n`);
    });

    process.on('uncaughtException', (err) => {
        console.error('AdminBot: Uncaught Exception:', err);
        fs.appendFileSync('admin_error.log', `Uncaught Exception: ${err}\n`);
    });

    const { Telegraf, Markup } = require('telegraf');
    const LocalSession = require('telegraf-session-local');
    const pool = require('./database');
    const { Keyboard } = require('telegram-keyboard');

    const adminBot = new Telegraf(process.env.ADMIN_BOT_TOKEN);

    // Initialize the user bot with the TELEGRAM_BOT_TOKEN
    const userBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    // Initialize the session middleware
    const localSession = new LocalSession({ database: 'admin_session_db.json' });
    adminBot.use(localSession.middleware());

    // Define persistent keyboard with Status,Return and Assign buttons
    const adminKeyboard = Keyboard.make(['Assign', 'Return', 'Status', 'Journey Details'], {columns: 2}).reply();

    const startMessage =
    `🚗🚦 WELCOME ADMIN !! 🚦🚗\n\n` +
    `Use the commands below to manage vehicles:\n` +
    `────────────────────────────\n\n` +
    `1️⃣ /status - Check the current status of all vehicles.\n\n` +
    `2️⃣ /return - Return a vehicle to the pharmacy.\n\n` +
    `3️⃣ /assign - Assign a vehicle to a user.\n\n` +
    `4️⃣ /journey - View a user's journey details.\n\n` +
    `────────────────────────────\n\n` +
    `👉 Ready to go? Just type a command to get started! 😊`;

    // Start command
    adminBot.start((ctx) => {
        ctx.reply(startMessage, adminKeyboard);
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
                    // Highlight the row in red if the vehicle is not in the pharmacy
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

    // Handle the status button and command for the admin
    adminBot.hears('Status', handleStatus);
    adminBot.command('status', handleStatus);

    // Handle return command and button
    const handleReturn = (ctx) => {
        pool.query('SELECT name, current_employee FROM vehicles WHERE status = "in_use"', (err, results) => {
            if (err) throw err;

            if (results.length === 0) {
                ctx.reply('No vehicles are currently in use.', adminKeyboard);
                return;
            }

            // Create buttons with the format "{vehicle name} assigned to {username}"
            const returnButtons = results.map(vehicle => [Markup.button.callback(`Return ${vehicle.name} assigned to ${vehicle.current_employee}`, `return_${vehicle.name}`)]);

            ctx.reply('Select the vehicle to return:', Markup.inlineKeyboard(returnButtons));
        });
    };

    // Handle the return button and command for the admin
    adminBot.hears('Return', handleReturn);
    adminBot.command('return', handleReturn);

    adminBot.action(/return_(.+)/, (ctx) => {
        const vehicleName = ctx.match[1].trim();
    
        // Fetch the user_id, assigned_at, and other details for the vehicle
        pool.query(
            'SELECT user_id, current_employee, current_destination, assigned_at FROM vehicles WHERE name = ?',
            [vehicleName],
            (err, results) => {
                if (err) {
                    console.error('AdminBot: Error fetching vehicle data:', err);
                    ctx.reply('An error occurred while fetching vehicle data. Please try again.');
                    return;
                }
    
                if (results.length === 0) {
                    ctx.reply("Vehicle not found.");
                    return;
                }
    
                const { user_id, current_employee, current_destination, assigned_at } = results[0];
    
                // Retrieve the user's telegram_id from the users table
                pool.query('SELECT telegram_id FROM users WHERE id = ?', [user_id], (err, userResults) => {
                    if (err) {
                        console.error('AdminBot: Database query error:', err);
                        ctx.reply('A database error occurred. Please try again later.');
                        return;
                    }
    
                    if (userResults.length === 0) {
                        ctx.reply('Error: User not found in the database.');
                        return;
                    }
    
                    const userTelegramId = userResults[0].telegram_id;
    
                    // Calculate time spent
                    const now = new Date();
                    const assignedAt = new Date(assigned_at);
                    const timeDiff = now - assignedAt; // Difference in milliseconds
    
                    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
                    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
    
                    const totalTime = `${hours}:${minutes}:${seconds}`;
                    const returnTime = now.toLocaleString(); // Capture the current return time
    
                    // Update the journey details in the journeys table
                    pool.query(
                        'UPDATE journeys SET returned_at = ?, total_time = ? WHERE user_id = ? AND vehicle_name = ? AND assigned_at = ?',
                        [now, totalTime, user_id, vehicleName, assigned_at],
                        (err) => {
                            if (err) {
                                console.error('AdminBot: Error updating journey data:', err);
                                ctx.reply('An error occurred while updating the journey details. Please try again.');
                            } else {
                                console.log('AdminBot: Journey details updated successfully.');
    
                                // Update the vehicle's status back to 'pharmacy'
                                pool.query(
                                    'UPDATE vehicles SET status = "pharmacy", current_destination = NULL, current_employee = NULL, user_id = NULL, assigned_at = NULL, returned_at = NULL WHERE name = ?',
                                    [vehicleName],
                                    (err, updateResults) => {
                                        if (err) {
                                            console.error('AdminBot: Error updating vehicle status:', err);
                                            ctx.reply('An error occurred while returning the vehicle. Please try again.');
                                            return;
                                        }
    
                                        if (updateResults.affectedRows > 0) {
                                            ctx.reply(`🚗 Vehicle ${vehicleName} has been returned to the pharmacy at ${returnTime}. \n\nTime spent: ${hours} hours, ${minutes} minutes, ${seconds} seconds.`);
    
                                            // Attempt to send acknowledgment to the user
                                            userBot.telegram.sendMessage(userTelegramId, `🚗 Your vehicle "${vehicleName}" has been successfully returned to the pharmacy by the admin at ${returnTime}.\n\nEmployee: ${current_employee}\nDestination: ${current_destination}\nTime spent: ${hours} hours, ${minutes} minutes, ${seconds} seconds`)
                                                .then(() => {
                                                    console.log(`AdminBot: Acknowledgment sent to user_id: ${userTelegramId}`);
                                                })
                                                .catch((sendErr) => {
                                                    console.error(`AdminBot: Failed to send acknowledgment to the user. Error: ${sendErr.message}`);
                                                    ctx.reply('Failed to send acknowledgment to the user.');
                                                });
                                        } else {
                                            ctx.reply(`Vehicle ${vehicleName} not found.`);
                                        }
                                    }
                                );
                            }
                        }
                    );
                });
            }
        );
    });
    
    // Handle assign command and button
    const handleAssign = (ctx) => {
        // Fetch available vehicles
        pool.query('SELECT name FROM vehicles WHERE status = "pharmacy"', (err, vehicles) => {
            if (err) throw err;
    
            const vehicleNames = vehicles.map(vehicle => vehicle.name);
            if (vehicleNames.length === 0) {
                ctx.reply('No vehicles available.', adminKeyboard);
                return;
            }
    
            // Arrange vehicle buttons in two columns
            const vehicleButtons = [];
            for (let i = 0; i < vehicleNames.length; i += 2) {
                const buttonRow = [
                    Markup.button.callback(vehicleNames[i], `admin_assign_${vehicleNames[i]}`)
                ];
                if (i + 1 < vehicleNames.length) {
                    buttonRow.push(Markup.button.callback(vehicleNames[i + 1], `admin_assign_${vehicleNames[i + 1]}`));
                }
                vehicleButtons.push(buttonRow);
            }
            ctx.reply('Select a vehicle:', Markup.inlineKeyboard(vehicleButtons));
        });
    };

    // Handle vehicle assignment from both button and command
    adminBot.hears('Assign', handleAssign);
    adminBot.command('assign', handleAssign);

    // Handle vehicle selection for assignment
    adminBot.action(/admin_assign_(.+)/, (ctx) => {
        const vehicleName = ctx.match[1];
        ctx.session.vehicleName = vehicleName;
    
        // Fetch users who do not have a vehicle assigned
        pool.query('SELECT name, telegram_id FROM users WHERE name NOT IN (SELECT current_employee FROM vehicles WHERE status = "in_use")', (err, users) => {
            if (err) {
                console.error('AdminBot: Error querying users:', err);
                ctx.reply('An error occurred while retrieving users. Please try again.', adminKeyboard);
                return;
            }
    
             // Arrange buttons in two columns
            const userButtons = [];
            for (let i = 0; i < users.length; i += 2) {
                const buttonRow = [
                    Markup.button.callback(users[i].name, `admin_user_${users[i].name}_${users[i].telegram_id || 'null'}`)
                ];
                if (i + 1 < users.length) {
                    buttonRow.push(Markup.button.callback(users[i + 1].name, `admin_user_${users[i + 1].name}_${users[i + 1].telegram_id || 'null'}`));
                }
                userButtons.push(buttonRow);
            }
            ctx.reply(`Vehicle ${vehicleName} selected. Select the employee:`, Markup.inlineKeyboard(userButtons));
        });
    });



    // Handle user selection
    adminBot.action(/admin_user_(.+)_(.+)/, (ctx) => {
        const employeeName = ctx.match[1];
        const userTelegramId = ctx.match[2];  // Extracted Telegram ID
    
        // First, check if the user already has a vehicle assigned
        pool.query('SELECT * FROM vehicles WHERE user_id = ? AND status = "in_use"', [userTelegramId], (err, results) => {
            if (err) {
                console.error('AdminBot: Error querying vehicle data:', err);
                ctx.reply('An error occurred while checking the user’s vehicle assignment. Please try again.');
                return;
            }
    
            if (results.length > 0) {
                // User already has a vehicle assigned
                ctx.reply(`⚠️ The user "${employeeName}" already has a vehicle assigned. Please select a different user.`);
    
                // Retrieve the selected vehicle name from the session
                const vehicleName = ctx.session.vehicleName;
    
                // Update the vehicle status back to 'pharmacy'
                pool.query(
                    'UPDATE vehicles SET status = "pharmacy", current_employee = NULL, user_id = NULL, assigned_at = NULL, returned_at = NULL WHERE name = ?',
                    [vehicleName],
                    (err, updateResults) => {
                        if (err) {
                            console.error('AdminBot: Error updating vehicle status:', err);
                            ctx.reply('An error occurred while returning the vehicle to the pharmacy. Please try again.');
                            return;
                        }
    
                        if (updateResults.affectedRows > 0) {
                            ctx.reply(`The vehicle "${vehicleName}" has been returned to the pharmacy.`, adminKeyboard);
                        }
                    }
                );
    
                ctx.session = null; // Clear session
                return; // Stop further execution
            }

            // If no issues, proceed with storing employee name and Telegram ID in the session
            ctx.session.employeeName = employeeName;
            ctx.session.userTelegramId = userTelegramId === 'null' ? null : userTelegramId; 
    
            // Proceed to destination selection...
            pool.query('SELECT name FROM destinations WHERE name NOT IN (SELECT current_destination FROM vehicles WHERE status = "in_use")', (err, destinations) => {
                if (err) throw err;
    
                // Arrange destination buttons in two columns
                const destinationButtons = [];
                for (let i = 0; i < destinations.length; i += 2) {
                    const buttonRow = [
                        Markup.button.callback(destinations[i].name, `admin_destination_${destinations[i].name}`)
                    ];
                    if (i + 1 < destinations.length) {
                        buttonRow.push(Markup.button.callback(destinations[i + 1].name, `admin_destination_${destinations[i + 1].name}`));
                    }
                    destinationButtons.push(buttonRow);
                }
                ctx.reply(`Employee ${employeeName} selected. Now select the destination:`, Markup.inlineKeyboard(destinationButtons));
            });
        });
    });
    

    // Handle destination selection and final assignment
    adminBot.action(/admin_destination_(.+)/, (ctx) => {
        const destinationName = ctx.match[1];

        // Retrieve the necessary data from the session
        const vehicleName = ctx.session.vehicleName;
        const employeeName = ctx.session.employeeName;
        const userTelegramId = ctx.session.userTelegramId;

        if (!vehicleName || !employeeName) {
            ctx.reply('An error occurred. Missing information. Please try again.', adminKeyboard);
            return;
        }

        // Update the vehicle with the selected user and destination
        const now = new Date();
        const currentTime = now.toLocaleString(); // Capture the current time

        pool.query('SELECT id FROM users WHERE telegram_id = ?', [userTelegramId], (err, userResults) => {

            if (err) {
                console.error('AdminBot: Database query error:', err);
                ctx.reply('A database error occurred. Please try again later.');
                return;
            }
        
            console.log('AdminBot: Query Result for userId:', userTelegramId, 'Results:', userResults); // Debugging line
        
            if (userResults.length === 0) {
                ctx.reply('Error: User not found in the database.');
                return;
            }

            const userIdFromDB = userResults[0].id;

            pool.query(
                'UPDATE vehicles SET status = "in_use", current_employee = ?, user_id = ?, current_destination = ?, assigned_at = ? WHERE name = ?',
                [employeeName, userIdFromDB, destinationName, now, vehicleName],
                (err, updateResults) => {
                    if (err) {
                        console.error('AdminBot: Error updating vehicle assignment:', err);
                        ctx.reply('An error occurred while assigning the vehicle. Please try again.', adminKeyboard);
                        return;
                    }

                    if (updateResults.affectedRows > 0) {
                        ctx.reply(`🚗Vehicle ${vehicleName} assigned to ${destinationName} with employee ${employeeName} at ${currentTime}.`);

                        // Log the journey
                        pool.query(
                            'INSERT INTO journeys (user_id, vehicle_name, destination, assigned_at) VALUES (?, ?, ?, ?)',
                            [userIdFromDB, vehicleName, destinationName, now],
                            (err) => {
                                if (err) throw err;
                            }
                        );

                        // Skip notification if userTelegramId is null
                        if (userTelegramId) {
                            userBot.telegram.sendMessage(userTelegramId, `🚗 You have been assigned the vehicle "${vehicleName}" for the destination "${destinationName}". \n\nAssigned at: ${currentTime}`)
                                .then(() => {
                                    console.log(`AdminBot: Notification sent to user with Telegram ID: ${userTelegramId}`);
                                })
                                .catch((sendErr) => {
                                    console.error(`AdminBot: Failed to send notification to the user. Error: ${sendErr.message}`);
                                    ctx.reply('Failed to send notification to the user.', adminKeyboard);
                                });
                        }

                        // Notify the admin about the successful assignment
                        ctx.reply(`✅ Vehicle "${vehicleName}" has been assigned to "${employeeName}" for "${destinationName} at ${currentTime}".`, adminKeyboard);
                    } else {
                        ctx.reply(`Failed to assign the vehicle "${vehicleName}". Please try again.`, adminKeyboard);
                    }

                    // Clear session data
                    ctx.session.vehicleName = null;
                    ctx.session.employeeName = null;
                    ctx.session.userTelegramId = null;
                }
            );
        });
    });

    // New Journey Details feature for Admin
    const handleJourneyDetails = (ctx) => {
        pool.query('SELECT name, telegram_id FROM users', (err, users) => {
            if (err) throw err;
    
            if (users.length === 0) {
                ctx.reply('No users found.');
                return;
            }
    
            // Arrange buttons in two columns
            const userButtons = [];
            for (let i = 0; i < users.length; i += 2) {
                const buttonRow = [
                    Markup.button.callback(users[i].name, `journey_${users[i].telegram_id}`)
                ];
                if (i + 1 < users.length) {
                    buttonRow.push(Markup.button.callback(users[i + 1].name, `journey_${users[i + 1].telegram_id}`));
                }
                userButtons.push(buttonRow);
            }
    
            ctx.reply('Select a user to view their journey details:', Markup.inlineKeyboard(userButtons));
        });
    };
    
    // Handle journey details from both button and command
    adminBot.hears('Journey Details', handleJourneyDetails);
    adminBot.command('journey', handleJourneyDetails);

    // Function to handle the selection of the date
    adminBot.action(/journey_(.+)/, (ctx) => {
    const telegramId = ctx.match[1];

        // First, get the user_id from the telegram_id
        pool.query('SELECT id FROM users WHERE telegram_id = ?', [telegramId], (err, userResults) => {
            if (err) throw err;

            if (userResults.length === 0) {
                ctx.reply('User not found.');
                return;
            }

            const user_id = userResults[0].id;

            // Prompt the admin with inline buttons for date selection
            ctx.reply('Select the date for journey details:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Today', callback_data: `date_${user_id}_0` }],
                        [{ text: 'Yesterday', callback_data: `date_${user_id}_1` }],
                        [{ text: 'Day before Yesterday', callback_data: `date_${user_id}_2` }]
                    ]
                }
            });
        });
    });

    // Function to handle journey details based on selected date
    adminBot.action(/date_(.+)_(\d+)/, (ctx) => {
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
                    ctx.reply('No journeys found for the selected date.', adminKeyboard);
                    return;
                }

                let message = `<b>Journey Details for ${targetDate.toDateString()}:</b>\n\n`;
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
                ctx.replyWithHTML(message, adminKeyboard);
            }
        );
    });

    // Handle unknown commands
    adminBot.on('message', (ctx) => {
        const messageText = ctx.message.text;

        if (messageText.startsWith('/')) {
            // If the command is not /status or /return, treat it as unknown
            if (messageText !== '/status' && messageText !== '/return' && messageText !== '/assign' && messageText !== '/journey') {
                ctx.reply("Unknown command. Please use the available commands.", adminKeyboard);
            }
        } else {
            // For any other text, respond with the start message and admin keyboard
            ctx.reply("Unknown command. Please use the available commands.", adminKeyboard);
        }
    });

    module.exports = adminBot; // Export the admin bot so it can be used in index.js
