// Redis-backed mirror of the in-memory room state so multiple server instances
// can share rooms. Every function no-ops when Redis isn't available.
import { getRedis } from "../utils/redis.js";
import logger from "../utils/logger.js";

const KEY_TTL = 86400; // matches the in-memory 24h TTL
const MAX_MESSAGES = 200;
const MESSAGE_RATE_LIMIT = 10;
const MESSAGE_RATE_WINDOW = 10; // seconds

function rk(...parts) {
    return parts.join(":");
}

// participants

export async function addParticipant(path, socketId, { username, avatar }) {
    const redis = getRedis();
    if (!redis) return;
    const key = rk("room", path, "participants");
    await redis.hSet(key, socketId, JSON.stringify({ username, avatar }));
    await redis.expire(key, KEY_TTL);
}

export async function removeParticipant(path, socketId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.hDel(rk("room", path, "participants"), socketId);
}

export async function getParticipants(path) {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.hGetAll(rk("room", path, "participants"));
    if (!raw || Object.keys(raw).length === 0) return null;
    return new Map(Object.entries(raw).map(([sid, json]) => [sid, JSON.parse(json)]));
}

export async function getParticipantCount(path) {
    const redis = getRedis();
    if (!redis) return null;
    return redis.hLen(rk("room", path, "participants"));
}

// host

export async function setHost(path, socketId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(rk("room", path, "host"), socketId, { EX: KEY_TTL });
}

export async function getHost(path) {
    const redis = getRedis();
    if (!redis) return null;
    return redis.get(rk("room", path, "host"));
}

export async function deleteHost(path) {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(rk("room", path, "host"));
}

// waiting room

export async function addToWaitingRoom(path, socketId, { username, avatar }) {
    const redis = getRedis();
    if (!redis) return;
    const key = rk("room", path, "waiting");
    await redis.hSet(key, socketId, JSON.stringify({ username, avatar }));
    await redis.expire(key, KEY_TTL);
}

export async function removeFromWaitingRoom(path, socketId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.hDel(rk("room", path, "waiting"), socketId);
}

export async function getWaitingRoom(path) {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.hGetAll(rk("room", path, "waiting"));
    if (!raw || Object.keys(raw).length === 0) return null;
    return new Map(Object.entries(raw).map(([sid, json]) => [sid, JSON.parse(json)]));
}

export async function clearWaitingRoom(path) {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(rk("room", path, "waiting"));
}

// socket -> room mapping

export async function setSocketRoom(socketId, path) {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(rk("socket", socketId, "room"), path, { EX: KEY_TTL });
}

export async function getSocketRoom(socketId) {
    const redis = getRedis();
    if (!redis) return null;
    return redis.get(rk("socket", socketId, "room"));
}

export async function deleteSocketRoom(socketId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(rk("socket", socketId, "room"));
}

// chat messages

export async function pushMessage(path, msg) {
    const redis = getRedis();
    if (!redis) return;
    const key = rk("room", path, "messages");
    await redis.rPush(key, JSON.stringify(msg));
    await redis.lTrim(key, -MAX_MESSAGES, -1);
    await redis.expire(key, KEY_TTL);
}

export async function getMessages(path) {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.lRange(rk("room", path, "messages"), 0, -1);
    return raw.map(json => JSON.parse(json));
}

// activity tracking

export async function setActivity(path) {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(rk("room", path, "activity"), Date.now().toString(), { EX: KEY_TTL });
}

// rate limiting

export async function isRateLimitedRedis(socketId) {
    const redis = getRedis();
    if (!redis) return null; // fall back to in-memory
    const key = rk("ratelimit", socketId);
    const now = Date.now();
    await redis.zRemRangeByScore(key, "-inf", String(now - MESSAGE_RATE_WINDOW * 1000));
    const count = await redis.zCard(key);
    if (count >= MESSAGE_RATE_LIMIT) return true;
    await redis.zAdd(key, { score: now, value: String(now) });
    await redis.expire(key, MESSAGE_RATE_WINDOW);
    return false;
}

// room cleanup

export async function deleteRoom(path) {
    const redis = getRedis();
    if (!redis) return;
    await Promise.all([
        redis.del(rk("room", path, "participants")),
        redis.del(rk("room", path, "host")),
        redis.del(rk("room", path, "waiting")),
        redis.del(rk("room", path, "messages")),
        redis.del(rk("room", path, "activity")),
    ]);
    logger.info("Redis room keys cleaned", { room: path.slice(-20) });
}

export async function clearRateLimitRedis(socketId) {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(rk("ratelimit", socketId));
}
