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

const assert = require('assert');
const logger = require('../logger');
const config = require('../config');
const store = require('../storage/store');
const packets = require('../messages/packets');
const IncomingPacket = require('../messages/incoming/incoming_packet');
const OutgoingPacket = require('../messages/outgoing/outgoing_packet');
const rc4 = require('../encryption/rc4');
const Player = require('./players/player');
const AuthenticationOKComposer = require('../messages/outgoing/handshake/authentication_ok');
const AvailabilityStatusComposer = require('../messages/outgoing/availability/availability_status');
const NavigatorSettingsComposer = require('../messages/outgoing/navigator/navigator_settings');
const UserRightsComposer = require('../messages/outgoing/handshake/user_rights');
const AvatarEffectsComposer = require('../messages/outgoing/inventory/avatareffect/avatar_effects');
const GetMinimailMessageCountComposer = require('../messages/outgoing/users/get_minimail_message_count');
const ScrSendUserInfoComposer = require('../messages/outgoing/users/scr_send_user_info');
const FriendListUpdateComposer = require('../messages/outgoing/messenger/friend_list_update');
const FavoritesComposer = require('../messages/outgoing/navigator/favorites');
const HabboBroadcastComposer = require('../messages/outgoing/notifications/habbo_broadcast');

/**
 * Players currently in the hotel, by user id. Used to make sure an account
 * can only be logged in from one place at a time.
 */
const online = new Map();

class GameClient {
    constructor(socket) {
        this._socket = socket;
        this._closed = false;
    }

    get rc4() {
        return this._rc4;
    }

    get player() {
        return this._player;
    }

    static get online() {
        return online;
    }

    /**
     * Finalize a packet buffer then send the raw contents to the socket.
     *
     * @param {OutgoingPacket} packet constructed packet object
     */
    sendPacket(packet) {
        assert(packet instanceof OutgoingPacket);
        logger.debug('Outgoing packet: %d', packet.header);
        this.sendData(packet.wrap());
        return this;
    }

    /**
     * Send raw buffer data to the player socket.
     *
     * @param {Buffer} data buffer to be sent
     */
    sendData(data) {
        assert(data instanceof Buffer);
        if (!this._closed) {
            this._socket.write(data);
        }
    }

    /**
     * Hang up on the client. Anything already queued (like a popup explaining
     * why) still gets flushed first.
     */
    disconnect() {
        if (!this._closed) {
            this._closed = true;
            this._socket.end();
        }
    }

    /**
     * Enable and bind the RC4 engine to session using a shared key.
     *
     * @param {String|Buffer|Array} sharedKey key used for initializing rc4
     */
    enableRC4(sharedKey) {
        this._rc4 = new rc4.Engine();
        this._rc4.init(sharedKey);
    }

    /**
     * Look up the player by their SSO ticket and, if it checks out, log them in.
     *
     * @param {String} ssoTicket authentication ticket used for finding the user
     * @returns {Promise} resolves when the player is in, rejects with a message
     *                    that is safe to show them otherwise.
     */
    tryLogin(ssoTicket) {
        return new Promise((resolve, reject) => {
            const user = store.get().consumeTicket(ssoTicket);
            if (!user) {
                return reject('No player found with your session ticket');
            }

            // Someone already signed in as this account gets kicked off.
            const existing = online.get(user.id);
            if (existing && existing !== this) {
                existing.sendPacket(new HabboBroadcastComposer('You were signed out because this account logged in somewhere else.'));
                existing.disconnect();
            }

            this._player = new Player(this, user);
            online.set(user.id, this);

            this.sendPacket(new AuthenticationOKComposer())
                .sendPacket(new AvailabilityStatusComposer())
                .sendPacket(new NavigatorSettingsComposer(0))
                .sendPacket(new UserRightsComposer(true, true, false))
                .sendPacket(new AvatarEffectsComposer(null))
                .sendPacket(new GetMinimailMessageCountComposer());

            this.sendPacket(new ScrSendUserInfoComposer());
            this.sendPacket(new FriendListUpdateComposer());
            this.sendPacket(new FavoritesComposer(null));

            if (config.welcomeMessage) {
                this.sendPacket(new HabboBroadcastComposer(config.welcomeMessage));
            }

            logger.info('%s logged in', user.username);
            resolve();
        });
    }

    /**
     * Called by the socket when the connection closes, however it closed.
     */
    onClose() {
        this._closed = true;
        if (this._player && online.get(this._player.id) === this) {
            online.delete(this._player.id);
            logger.info('%s left', this._player.username);
        }
    }

    /**
     * Handles one complete incoming packet. The TCP layer has already split
     * the stream so each call gets exactly one packet (or the policy request).
     *
     * @param {ByteBuf} buffer boilerplate over the network buffer
     */
    async handlePacket(buffer) {
        const delimiter = String.fromCharCode(buffer.readByte());
        await buffer.resetIndex();

        if (delimiter === '<') {
            // Flash asks for this before it will open a real connection.
            this._socket.write('<?xml version="1.0"?>\r\n' +
                '<!DOCTYPE cross-domain-policy SYSTEM "/xml/dtds/cross-domain-policy.dtd">\r\n' +
                '<cross-domain-policy>\r\n' +
                '<allow-access-from domain="*" to-ports="1-65535" />\r\n' +
                '</cross-domain-policy>\0');
            this._socket.end();
            return;
        }

        const length = buffer.readInt();
        const header = buffer.readShort();
        const packet = new IncomingPacket(header, length, buffer);
        if (packet.isCorrupt()) {
            logger.debug('Corrupted packet: %d', packet.header);
            return;
        }

        const handler = packets(packet.header);
        if (handler === undefined) {
            logger.debug('Unhandled packet: %d', packet.header);
            return;
        }

        // Everything past the login handshake needs a logged-in player.
        if (!this._player && !GameClient.preLogin.has(packet.header)) {
            logger.debug('Ignoring packet %d before login', packet.header);
            return;
        }

        logger.debug('Incoming packet: %d %s', packet.header, handler.name);
        try {
            await handler(this, packet);
        } catch (err) {
            logger.error('Error in %s: %s', handler.name, err.stack);
        }
    }
}

/**
 * Packets a client may send before it has logged in: the handshake.
 * Filled in by messages/packets.js once the handlers are loaded.
 */
GameClient.preLogin = new Set();

module.exports = GameClient;
