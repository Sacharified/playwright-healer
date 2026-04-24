// src/ingest/index.ts
import type { Config } from '../shared/config.js';

export async function run(_config: Config): Promise<never> {
  throw new Error('ingest mode not implemented until Phase 2');
}
