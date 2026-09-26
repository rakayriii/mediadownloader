#!/usr/bin/env node
/**
 * MediaVault download worker. Entry point.
 *
 * Environment is loaded BEFORE any app module (jobs → prisma) is imported,
 * so the shared-secret and DATABASE_URL are always present for the runtime.
 * Run with:  npm run worker
 */
import { loadLocalEnv } from "./env";

loadLocalEnv();

import("./server")
  .then(({ main }) => main())
  .catch((err) => {
    console.error("[worker] failed to start:", err);
    process.exit(1);
  });