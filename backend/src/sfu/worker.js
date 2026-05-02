import os from "node:os";
import logger from "../utils/logger.js";
import { workerSettings } from "./config.js";

let workers = [];
let nextWorkerIdx = 0;
let mediasoupModule = null;

async function createWorker(index) {
    const workerPromise = mediasoupModule.createWorker(workerSettings);
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("createWorker timed out after 10s")), 10_000));
    const worker = await Promise.race([workerPromise, timeout]);

    worker.on("died", () => {
        logger.error(`mediasoup worker ${worker.pid} died`, { index });
        workers = workers.filter(w => w.pid !== worker.pid);

        // Give the OS a beat before respawning
        setTimeout(async () => {
            try {
                const replacement = await createWorker(index);
                workers.push(replacement);
                logger.info("mediasoup worker replaced", { pid: replacement.pid, index });
            } catch (err) {
                logger.error("Failed to replace dead mediasoup worker", { index, error: err.message });
            }
        }, 2000);
    });

    return worker;
}

// One worker per CPU core, capped at 4. Returns false if mediasoup isn't installed,
// in which case we silently fall back to P2P.
export async function initWorkers() {
    if (process.env.DISABLE_SFU === "true") {
        logger.info("SFU disabled via DISABLE_SFU env var, using P2P mode");
        return false;
    }
    try {
        mediasoupModule = await import("mediasoup");
        const numWorkers = Math.min(os.cpus().length, 4);

        for (let i = 0; i < numWorkers; i++) {
            const worker = await createWorker(i);
            workers.push(worker);
            logger.info(`mediasoup worker created`, { pid: worker.pid, index: i });
        }

        logger.info(`SFU initialized with ${numWorkers} workers`);
        return true;
    } catch (err) {
        logger.warn(`mediasoup not available, falling back to P2P: ${err.message}`);
        return false;
    }
}

export function getNextWorker() {
    const worker = workers[nextWorkerIdx];
    nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
    return worker;
}

export function isSfuAvailable() {
    return workers.length > 0;
}
