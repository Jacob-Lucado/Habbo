'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const store = require('../lib/storage/store');
const packets = require('../lib/messages/packets');
const TcpServer = require('../lib/network/tcp_server');
const incoming = require('../lib/messages/incoming/incoming');
const outgoing = require('../lib/messages/outgoing/outgoing');

const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'habbo-test-')), 'hotel.json');
const hotel = store.open(dataFile);
packets();

let server;
test.before(async () => {
    server = await new TcpServer(0, 50, '127.0.0.1').listen();
});
test.after(async () => {
    await server.close();
});

// ---- tiny client helpers ----

function build(header, fn) {
    const parts = [];
    const w = {
        int: v => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); return w; },
        str: s => {
            const d = Buffer.from(s, 'utf8');
            const b = Buffer.alloc(2); b.writeInt16BE(d.length);
            parts.push(b, d);
            return w;
        }
    };
    if (fn) fn(w);
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(6);
    head.writeInt32BE(body.length + 2, 0);
    head.writeInt16BE(header, 4);
    return Buffer.concat([head, body]);
}

function connect() {
    return new Promise(resolve => {
        const socket = net.connect(server.port, '127.0.0.1');
        const c = { socket, raw: Buffer.alloc(0), closed: false };
        socket.on('data', d => { c.raw = Buffer.concat([c.raw, d]); });
        socket.on('close', () => { c.closed = true; });
        socket.on('error', () => {});
        socket.on('connect', () => resolve(c));
    });
}

// Split everything received so far into [{header, body}].
function received(c) {
    const out = [];
    let b = c.raw;
    while (b.length >= 6) {
        const len = b.readInt32BE(0);
        if (b.length < 4 + len) break;
        out.push({ header: b.readInt16BE(4), body: b.slice(6, 4 + len) });
        b = b.slice(4 + len);
    }
    return out;
}

const headers = c => received(c).map(p => p.header);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function login(name) {
    if (!hotel.findUserByName(name)) hotel.createUser(name);
    const c = await connect();
    c.socket.write(build(incoming.versionCheckMessageEvent, w => w.str('PRODUCTION-TEST')));
    c.socket.write(build(incoming.ssoTicketMessageEvent, w => w.str(hotel.issueTicket(name))));
    await wait(120);
    return c;
}

// ---- tests ----

test('answers the Flash policy request and hangs up', async () => {
    const c = await connect();
    c.socket.write('<policy-file-request/>\0');
    await wait(100);
    assert.match(c.raw.toString(), /<cross-domain-policy>/);
    assert.ok(c.closed);
});

test('init crypto handshake gets a reply with encryption switched off', async () => {
    const c = await connect();
    c.socket.write(build(incoming.initDiffieHandshakeMessageEvent));
    await wait(100);
    const p = received(c);
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].header, outgoing.initDiffieHandshakeMessageComposer);
    assert.strictEqual(p[0].body[p[0].body.length - 1], 0, 'server encryption flag should be false');
    c.socket.destroy();
});

test('SSO login sends the full login sequence', async () => {
    const c = await login('Alice');
    const h = headers(c);
    assert.strictEqual(h[0], outgoing.authenticationOKMessageComposer);
    for (const expected of [
        outgoing.availabilityStatusMessageComposer,
        outgoing.navigatorSettingsMessageComposer,
        outgoing.userRightsMessageComposer,
        outgoing.scrSendUserInfoMessageComposer,
        outgoing.favoritesMessageComposer
    ]) {
        assert.ok(h.includes(expected), 'missing packet ' + expected);
    }
    assert.ok(!c.closed);
    c.socket.destroy();
});

test('login ticket works once and then is burned', async () => {
    hotel.createUser('Bob');
    const ticket = hotel.issueTicket('Bob');

    const first = await connect();
    first.socket.write(build(incoming.ssoTicketMessageEvent, w => w.str(ticket)));
    await wait(100);
    assert.strictEqual(headers(first)[0], outgoing.authenticationOKMessageComposer);

    const replay = await connect();
    replay.socket.write(build(incoming.ssoTicketMessageEvent, w => w.str(ticket)));
    await wait(100);
    assert.ok(!headers(replay).includes(outgoing.authenticationOKMessageComposer));
    assert.strictEqual(headers(replay)[0], outgoing.habboBroadcastMessageComposer);
    first.socket.destroy();
    replay.socket.destroy();
});

test('user info comes back with the right name, figure and motto', async () => {
    const c = await login('Carol');
    c.raw = Buffer.alloc(0);
    c.socket.write(build(incoming.infoRetrieveMessageEvent));
    await wait(100);
    const p = received(c);
    assert.strictEqual(p[0].header, outgoing.userObjectComposer);
    const text = p[0].body.toString('utf8');
    assert.ok(text.includes('Carol'));
    assert.ok(text.includes('hr-115-42'));
    assert.ok(!text.includes('Jaden'));
    c.socket.destroy();
});

