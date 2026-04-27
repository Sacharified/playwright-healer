import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { waitForReady, AppStartupTimeout } from './app-supervisor.js';

let server: http.Server | null = null;

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
});

function startServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      if (typeof addr === 'object' && addr !== null) {
        resolve(`http://127.0.0.1:${addr.port}`);
      }
    });
  });
}

describe('waitForReady — HEA-02 / D-15', () => {
  it('resolves when server returns 200', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await expect(waitForReady(url, 5000)).resolves.toBeUndefined();
  });

  it('resolves when server returns 302 (redirect: manual treats as up)', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(302, { Location: '/login' });
      res.end();
    });
    await expect(waitForReady(url, 5000)).resolves.toBeUndefined();
  });

  it('resolves when server returns 401', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    await expect(waitForReady(url, 5000)).resolves.toBeUndefined();
  });

  it('throws AppStartupTimeout when server returns 500 forever', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await expect(waitForReady(url, 3000)).rejects.toThrow(AppStartupTimeout);
  }, 10000);

  it('resolves after server transitions from 503 to 200', async () => {
    let count = 0;
    const url = await startServer((_req, res) => {
      count += 1;
      if (count <= 2) {
        res.writeHead(503);
      } else {
        res.writeHead(200);
      }
      res.end();
    });
    await expect(waitForReady(url, 8000)).resolves.toBeUndefined();
    expect(count).toBeGreaterThanOrEqual(3);
  }, 12000);

  it('throws AppStartupTimeout when nothing is listening (ECONNREFUSED)', async () => {
    // Use port 65535 which we don't bind — connection refuses immediately.
    await expect(
      waitForReady('http://127.0.0.1:65535', 2500),
    ).rejects.toThrow(AppStartupTimeout);
  }, 8000);

  it('AppStartupTimeout extends Error', async () => {
    try {
      await waitForReady('http://127.0.0.1:65535', 100);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(AppStartupTimeout);
      expect((e as Error).name).toBe('AppStartupTimeout');
    }
  }, 5000);
});

describe('PID_FILE_PATH constant — D-12 contract with action.yml', () => {
  it('is the exact string action.yml will cat', async () => {
    const { PID_FILE_PATH } = await import('./app-supervisor.js');
    expect(PID_FILE_PATH).toBe('/tmp/playwright-healer-app-pid');
  });
});
