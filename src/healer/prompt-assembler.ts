// src/healer/prompt-assembler.ts
//
// Pure-ish function: reads template files from src/healer/prompts/ and assembles
// the agent system prompt per CONTEXT D-05/D-06/D-07/D-08.
//
// fs.readFileSync is the only IO. The function is deterministic — same inputs
// produce the same output (snapshot-stable).
//
// Pattern injection: {{FORBIDDEN_PATTERNS}} is rendered as a comma-separated list
// of FORBIDDEN_PATCHED_LINE_PATTERNS[i].name. Single source of truth (D-17).

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_PATCHED_LINE_PATTERNS } from './forbidden-patterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, 'prompts');

export interface AssemblePromptArgs {
  // Phase 04 widen: accepts all four v1 fix classes (FIX-07 cascade from adapter.ts).
  // File-routing pattern is unchanged — ${fixClassHint}-${traceTag}.md still works;
  // new prompt files (assertions-*.md, slow-*.md) are added in Plan 02.
  fixClassHint: 'selectors' | 'waits' | 'assertions' | 'slow';
  traceAttachmentPath: string | null;
  testTitle: string;
  testFile: string;
  baseUrl: string;
}

export function assemblePrompt(args: AssemblePromptArgs): string {
  // 1. Compose the ordered list of template filenames.
  const traceTag = args.traceAttachmentPath !== null ? 'with-trace' : 'no-trace';
  const fixClassFile = `${args.fixClassHint}-${traceTag}.md`;
  const orderedFiles = [
    'role-guardrails.md',
    fixClassFile,
    'output-format.md',
    'termination.md',
  ];

  // 2. Read each template.
  const sections = orderedFiles.map(name =>
    readFileSync(path.join(PROMPTS_DIR, name), 'utf8'),
  );

  // 3. Concatenate with double-newline separators.
  let combined = sections.join('\n\n');

  // 4. Interpolate placeholders (deterministic).
  const forbiddenList = FORBIDDEN_PATCHED_LINE_PATTERNS.map((p: { name: string; re: RegExp }) => p.name).join(', ');
  combined = combined
    .replaceAll('{{TEST_TITLE}}', args.testTitle)
    .replaceAll('{{TEST_FILE}}', args.testFile)
    .replaceAll('{{FORBIDDEN_PATTERNS}}', forbiddenList)
    .replaceAll('{{BASE_URL}}', args.baseUrl);

  return combined;
}
