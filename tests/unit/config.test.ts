import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Mock @actions/core to avoid GitHub Actions runtime dependency
vi.mock('@actions/core', () => ({
  default: { warning: vi.fn(), setFailed: vi.fn(), info: vi.fn() },
  warning: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
}));

import { getInputSchema, loadYamlConfig, mergeConfigs } from '../../src/shared/config.js';

// ────────────────────────────────────────────────────────────────────────────
// getInputSchema — CFG-03 threshold fields
// ────────────────────────────────────────────────────────────────────────────

describe('getInputSchema — CFG-03 threshold fields', () => {
  const BASE_REQUIRED = {
    mode: 'ingest',
    healerToken: 'tok',
    githubToken: 'ghp',
    provider: 'ollama', // ollama skips apiKey requirement
  };

  it('defaults: flakeRateThreshold = 0.2', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flakeRateThreshold).toBe(0.2);
    }
  });

  it('defaults: flakeWindowDays = 7', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flakeWindowDays).toBe(7);
    }
  });

  it('defaults: slowRegressionPct = 1.5', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slowRegressionPct).toBe(1.5);
    }
  });

  it('defaults: retentionDays = 90', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retentionDays).toBe(90);
    }
  });

  it('defaults: stateBranchName = playwright-healer-state', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateBranchName).toBe('playwright-healer-state');
    }
  });

  it('coerces flake_rate_threshold string "0.2" to number 0.2', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      flakeRateThreshold: '0.2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flakeRateThreshold).toBe(0.2);
    }
  });

  it('fails with named field error for flake_rate_threshold: "banana"', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      flakeRateThreshold: 'banana',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldNames = result.error.issues.map((i) => i.path.join('.'));
      const messages = result.error.issues.map((i) => i.message);
      // The error must mention the field by name (either camelCase path or snake_case input name)
      const mentionsField =
        fieldNames.some((n) => n.includes('flakeRateThreshold') || n.includes('flake_rate_threshold')) ||
        messages.some((m) => m.includes('flake_rate_threshold') || m.includes('flakeRateThreshold'));
      expect(mentionsField).toBe(true);
    }
  });

  it('fails when flake_rate_threshold "1.5" is out of 0–1 range', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      flakeRateThreshold: '1.5',
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// loadYamlConfig
// ────────────────────────────────────────────────────────────────────────────

describe('loadYamlConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns {} when workspace has no .github/playwright-healer.yml', () => {
    const result = loadYamlConfig(tmpDir);
    expect(result).toEqual({});
  });

  it('returns {} and does not throw on nonexistent workspace path', () => {
    expect(() => loadYamlConfig('/path/that/does/not/exist/anywhere')).not.toThrow();
    const result = loadYamlConfig('/path/that/does/not/exist/anywhere');
    expect(result).toEqual({});
  });

  it('parses a valid YAML file and returns the parsed object', () => {
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(
      path.join(githubDir, 'playwright-healer.yml'),
      'flake-window-days: 14\n',
      'utf8'
    );
    const result = loadYamlConfig(tmpDir);
    expect(result).toEqual({ 'flake-window-days': 14 });
  });

  it('returns {} (not throw) for malformed YAML', () => {
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(
      path.join(githubDir, 'playwright-healer.yml'),
      'key: [unclosed bracket\n',
      'utf8'
    );
    expect(() => loadYamlConfig(tmpDir)).not.toThrow();
    const result = loadYamlConfig(tmpDir);
    expect(result).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getInputSchema — CFG-04 fix-class toggles + startupTimeoutSeconds
// ────────────────────────────────────────────────────────────────────────────

describe('getInputSchema — CFG-04 toggles + startupTimeoutSeconds', () => {
  const BASE_REQUIRED = {
    mode: 'heal',
    healerToken: 'tok',
    githubToken: 'ghp',
    provider: 'ollama', // ollama skips apiKey requirement
  };

  it('defaults: all four toggles = true when inputs are empty string', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableSelectorFixes).toBe(true);
      expect(result.data.enableWaitFixes).toBe(true);
      expect(result.data.enableAssertionFixes).toBe(true);
      expect(result.data.enableSlowFixes).toBe(true);
    }
  });

  it('defaults: startupTimeoutSeconds = 120', () => {
    const result = getInputSchema().safeParse(BASE_REQUIRED);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startupTimeoutSeconds).toBe(120);
    }
  });

  it('enableSelectorFixes accepts string "true" -> true', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      enableSelectorFixes: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableSelectorFixes).toBe(true);
    }
  });

  it('enableSelectorFixes accepts string "false" -> false', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      enableSelectorFixes: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableSelectorFixes).toBe(false);
    }
  });

  it('all four toggles parse independently', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      enableSelectorFixes: 'false',
      enableWaitFixes: 'true',
      enableAssertionFixes: 'false',
      enableSlowFixes: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enableSelectorFixes).toBe(false);
      expect(result.data.enableWaitFixes).toBe(true);
      expect(result.data.enableAssertionFixes).toBe(false);
      expect(result.data.enableSlowFixes).toBe(true);
    }
  });

  it('startupTimeoutSeconds accepts string "60" -> 60', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      startupTimeoutSeconds: '60',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startupTimeoutSeconds).toBe(60);
    }
  });

  it('startupTimeoutSeconds defaults to 120 when empty', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      startupTimeoutSeconds: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startupTimeoutSeconds).toBe(120);
    }
  });

  it('startupTimeoutSeconds: "banana" produces a Zod error with path startupTimeoutSeconds', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      startupTimeoutSeconds: 'banana',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldNames = result.error.issues.map((i) => i.path.join('.'));
      expect(fieldNames.some((n) => n.includes('startupTimeoutSeconds'))).toBe(true);
    }
  });

  it('startupTimeoutSeconds: "0" produces a Zod error (min 1)', () => {
    const result = getInputSchema().safeParse({
      ...BASE_REQUIRED,
      startupTimeoutSeconds: '0',
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// mergeConfigs
// ────────────────────────────────────────────────────────────────────────────

describe('mergeConfigs', () => {
  it('action input wins over YAML value when non-empty', () => {
    const actionInputs = { 'flake-rate-threshold': '0.3' };
    const yamlConfig = { 'flake-rate-threshold': 0.1 };
    const merged = mergeConfigs(actionInputs, yamlConfig);
    expect(merged['flake-rate-threshold']).toBe('0.3');
  });

  it('YAML value wins when action input is empty string', () => {
    const actionInputs = { 'flake-rate-threshold': '' };
    const yamlConfig = { 'flake-rate-threshold': 0.1 };
    const merged = mergeConfigs(actionInputs, yamlConfig);
    expect(merged['flake-rate-threshold']).toBe(0.1);
  });

  it('merges multiple keys from YAML and action inputs correctly', () => {
    const actionInputs = {
      'flake-rate-threshold': '0.3',
      'flake-window-days': '',
    };
    const yamlConfig = {
      'flake-rate-threshold': 0.1,
      'flake-window-days': 14,
    };
    const merged = mergeConfigs(actionInputs, yamlConfig);
    expect(merged['flake-rate-threshold']).toBe('0.3');  // action wins
    expect(merged['flake-window-days']).toBe(14);         // YAML wins (empty string)
  });
});
