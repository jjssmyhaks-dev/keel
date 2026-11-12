import { generateKeyPairSync } from "node:crypto";

/**
 * Unit tests never touch Postgres. They still import modules that construct a
 * Prisma client at import time and read JWT secrets lazily, so give each test
 * process deterministic, self-contained values before those modules load.
 */
const signing = generateKeyPairSync("ed25519");
const privateDer = signing.privateKey.export({ type: "pkcs8", format: "der" });

process.env.MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SIGNING_PRIVATE_KEY = Buffer.from(privateDer).toString("base64");
process.env.AUTH_COOKIE_SECRET = "unit-test-cookie-secret";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/authab_test";
