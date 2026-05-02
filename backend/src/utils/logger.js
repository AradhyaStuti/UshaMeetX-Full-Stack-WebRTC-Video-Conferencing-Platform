import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(
        errors({ stack: true }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    ),
    defaultMeta: { service: "nexusmeet-api" },
    transports: [
        new winston.transports.Console({
            format: combine(colorize(), logFormat),
        }),
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            format: combine(winston.format.json()),
            maxsize: 5_242_880,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: "logs/combined.log",
            format: combine(winston.format.json()),
            maxsize: 5_242_880,
            maxFiles: 5,
        }),
    ],
});

export default logger;
