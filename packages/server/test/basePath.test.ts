// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Tunnel base-path helpers (CLAUDE.md §12/§15): deriving the mount prefix from the public URL and
 * stripping it from incoming requests so routes stay root-relative on the LAN and behind the tunnel.
 * Pure functions — no DB, so a direct import (no harness) is fine.
 */
import { describe, it, expect } from 'vitest';
import { basePathFrom, stripBasePath } from '../src/http/basePath';

describe('basePathFrom', () => {
  it('extracts the path prefix from the public URL', () => {
    expect(basePathFrom('https://omos.example.org/students')).toBe('/students');
    expect(basePathFrom('https://omos.example.org/students/')).toBe('/students'); // trailing slash trimmed
    expect(basePathFrom('https://omos.example.org/apps/students')).toBe('/apps/students'); // admin-renamed path
  });
  it('is empty for a bare host, an unset URL, or garbage', () => {
    expect(basePathFrom('https://omos.example.org')).toBe('');
    expect(basePathFrom('https://omos.example.org/')).toBe('');
    expect(basePathFrom('')).toBe('');
    expect(basePathFrom('not a url')).toBe('');
  });
});

describe('stripBasePath', () => {
  const B = '/students';
  it('strips the prefix from tunnel requests so routes stay root-relative', () => {
    expect(stripBasePath('/students/trpc', B)).toBe('/trpc');
    expect(stripBasePath('/students/assets/index.js', B)).toBe('/assets/index.js');
    expect(stripBasePath('/students/api/stripe/webhook', B)).toBe('/api/stripe/webhook');
    expect(stripBasePath('/students', B)).toBe('/'); // the bare app root
    expect(stripBasePath('/students?x=1', B)).toBe('/?x=1'); // bare prefix + query
    expect(stripBasePath('/students/family/invite?token=abc', B)).toBe('/family/invite?token=abc');
  });
  it('passes root (LAN) requests through unchanged', () => {
    expect(stripBasePath('/trpc', B)).toBe('/trpc'); // a LAN request has no prefix
    expect(stripBasePath('/', B)).toBe('/');
    // Does not strip a lookalike that only shares the prefix as a substring.
    expect(stripBasePath('/students-hub/x', B)).toBe('/students-hub/x');
  });
  it('is a passthrough when there is no base (standalone)', () => {
    expect(stripBasePath('/trpc', '')).toBe('/trpc');
    expect(stripBasePath('/students/trpc', '')).toBe('/students/trpc');
  });
});
