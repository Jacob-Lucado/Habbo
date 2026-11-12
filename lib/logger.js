'use strict';

const util = require('util');

// Small console logger with the same debug/info/warn/error calls the rest of
// the code already uses. Debug lines (every packet in and out) stay quiet
// unless you start the server with HABBO_DEBUG=1.
const debugOn = !!process.env.HABBO_DEBUG;

function stamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, stream, args) {
    stream.write('[' + stamp() + '] ' + level + ' ' + util.format.apply(null, args) + '\n');
}

module.exports = {
    debug: function () { if (debugOn) write('debug', process.stdout, arguments); },
    info: function () { write('info ', process.stdout, arguments); },
    warn: function () { write('warn ', process.stderr, arguments); },
    error: function () { write('error', process.stderr, arguments); }
};
