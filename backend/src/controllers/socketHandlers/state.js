// All the shared maps the socket layer mutates. Lives in its own module so
// chat / sfu / room handlers can import what they need without circular deps.
import logger from "../../utils/logger.js";

// P2P
export const rooms = new Map();            // roomPath → Map<socketId, {username,avatar}>
export const messages = new Map();         // roomPath → Array<{sender,data,socketId,timestamp}>
export const roomLastActivity = new Map(); // roomPath → timestamp

// routing
export const socketRoom = new Map();       // socketId → roomPath

// SFU
export const sfuRooms = new Map();         // roomPath → SfuRoom

// waiting room
export const roomHosts = new Map();        // roomPath → host socketId
export const waitingRoom = new Map();      // roomPath → Map<socketId, {username, avatar}>

// chat rate limiting
const socketMessageTimestamps = new Map();
const MESSAGE_RATE_LIMIT = 10;
const MESSAGE_RATE_WINDOW = 10_000;

export function isRateLimited(socketId) {
    const now = Date.now();
    const timestamps = socketMessageTimestamps.get(socketId) || [];
    const recent = timestamps.filter(t => now - t < MESSAGE_RATE_WINDOW);
    socketMessageTimestamps.set(socketId, recent);
    if (recent.length >= MESSAGE_RATE_LIMIT) return true;
    recent.push(now);
    return false;
}

export function clearRateLimitState(socketId) {
    socketMessageTimestamps.delete(socketId);
}

// Drop rooms that have been idle for more than 24h.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [path, ts] of roomLastActivity) {
        if (ts < cutoff) {
            rooms.delete(path);
            messages.delete(path);
            roomLastActivity.delete(path);
            const sfuRoom = sfuRooms.get(path);
            if (sfuRoom) { sfuRoom.close(); sfuRooms.delete(path); }
            roomHosts.delete(path);
            waitingRoom.delete(path);
            logger.info("Room purged (TTL expired)", { room: path.slice(-20) });
        }
    }
}, 60 * 60 * 1000).unref();
