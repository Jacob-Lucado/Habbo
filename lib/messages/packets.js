/**
 * Copyright 2016 Jaden M.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const assert = require('assert');

/**
 * Packet list where the key is the header, and the
 * value is the packet event handler function.
 *
 * @type {Array}
 */
const packets = [];

const incoming = require('./incoming/incoming');

/**
 * The only packets a client may send before logging in: the handshake up to
 * and including the SSO ticket. Everything else needs a player.
 */
const preLoginSerials = [
    incoming.versionCheckMessageEvent,
    incoming.initDiffieHandshakeMessageEvent,
    incoming.completeDiffieHandshakeMessageEvent,
    incoming.uniqueIDMessageEvent,
    incoming.ssoTicketMessageEvent
];

/**
 * Get packet handler associated.
 *
 * @param header key for packets
 * @returns {function} packet handler
 * @exports
 */
function getPacketHandler(header) {
    return packets[header];
}

function walk(directory) {
    return fs.readdirSync(directory).reduce((files, name) => {
        const file = path.join(directory, name);
        if (name.indexOf('.') === 0 || name === 'incoming.js' || name === 'incoming_packet.js') {
            return files;
        }
        return files.concat(fs.statSync(file).isDirectory() ? walk(file) : file);
    }, []);
}

/**
 * Called with no argument once at startup to load every handler, then with a
 * header to look one up.
 *
 * @exports
 */
module.exports = (header) => {
    if (header !== undefined) {
        return getPacketHandler(header);
    }

    const incomingDir = path.join(__dirname, 'incoming');
    walk(incomingDir).forEach((file) => {
        const packet = require(file);

        if (packet.serial && packet.handle) {
            assert.equal(typeof packet.serial, 'number', 'Packet serial must be a number!');
            assert.equal(typeof packet.handle, 'function', 'Packet event handler must be a function!');

            packets[packet.serial] = packet.handle;
            logger.debug('Loaded the %s packet event.', packet.handle.name);
        }
    });

    // The game client can't require this file at load time without a cycle,
    // so it gets the list of pre-login packets here instead.
    const GameClient = require('../game/game_client');
    preLoginSerials.forEach(s => GameClient.preLogin.add(s));
};

module.exports.getPacketHandler = getPacketHandler;
