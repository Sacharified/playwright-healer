// tests/_helpers/bare-repo.ts
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BareRepoContext {
  remoteDir: string;   // bare "remote" repo (simulates GitHub)
  primaryWs1: string;  // first primary workspace clone
  primaryWs2: string;  // second primary workspace clone (for concurrent-write tests)
  remoteUrl: string;   // file:// URL pointing at remoteDir
  cleanup: () => void;
}

/**
 * Creates a bare git "remote" repo + up to two primary workspace clones.
 * Uses file:// URLs so git operations work without network access.
 * Each workspace gets an initial 'main' branch commit so it's non-empty.
 */
export function makeBareRepo(): BareRepoContext {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-remote-'));
  execSync('git init --bare', { cwd: remoteDir });

  const primaryWs1 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-ws1-'));
  const primaryWs2 = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-ws2-'));
  const remoteUrl = `file://${remoteDir}`;

  for (const ws of [primaryWs1, primaryWs2]) {
    execSync(`git init && git remote add origin ${remoteUrl}`, { cwd: ws, shell: '/bin/bash' });
    execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: ws, shell: '/bin/bash' });
    execSync('echo "src" > README.md && git add -A && git commit -m "init"', { cwd: ws, shell: '/bin/bash' });
  }

  const cleanup = () => {
    for (const dir of [remoteDir, primaryWs1, primaryWs2]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };

  return { remoteDir, primaryWs1, primaryWs2, remoteUrl, cleanup };
}
