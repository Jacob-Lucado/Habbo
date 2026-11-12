'use strict';

const path = require('path');

// All the knobs live here. Every one can be overridden with an environment
// variable, so deploying never means editing code.
module.exports = {
    host: process.env.HABBO_HOST || '0.0.0.0',
    port: parseInt(process.env.HABBO_PORT || '3001', 10),
    maxConnections: parseInt(process.env.HABBO_MAX_CONNECTIONS || '1000', 10),
    dataFile: process.env.HABBO_DATA || path.join(__dirname, '..', 'data', 'hotel.json'),
    // Shown to a player as a popup right after they log in. Leave empty for none.
    welcomeMessage: process.env.HABBO_WELCOME || ''
};
