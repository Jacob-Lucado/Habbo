'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_FIGURE = 'hr-115-42.hd-190-1.ch-215-62.lg-285-91.sh-290-62';

// The whole hotel database in one JSON file, so there's nothing to install or
// run alongside the server. Everything is held in memory and written back out
// after each change. Saves go to a temp file that's renamed over the real one,
// so a crash halfway through a write can't leave a broken file behind.
class Store {
    constructor(file) {
        this._file = file;
        this._data = { nextUserId: 1, nextRoomId: 1, users: {}, rooms: {} };
        this._load();
    }

    _load() {
        fs.mkdirSync(path.dirname(this._file), { recursive: true });
        if (fs.existsSync(this._file)) {
            this._data = JSON.parse(fs.readFileSync(this._file, 'utf8'));
        }
    }

    _save() {
        const tmp = this._file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2));
        fs.renameSync(tmp, this._file);
    }

    // ---- users ----

    findUserById(id) {
        return this._data.users[id] || null;
    }

    findUserByName(name) {
        const wanted = String(name).toLowerCase();
        return Object.values(this._data.users).find(u => u.username.toLowerCase() === wanted) || null;
    }

    createUser(username, extra) {
        if (!/^[A-Za-z0-9_.-]{3,15}$/.test(username)) {
            throw new Error('Names are 3-15 characters: letters, numbers, . _ -');
        }
        if (this.findUserByName(username)) {
            throw new Error('That name is already taken');
        }
        const user = Object.assign({
            id: this._data.nextUserId++,
            username: username,
            motto: '',
            gender: 'M',
            figure: DEFAULT_FIGURE,
            credits: 5000,
            pixels: 0,
            authTicket: null
        }, extra || {});
        this._data.users[user.id] = user;
        this._save();

        // Everyone starts with a room of their own to walk into.
        this.createRoom(user.id, username + "'s room");
        return user;
    }

    // Makes a fresh login ticket for the player. Hand this to the client as its
    // SSO ticket (your website's "enter hotel" page is the natural place).
    issueTicket(username) {
        const user = this.findUserByName(username);
        if (!user) {
            return null;
        }
        user.authTicket = crypto.randomBytes(16).toString('hex');
        this._save();
        return user.authTicket;
    }

    // Finds the player the ticket belongs to and burns the ticket, so a
    // ticket that leaks can't be used a second time.
    consumeTicket(ticket) {
        if (typeof ticket !== 'string' || ticket.length < 8) {
            return null;
        }
        const user = Object.values(this._data.users).find(u => u.authTicket === ticket);
        if (!user) {
            return null;
        }
        user.authTicket = null;
        this._save();
        return user;
    }

    // ---- rooms ----

    createRoom(ownerId, name, extra) {
        const room = Object.assign({
            id: this._data.nextRoomId++,
            ownerId: ownerId,
            name: name,
            description: '',
            categoryId: 0
        }, extra || {});
        this._data.rooms[room.id] = room;
        this._save();
        return room;
    }

    findRoomsByOwner(ownerId) {
        return Object.values(this._data.rooms)
            .filter(r => r.ownerId === ownerId)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}

let shared = null;

module.exports = Store;

// One store for the whole process. app.js opens it; everything else asks for it.
module.exports.open = function (file) {
    shared = new Store(file);
    return shared;
};

module.exports.get = function () {
    if (!shared) {
        throw new Error('Store has not been opened yet');
    }
    return shared;
};
