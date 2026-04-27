// src/healer/context-bundler.ts
//
// HEA-04: Pre-agent context assembly. Reads the failing test file, resolves
// its first-hop relative imports, captures git blame, validates trace.zip
// presence (HEA-05).
//
// Path-traversal safety (T-3-CTX-01): testFile and resolved imports must stay
// under cwd. We rely on path.resolve + startsWith — symlinks INSIDE the
// workspace are accepted (consumer's responsibility); symlinks pointing OUT
// can still escape but only to read; no write is performed by the bundler.

import { readFile, access } from 'node:fs/promises';
import * as path from 'node:path';
import { getExecOutput } from '@actions/exec';
import type { ContextBundle } from './types.js';

export interface BundleContextArgs {
  testFile: string;
  testTitle: string;
  cwd: string;
  traceAttachmentPath?: string;
  recentErrorMessages?: string[];
}

const RELATIVE_IMPORT_RE =
  /^\s*import\s+[^'"]*['"](\.\.?\/[^'"]+)['"];?/gm;

const TS_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

async function resolveOrNull(absImportPath: string): Promise<string | null> {
  for (const ext of TS_EXTENSIONS) {
    const candidate = absImportPath + ext;
    try {
      await access(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

function assertWithinCwd(target: string, cwd: string): void {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(cwd, target);
  if (!resolvedTarget.startsWith(resolvedCwd + path.sep) && resolvedTarget !== resolvedCwd) {
    throw new Error(`Path '${target}' resolves outside workspace '${cwd}'`);
  }
}

export async function bundleContext(args: BundleContextArgs): Promise<ContextBundle> {
  // 1. Validate testFile path is inside cwd (T-3-CTX-01)
  assertWithinCwd(args.testFile, args.cwd);

  // 2. Read the failing test file source
  const testFilePath = path.resolve(args.cwd, args.testFile);
  const testFileSource = await readFile(testFilePath, 'utf8');

  // 3. Resolve first-hop relative imports (single pass — no recursion)
  const firstHopImports: Record<string, string> = {};
  const matches = [...testFileSource.matchAll(RELATIVE_IMPORT_RE)];
  for (const m of matches) {
    const importSpec = m[1];                      // e.g., './fixtures/user.ts'
    const importDir = path.dirname(testFilePath); // dir of the test file
    const importAbs = path.resolve(importDir, importSpec);
    // Validate the import stays within cwd
    try {
      assertWithinCwd(path.relative(args.cwd, importAbs), args.cwd);
    } catch {
      continue; // skip imports that escape cwd (defense in depth)
    }
    const resolved = await resolveOrNull(importAbs);
    if (resolved === null) continue;
    try {
      const src = await readFile(resolved, 'utf8');
      const relKey = path.relative(args.cwd, resolved);
      firstHopImports[relKey] = src;
    } catch { /* unreadable — skip */ }
  }

  // 4. git blame -p (HEA-04)
  let gitBlame = '';
  try {
    const result = await getExecOutput(
      'git', ['blame', '-p', args.testFile],
      { cwd: args.cwd, ignoreReturnCode: true, silent: true },
    );
    if (result.exitCode === 0) gitBlame = result.stdout;
  } catch { /* not a git repo, or git unavailable — leave empty */ }

  // 5. Trace attachment presence (HEA-05 — null when missing/expired drives the no-trace prompt variant)
  let traceAttachmentPath: string | null = null;
  if (args.traceAttachmentPath) {
    try {
      await access(args.traceAttachmentPath);
      traceAttachmentPath = args.traceAttachmentPath;
    } catch { /* missing/unreadable — leave null */ }
  }

  return {
    testFile: args.testFile,
    testTitle: args.testTitle,
    testFileSource,
    firstHopImports,
    gitBlame,
    traceAttachmentPath,
    recentErrorMessages: args.recentErrorMessages ?? [],
  };
}
