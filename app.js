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

const config = require('./lib/config');
const logger = require('./lib/logger');
const store = require('./lib/storage/store');
const packets = require('./lib/messages/packets');
const TcpServer = require('./lib/network/tcp_server');

// Open the hotel data first. Loading the packet handlers needs the store to exist.
store.open(config.dataFile);
logger.info('Hotel data: %s', config.dataFile);

packets();

new TcpServer(config.port, config.maxConnections, config.host).listen().catch(err => {
    logger.error('Could not start: %s', err.message);
    process.exit(1);
});
