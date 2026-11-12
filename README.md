# Habbo

A Habbo hotel server for the Flash client, written in Node.js. It runs on its own: there is no database to install, and the only npm dependency is `jsbn`.

Everything (accounts, rooms, login tickets) lives in one JSON file, `data/hotel.json`, which is created the first time you run it. Back that file up and you've backed up the hotel.

## Run it

You need Node 18 or newer.

    npm install
    node tools/user.js create YourName
    npm start

The server listens on port 3001. Set `HABBO_DEBUG=1` to see every packet in and out.

## Settings

All optional, all environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `HABBO_PORT` | 3001 | Game port |
| `HABBO_HOST` | 0.0.0.0 | Address to bind |
| `HABBO_MAX_CONNECTIONS` | 1000 | Connection cap |
| `HABBO_DATA` | `data/hotel.json` | Where the hotel data is stored |
| `HABBO_WELCOME` | (none) | Popup shown to players when they log in |
| `HABBO_DEBUG` | off | Log every packet |

## Logging players in

The client logs in with an SSO ticket. Each ticket works once and is then gone.

    node tools/user.js ticket YourName

Put that ticket in the `sso.ticket` flash var when your page loads the client. Your site's "enter hotel" button should do the same thing programmatically: get the store with `require('./lib/storage/store')`, call `issueTicket(name)`, and write the result into the page. Other commands: `node tools/user.js list`.

## Tests

    npm test

Spins up the real server on a random port and drives it with a plain socket client: policy file, handshake, login, user info, navigator, entering a room, split and merged packets, replayed tickets, double logins, and garbage input.

## What works and what doesn't yet

Works: policy file, handshake, SSO login, user info, credits, navigator "my rooms", opening and entering a room.

Not done: walking, chat, furniture, catalog, inventory, messenger, and room data from the store (every room currently loads the built-in `model_a` layout). See `TODO`.

The packet ids in `lib/messages/incoming/incoming.js` and `outgoing/outgoing.js` belong to one specific client build. If your client is a different release, those two files are where the numbers need to change.

Encryption is off: the server tells the client so during the handshake, so the RC4 code isn't used on the wire.

## License

Apache 2.0. Based on the Node.js emulator by Jaden Mitchell, see `NOTICE`.
