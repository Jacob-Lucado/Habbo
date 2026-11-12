'use strict';

// Account tool, since there's no database console to poke at.
//   node tools/user.js create <name>      make a player (and their first room)
//   node tools/user.js ticket <name>      print a fresh single-use login ticket
//   node tools/user.js list               show everyone
const config = require('../lib/config');
const store = require('../lib/storage/store');

const hotel = store.open(config.dataFile);
const [cmd, name] = process.argv.slice(2);

try {
    if (cmd === 'create' && name) {
        const user = hotel.createUser(name);
        console.log('Created ' + user.username + ' (id ' + user.id + ')');
    } else if (cmd === 'ticket' && name) {
        const ticket = hotel.issueTicket(name);
        if (!ticket) {
            throw new Error('No player called ' + name);
        }
        console.log(ticket);
    } else if (cmd === 'list') {
        Object.values(hotel._data.users).forEach(u => console.log(u.id + '\t' + u.username));
    } else {
        console.log('Usage:\n  node tools/user.js create <name>\n  node tools/user.js ticket <name>\n  node tools/user.js list');
        process.exitCode = 1;
    }
} catch (err) {
    console.error(err.message);
    process.exitCode = 1;
}
