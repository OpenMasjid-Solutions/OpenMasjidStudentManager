// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Access-origin policy (CLAUDE.md §5, §12.4 — a security invariant, DO NOT REGRESS).
 *
 *   admin    → LAN only (login refused AND existing sessions 403'd over the tunnel)
 *   finance / parent → LAN + tunnel
 *
 * Classification — FAIL-CLOSED, and a documented, hardened evolution of §12.4 (see
 * docs/DATA_MODEL.md for the full reconciliation). §12.4's literal signal
 * (`cf-ray` OR `x-forwarded-proto: https`) is unusable for this `https: true` app —
 * the OS LAN TLS proxy (app-proxy.ts) also sets `x-forwarded-proto: https` — and, worse,
 * "absence of `cf-ray`" is NOT proof of a trusted LAN: a request that reaches our port
 * directly from the internet (an unfirewalled VPS / port-forward) also lacks `cf-ray`.
 * So we grant `lan` only on a POSITIVE signal — the REAL client IP is private/loopback:
 *
 *   tunnel  if `cf-ray` is present (genuine Cloudflare tunnel), OR the effective client
 *           IP is public (reached us from the internet without Cloudflare).
 *   lan     only when the effective client IP is private/loopback/link-local.
 *
 * The effective client IP trusts `cf-connecting-ip`/`x-forwarded-for` ONLY when the TCP
 * peer is itself local (i.e. an OS proxy on this host, or loopback) — otherwise a direct
 * client could spoof those headers. Both OS proxies strip client-supplied forwarding
 * headers and set trusted values, so behind them XFF is trustworthy. Safe failure
 * direction holds: spoofing only ever DOWNGRADES to `tunnel` (removes admin), never up.
 */
import type { FastifyRequest } from 'fastify';
import type { Role } from '../db/schema';

export type Origin = 'lan' | 'tunnel';
type Headers = FastifyRequest['headers'];

/** RFC1918 / loopback / link-local / IPv6 ULA — i.e. "on the local network". */
export function isPrivateIp(ip: string | undefined): boolean {
  if (!ip) return false;
  let s = ip.trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7); // IPv4-mapped IPv6
  if (s === '::1') return true; // IPv6 loopback
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // IPv6 ULA fc00::/7
  if (s.startsWith('fe80:')) return true; // IPv6 link-local
  if (s.startsWith('127.')) return true; // IPv4 loopback
  if (s.startsWith('10.')) return true;
  if (s.startsWith('192.168.')) return true;
  if (s.startsWith('169.254.')) return true; // IPv4 link-local
  const m = s.match(/^172\.(\d{1,3})\./);
  if (m) {
    const o = Number(m[1]);
    if (o >= 16 && o <= 31) return true;
  }
  return false;
}

function leftmostForwarded(h: Headers): string | undefined {
  const xff = h['x-forwarded-for'];
  const v = Array.isArray(xff) ? xff[0] : xff;
  return v ? v.split(',')[0].trim() : undefined;
}

/** The effective real client IP. `cf-connecting-ip` / `x-forwarded-for` are trusted
 *  ONLY when the TCP peer is local (an OS proxy / loopback); a direct client's forged
 *  headers are ignored (we use the unspoofable socket peer for them). */
export function clientIpFrom(h: Headers, peerIp: string | undefined): string {
  if (isPrivateIp(peerIp)) {
    const cf = h['cf-connecting-ip'];
    const cfv = Array.isArray(cf) ? cf[0] : cf;
    if (cfv && cfv.trim()) return cfv.trim();
    const xff = leftmostForwarded(h);
    if (xff) return xff;
  }
  return peerIp ?? '';
}

export function classifyOriginParts(h: Headers, peerIp: string | undefined): Origin {
  if (h['cf-ray']) return 'tunnel'; // genuine Cloudflare tunnel
  return isPrivateIp(clientIpFrom(h, peerIp)) ? 'lan' : 'tunnel';
}

export function classifyOrigin(req: FastifyRequest): Origin {
  return classifyOriginParts(req.headers, req.socket?.remoteAddress);
}

/** Effective client IP for a request — used as the rate-limit key so remote users get
 *  per-client buckets instead of all sharing the OS proxy's IP (which would let one
 *  attacker lock everyone out). */
export function clientIp(req: FastifyRequest): string {
  return clientIpFrom(req.headers, req.socket?.remoteAddress) || 'unknown';
}

/** Is the browser↔edge hop HTTPS? (Cloudflare, or the OS LAN TLS proxy.) Used ONLY for
 *  the cookie Secure flag — never for the LAN/tunnel policy decision. */
export function isHttpsRequest(req: FastifyRequest): boolean {
  if (req.headers['cf-ray']) return true;
  const xfp = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfp) ? xfp[0] : xfp;
  return !!proto && proto.split(',')[0].trim().toLowerCase() === 'https';
}

/** May this role act from this origin? Admin is LAN-only; everyone else is both. */
export function roleAllowedFromOrigin(role: Role, origin: Origin): boolean {
  if (role === 'admin') return origin === 'lan';
  return true;
}
