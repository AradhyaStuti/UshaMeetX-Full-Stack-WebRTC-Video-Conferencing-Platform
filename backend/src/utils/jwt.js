import jwt from "jsonwebtoken";
import logger from "./logger.js";

const JWT_SECRET = process.env.JWT_SECRET || "nexusmeet_dev_secret_change_in_production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        if (err.name === "TokenExpiredError") {
            logger.warn("JWT expired", { token: token.slice(0, 10) + "..." });
        }
        return null;
    }
}
