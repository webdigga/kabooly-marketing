import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Env as WorkerEnv } from "../src/env";

declare global {
  // vitest.config.ts runs in Node, where import.meta.url always exists, but
  // workers-types' ImportMeta does not declare it.
  interface ImportMeta {
    url: string;
  }

  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
