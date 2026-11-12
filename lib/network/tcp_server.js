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

const net = require('net');
const logger = require('../logger');
const ByteBuf = require('./bytebuf');
const Framer = require('./framer');
const GameClient = require('../game/game_client');

/**
 * A non-blocking keep-alive TCP server socket.
 *
 * @param port the port we'll be listening on (0 picks any free one)
 * @param maxConnections maximum amount of connections to the server
 * @param host address to bind to
 * @constructor
 */
function tcpServer(port, maxConnections, host) {
    this._port = port;
    this._maxConnections = maxConnections;
    this._host = host || '0.0.0.0';
    this._clients = new Set();
}

Object.defineProperty(tcpServer.prototype, 'port', {
    get: function () { return this._port; }
});

/**
 * Create socket and begin listening for new connections.
 *
 * @this {TcpServer}
 * @returns {Promise} resolves once the server is accepting connections
 */
tcpServer.prototype.listen = function () {
    return new Promise((resolve, reject) => {
        this._tcpServerSocket = net.createServer(socket => {
            const session = new GameClient(socket);
            const framer = new Framer();
            let first = true;

            socket.session = session;
            socket.setKeepAlive(true);
            socket.setNoDelay(true);
            this._clients.add(socket);

            // A client that vanishes mid-write raises ECONNRESET. Without a handler
            // here that would take the whole server down with it.
            socket.on('error', err => logger.debug('Socket error: %s', err.message));

            socket.on('close', () => {
                this._clients.delete(socket);
                session.onClose();
            });

            socket.on('data', data => {
                // The very first bytes may be Flash asking for the cross-domain
                // policy file, which isn't a normal framed packet.
                if (first) {
                    first = false;
                    if (data[0] === 60) {
                        session.handlePacket(new ByteBuf(Buffer.from(data)));
                        return;
                    }
                }

                let frames;
                try {
                    frames = framer.push(Buffer.from(data));
                } catch (err) {
                    logger.debug('Dropping connection: %s', err.message);
                    socket.destroy();
                    return;
                }

                frames.forEach(frame => session.handlePacket(new ByteBuf(frame)));
            });
        });

        this._tcpServerSocket.maxConnections = this._maxConnections;
        this._tcpServerSocket.once('error', reject);

        this._tcpServerSocket.listen({
            port: this._port,
            host: this._host,
            backlog: 511,
            exclusive: false
        }, () => {
            this._port = this._tcpServerSocket.address().port;
            logger.info('Listening for game connections on port %d', this._port);
            resolve(this);
        });
    });
};

/**
 * Stop accepting connections and close the ones that are open.
 *
 * @returns {Promise}
 */
tcpServer.prototype.close = function () {
    return new Promise(resolve => {
        this._clients.forEach(socket => socket.destroy());
        this._tcpServerSocket.close(() => resolve());
    });
};

module.exports = tcpServer;
