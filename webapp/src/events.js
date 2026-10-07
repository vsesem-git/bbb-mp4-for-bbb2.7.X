const { EventEmitter } = require('events');

// Simple process-wide bus used to push job/log updates to SSE clients.
class Bus extends EventEmitter {}
const bus = new Bus();
bus.setMaxListeners(0);

module.exports = bus;