test('my rooms search lists the player\'s starter room with their name as owner', async () => {
    const c = await login('Dave');
    c.raw = Buffer.alloc(0);
    c.socket.write(build(incoming.myRoomsSearchMessageEvent));
    await wait(100);
    const p = received(c);
    assert.strictEqual(p[0].header, outgoing.guestRoomSearchResultComposer);
    const text = p[0].body.toString('utf8');
    assert.ok(text.includes("Dave's room"));
    c.socket.destroy();
});

test('walking into a room streams the room packets and stays connected', async () => {
    const c = await login('Erin');
    const room = hotel.findRoomsByOwner(hotel.findUserByName('Erin').id)[0];
    c.raw = Buffer.alloc(0);

    c.socket.write(build(incoming.openFlatConnectionMessageEvent, w => w.int(room.id).str('')));
    await wait(100);
    assert.ok(headers(c).includes(outgoing.openConnectionMessageComposer));
    assert.ok(headers(c).includes(outgoing.roomReadyMessageComposer));

    c.raw = Buffer.alloc(0);
    c.socket.write(build(incoming.getRoomEntryDataMessageEvent));
    await wait(150);
    const h = headers(c);
    for (const expected of [
        outgoing.heightMapMessageComposer,
        outgoing.floorHeightMapMessageComposer,
        outgoing.usersMessageComposer,
        outgoing.userUpdateMessageComposer,
        outgoing.roomEntryInfoMessageComposer
    ]) {
        assert.ok(h.includes(expected), 'missing packet ' + expected);
    }
    assert.ok(!c.closed);

    // The owner table in the objects packet should name the player, not a hardcoded user.
    const objects = received(c).find(x => x.header === outgoing.objectsMessageComposer);
    assert.ok(objects.body.toString('utf8').includes('Erin'));
    c.socket.destroy();
});

test('two packets in one chunk, and one packet split across chunks, both work', async () => {
    const c = await login('Finn');
    c.raw = Buffer.alloc(0);

    const a = build(incoming.getCreditsInfoEvent);
    const b = build(incoming.getSoundSettingsEvent);
    c.socket.write(Buffer.concat([a, b]));
    await wait(120);
    const merged = headers(c).length;
    assert.ok(merged >= 2, 'expected replies to both packets, got ' + merged);

    c.raw = Buffer.alloc(0);
    c.socket.write(a.slice(0, 3));
    await wait(40);
    c.socket.write(a.slice(3));
    await wait(120);
    assert.ok(headers(c).length >= 1, 'split packet should still be answered');
    c.socket.destroy();
});

test('game packets are ignored until the player has logged in', async () => {
    const c = await connect();
    c.socket.write(build(incoming.myRoomsSearchMessageEvent));
    c.socket.write(build(incoming.getRoomEntryDataMessageEvent));
    await wait(120);
    assert.strictEqual(received(c).length, 0);
    assert.ok(!c.closed);
    c.socket.destroy();
});

test('logging in twice signs the first session out', async () => {
    const one = await login('Gus');
    assert.ok(!one.closed);
    const two = await login('Gus');
    await wait(80);
    assert.ok(one.closed, 'first session should have been closed');
    assert.ok(!two.closed);
    two.socket.destroy();
});

test('garbage input drops that connection and the server keeps serving', async () => {
    const bad = await connect();
    bad.socket.write(Buffer.from([0x7f, 0xff, 0xff, 0xff, 0, 1, 2, 3]));
    await wait(100);
    assert.ok(bad.closed);

    const junkDH = await connect();
    junkDH.socket.write(build(incoming.completeDiffieHandshakeMessageEvent, w => w.str('not-a-real-key')));
    await wait(100);

    const ok = await login('Hana');
    assert.strictEqual(headers(ok)[0], outgoing.authenticationOKMessageComposer);
    ok.socket.destroy();
    junkDH.socket.destroy();
});

test('non-ASCII names are framed by byte length', async () => {
    hotel.createUser('Zoe', { motto: 'café ☕' });
    const c = await login('Zoe');
    c.raw = Buffer.alloc(0);
    c.socket.write(build(incoming.infoRetrieveMessageEvent));
    await wait(100);
    const p = received(c);
    assert.strictEqual(p[0].header, outgoing.userObjectComposer);
    assert.ok(p[0].body.toString('utf8').includes('café ☕'));
    c.socket.destroy();
});

test('hotel data survives a restart', () => {
    const reopened = new store(dataFile);
    assert.ok(reopened.findUserByName('Alice'));
    assert.ok(reopened.findRoomsByOwner(reopened.findUserByName('Alice').id).length === 1);
});

test('the data file never contains a usable ticket and is owner-only', () => {
    hotel.createUser('Ivy');
    const ticket = hotel.issueTicket('Ivy');
    const onDisk = fs.readFileSync(dataFile, 'utf8');
    assert.ok(!onDisk.includes(ticket), 'raw ticket should not be written to disk');
    if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(dataFile).mode & 0o077, 0, 'file should not be readable by others');
    }
});
