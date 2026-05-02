import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { connectToSocket } from "./controllers/socketManager.js";
import userRoutes from "./routes/users.routes.js";
import logger from "./utils/logger.js";
import { initWorkers, isSfuAvailable } from "./sfu/worker.js";
import { initRedis, shutdownRedis, isRedisConnected } from "./utils/redis.js";

export const app = express();
export const server = createServer(app);

app.use(helmet({
    // Only turn HSTS on in production where we're actually behind HTTPS.
    hsts: process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    // We're a JSON API, so the HTML-oriented bits of helmet just get in the way.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
}));

app.use(compression());

// Render terminates TLS at its proxy, so trust the first hop for rate limiting.
app.set("trust proxy", 1);

// CORS — allow any origin so meeting links work from anywhere.
const corsOptions = {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

// Correlation ID — reuse incoming x-request-id if the client sent one.
app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
});

app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        requestId: req.id,
        ip: req.ip,
        userAgent: req.get("user-agent")?.slice(0, 80),
    });
    next();
});

export const createAuthLimiter = ({ max = 30, windowMs = 15 * 60 * 1000 } = {}) => rateLimit({
    windowMs,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests, please try again later." },
});
const authLimiter = createAuthLimiter();

app.use("/api/v1/users/login", authLimiter);
app.use("/api/v1/users/register", authLimiter);
app.use("/api/v1/users", userRoutes);

// Frontend fetches this before joining a call so it knows which servers to
// use for ICE. Cached for 5 minutes since the values barely ever change.
app.get("/api/v1/ice-config", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
    ];

    // TURN_URL accepts a single URL or a comma-separated list.
    if (process.env.TURN_URL) {
        const turnUrls = process.env.TURN_URL.split(",").map(u => u.trim()).filter(Boolean);
        iceServers.push({
            urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
            username: process.env.TURN_USERNAME || "",
            credential: process.env.TURN_CREDENTIAL || "",
        });

        // Optional second TURN endpoint, e.g. a TCP-only fallback.
        if (process.env.TURN_URL_2) {
            const turnUrls2 = process.env.TURN_URL_2.split(",").map(u => u.trim()).filter(Boolean);
            iceServers.push({
                urls: turnUrls2.length === 1 ? turnUrls2[0] : turnUrls2,
                username: process.env.TURN_USERNAME_2 || process.env.TURN_USERNAME || "",
                credential: process.env.TURN_CREDENTIAL_2 || process.env.TURN_CREDENTIAL || "",
            });
        }

        logger.debug("TURN server(s) included in ICE config", { count: iceServers.length - 4 });
    }

    res.json({ iceServers });
});

// Frontend hits this on join to decide between P2P and SFU mode.
app.get("/api/v1/sfu-status", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ enabled: isSfuAvailable() });
});

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        redis: isRedisConnected() ? "connected" : "disconnected",
        sfu: isSfuAvailable(),
        version: "2.0.0",
    });
});

// Tiny built-in metrics — keeps us off prom-client for a project this small.
const requestCounts = { total: 0, errors: 0 };
app.use((_req, res, next) => {
    requestCounts.total++;
    res.on("finish", () => { if (res.statusCode >= 500) requestCounts.errors++; });
    next();
});
app.get("/api/v1/metrics", (_req, res) => {
    res.json({
        uptime_seconds: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        requests_total: requestCounts.total,
        requests_errors: requestCounts.errors,
        mongo_state: mongoose.connection.readyState,
        redis_connected: isRedisConnected(),
        sfu_available: isSfuAvailable(),
    });
});

// Socket.IO is wired up inside start() so we can await the Redis adapter.

// Serve the built frontend in production.
import path from "node:path";
import fs from "node:fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The build directory shows up in different spots depending on how the server
// is launched (Docker, Render, local), so probe a few likely candidates.
const possiblePaths = [
    path.join(__dirname, "../../frontend/build"),
    path.join(process.cwd(), "frontend/build"),
    path.join(process.cwd(), "../frontend/build"),
    path.join(process.cwd(), "build"),
];

let frontendBuild = null;
for (const p of possiblePaths) {
    if (fs.existsSync(path.join(p, "index.html"))) {
        frontendBuild = p;
        break;
    }
}

if (frontendBuild) {
    logger.info(`Serving frontend from ${frontendBuild}`);
    app.use(express.static(frontendBuild));
    app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api/") || req.path === "/health") return next();
        res.sendFile(path.join(frontendBuild, "index.html"));
    });
} else {
    logger.warn("Frontend build not found, tried: " + possiblePaths.join(", "));
}

app.use((err, req, res, _next) => {
    const status = err.status || 500;
    logger.error("Unhandled error", { requestId: req.id, error: err.message, stack: err.stack, status });
    res.status(status).json({
        error: {
            code: err.code || "INTERNAL_ERROR",
            message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
            requestId: req.id,
        },
    });
});

const PORT = process.env.PORT || 8000;

const start = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        logger.info(`MongoDB connected: ${conn.connection.host}`);
    } catch (err) {
        logger.error("MongoDB connection failed", { error: err.message });
        process.exit(1);
    }

    // Order matters: Redis must be up before connectToSocket() reads getRedis().
    await initRedis();
    await connectToSocket(server);
    await initWorkers();

    server.listen(PORT, () => {
        logger.info(`Server listening on port ${PORT}`, { sfu: isSfuAvailable(), redis: isRedisConnected() });
    });
};

const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
        await shutdownRedis();
        await mongoose.connection.close(false);
        logger.info("All connections closed");
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: reason?.message || reason });
});

// Skip start() when this file is imported by the test harness.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    start();
}
