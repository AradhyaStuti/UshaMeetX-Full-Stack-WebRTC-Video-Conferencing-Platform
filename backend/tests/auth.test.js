import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../src/utils/jwt.js";

describe("jwt", () => {
    it("signs a token", () => {
        const token = signToken({ id: "abc123", username: "testuser" });
        assert.equal(typeof token, "string");
        assert.equal(token.split(".").length, 3);
    });

    it("verifies a valid token and returns the payload", () => {
        const token = signToken({ id: "abc123", username: "testuser" });
        const decoded = verifyToken(token);
        assert.ok(decoded);
        assert.equal(decoded.id, "abc123");
        assert.equal(decoded.username, "testuser");
        assert.ok(decoded.iat);
        assert.ok(decoded.exp);
    });

    it("returns null for a garbage token", () => {
        assert.equal(verifyToken("invalid.token.here"), null);
    });
});
