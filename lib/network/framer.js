'use strict';

// TCP hands data over in whatever chunks it likes, so one read can hold two
// packets, or half of one. This sits between the socket and the packet code and
// only releases complete packets, each as [int length][short header][body].
const MAX_PACKET = 1024 * 512;

class Framer {
    constructor() {
        this._pending = Buffer.alloc(0);
    }

    push(chunk) {
        this._pending = this._pending.length ? Buffer.concat([this._pending, chunk]) : chunk;
        const frames = [];

        while (this._pending.length >= 4) {
            const len = this._pending.readInt32BE(0);

            // The length has to at least cover the 2 byte header. It's also capped,
            // so a garbage value can't make us buffer forever waiting for it.
            if (len < 2 || len > MAX_PACKET) {
                throw new RangeError('Bad packet length ' + len);
            }
            if (this._pending.length < 4 + len) {
                break;
            }

            frames.push(this._pending.slice(0, 4 + len));
            this._pending = this._pending.slice(4 + len);
        }

        return frames;
    }
}

module.exports = Framer;
