/**
 * Network Evaluation & Protection Tools — Phase 46
 *
 * Toolsets (each controlled by a per-personality mcpFeatures flag + global allowNetworkTools):
 *   exposeNetworkDevices   — SSH/Telnet automation, show commands, config push, ping, traceroute (46.1)
 *   exposeNetworkDiscovery — CDP/LLDP, topology, ARP/MAC tables, routing, OSPF, BGP, interfaces, VLANs (46.2 + 46.3)
 *   exposeNetworkAudit     — ACL, AAA, port security, STP (46.4)
 *   exposeNetBox           — NetBox CRUD queries and drift reconciliation (46.5)
 *   exposeNvd              — NVD CVE search and lookup (46.6)
 *   exposeNetworkUtils     — Subnet/VLSM/wildcard calculators + PCAP analysis (46.7 + 46.8)
 *
 * Scope enforcement: MCP_ALLOWED_NETWORK_TARGETS (comma-separated CIDR/hostname list).
 * Active tools (SSH, ping, traceroute) check scope before connecting.
 * Wildcard '*' disables scope enforcement for lab/testing environments.
 *
 * Dependencies:
 *   ssh2 (optionalDependency) — SSH client for device automation
 *   tshark (system binary, optional) — PCAP analysis; detected at registration time
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServiceConfig } from '@secureyeoman/shared';
import type { ToolMiddleware } from './index.js';
import {
  wrapToolHandler,
  jsonResponse,
  errorResponse,
  registerDisabledStub,
} from './tool-utils.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SSH_TIMEOUT_MS = 30_000;
const SSH_COMMAND_TIMEOUT_MS = 60_000;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes idle
const MAX_OUTPUT = 2 * 1024 * 1024; // 2MB per command
const TSHARK_TIMEOUT_MS = 60_000;
const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_RESULTS_PER_PAGE = 20;

const DISABLED_MSG =
  'Network tools are disabled. Set MCP_EXPOSE_NETWORK_TOOLS=true and configure ' +
  'MCP_ALLOWED_NETWORK_TARGETS to enable network automation tools.';

// ─── Scope helpers (mirrors security-tools.ts, scoped to network targets) ────

/**
 * Check whether a dotted-decimal IPv4 address falls within a CIDR range.
 * Returns false for any malformed input — fail-closed.
 */
export function isIpInCidrNet(ip: string, cidr: string): boolean {
  const [network, bitsStr] = cidr.split('/');
  if (bitsStr === undefined) return false;
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (!ipv4Re.test(ip) || !network || !ipv4Re.test(network)) return false;
  const toNum = (s: string): number =>
    s.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toNum(ip) & mask) === (toNum(network) & mask);
}

export function matchesScopeNet(target: string, entry: string): boolean {
  if (entry === target) return true;
  if (entry.includes('/')) return isIpInCidrNet(target, entry);
  if (entry.startsWith('.')) return target.endsWith(entry) || target === entry.slice(1);
  return target === entry || target.endsWith(`.${entry}`);
}

class ScopeViolationError extends Error {
  constructor(target: string, allowed: string[]) {
    super(
      `Target "${target}" is outside the declared network scope. ` +
        `Allowed targets: ${allowed.length > 0 ? allowed.join(', ') : '(none configured)'}. ` +
        `Configure MCP_ALLOWED_NETWORK_TARGETS to include this target.`
    );
    this.name = 'ScopeViolationError';
  }
}

function validateNetworkTarget(target: string, config: McpServiceConfig): void {
  const allowed = config.allowedNetworkTargets ?? [];
  if (allowed.length === 0) throw new ScopeViolationError(target, []);
  if (allowed.includes('*')) return;
  const ok = allowed.some((entry) => matchesScopeNet(target, entry));
  if (!ok) throw new ScopeViolationError(target, allowed);
}

// ─── SSH session manager ──────────────────────────────────────────────────────

interface SshSessionEntry {
  client: any; // ssh2 Client — typed as any to handle optional import
  host: string;
  username: string;
  createdAt: number;
  lastUsed: number;
}

const sshSessions = new Map<string, SshSessionEntry>();

function pruneSessions(): void {
  const now = Date.now();
  for (const [id, sess] of sshSessions) {
    if (now - sess.lastUsed > SESSION_TTL_MS) {
      try {
        sess.client.end();
      } catch {
        // ignore
      }
      sshSessions.delete(id);
    }
  }
}

// Prune idle sessions every 2 minutes
const _pruneInterval = setInterval(pruneSessions, 2 * 60 * 1000);
_pruneInterval.unref(); // don't prevent process exit

const MAX_SSH_SESSIONS = 100;

/** Clean up all SSH sessions and stop the prune timer. Call on server shutdown. */
export function shutdownNetworkTools(): void {
  clearInterval(_pruneInterval);
  for (const [id, sess] of sshSessions) {
    try {
      sess.client.end();
    } catch {
      // ignore
    }
    sshSessions.delete(id);
  }
}

async function loadSsh2(): Promise<{ Client: new () => unknown } | null> {
  try {
    const mod = await import('ssh2');
    return mod;
  } catch {
    return null;
  }
}

async function openSshSession(
  config: McpServiceConfig,
  host: string,
  port: number,
  username: string,
  password?: string,
  privateKey?: string
): Promise<string> {
  validateNetworkTarget(host, config);
  const ssh2 = await loadSsh2();
  if (!ssh2) {
    throw new Error(
      'ssh2 package is not installed. Run: npm install ssh2 in the MCP package directory.'
    );
  }

  const { Client } = ssh2 as unknown as {
    Client: new () => {
      on(event: string, handler: (...args: unknown[]) => void): unknown;
      connect(opts: Record<string, unknown>): void;
      end(): void;
      exec(cmd: string, cb: (err: Error | null, stream: unknown) => void): void;
    };
  };

  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`SSH connection to ${host}:${port} timed out after ${SSH_TIMEOUT_MS}ms`));
    }, SSH_TIMEOUT_MS);

    client.on('ready', () => {
      clearTimeout(timer);
      if (sshSessions.size >= MAX_SSH_SESSIONS) {
        client.end();
        reject(
          new Error(
            `SSH session limit reached (${MAX_SSH_SESSIONS}). Close existing sessions first.`
          )
        );
        return;
      }
      const sessionId = randomUUID();
      sshSessions.set(sessionId, {
        client,
        host,
        username,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      });
      resolve(sessionId);
    });

    client.on('error', (err: unknown) => {
      clearTimeout(timer);
      reject(
        new Error(`SSH connection failed: ${err instanceof Error ? err.message : String(err)}`)
      );
    });

    const connectOpts: Record<string, unknown> = {
      host,
      port,
      username,
      readyTimeout: SSH_TIMEOUT_MS,
    };
    if (password) connectOpts.password = password;
    if (privateKey) connectOpts.privateKey = privateKey;

    client.connect(connectOpts);
  });
}

/**
 * Strict allowlist for values interpolated into device CLI commands (targets,
 * VRF/interface/ACL names, prefixes, address families). Permits the characters
 * that appear in IPs, hostnames, CIDRs and interface identifiers, and rejects
 * whitespace and shell/CLI metacharacters — preventing command injection into
 * the remote device shell via `runSshCommand`. Throws on invalid input.
 */
const SAFE_NET_ARG = /^[A-Za-z0-9._:/-]+$/;
function safeNetArg(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    !SAFE_NET_ARG.test(value)
  ) {
    throw new Error(
      `Invalid ${field}: only letters, digits and . _ : / - are allowed (no spaces or shell metacharacters)`
    );
  }
  return value;
}

async function runSshCommand(sessionId: string, command: string): Promise<string> {
  const sess = sshSessions.get(sessionId);
  if (!sess) {
    throw new Error(
      `Session "${sessionId}" not found or expired. Use network_device_connect first.`
    );
  }
  sess.lastUsed = Date.now();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH command timed out after ${SSH_COMMAND_TIMEOUT_MS}ms: ${command}`));
    }, SSH_COMMAND_TIMEOUT_MS);

    sess.client.exec(command, (err: Error | null, stream: any) => {
      if (err) {
        clearTimeout(timer);
        reject(new Error(`SSH exec failed: ${err.message}`));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('close', () => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString('utf8');
        resolve(
          output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n...[truncated]' : output
        );
      });
    });
  });
}

// ─── tshark helpers ───────────────────────────────────────────────────────────

function runTshark(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'tshark',
      args,
      { maxBuffer: MAX_OUTPUT, timeout: TSHARK_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(stderr || err.message));
          return;
        }
        const out = stdout || stderr;
        resolve(out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n...[truncated]' : out);
      }
    );
  });
}

async function checkTshark(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) =>
      execFile('which', ['tshark'], (err) => {
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve();
        }
      })
    );
    return true;
  } catch {
    return false;
  }
}

// ─── NetBox helpers ───────────────────────────────────────────────────────────

async function netboxFetch(
  config: McpServiceConfig,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<unknown> {
  if (!config.netboxUrl || !config.netboxToken) {
    throw new Error(
      'NetBox is not configured. Set NETBOX_URL and NETBOX_TOKEN environment variables.'
    );
  }
  const url = `${config.netboxUrl.replace(/\/$/, '')}/api${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Token ${config.netboxToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NetBox API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ─── NVD helpers ─────────────────────────────────────────────────────────────

async function nvdFetch(
  config: McpServiceConfig,
  params: Record<string, string>
): Promise<unknown> {
  const qs = new URLSearchParams(params);
  qs.set('resultsPerPage', String(NVD_RESULTS_PER_PAGE));
  const url = `${NVD_BASE}?${qs}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.nvdApiKey) headers.apiKey = config.nvdApiKey;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        'NVD rate limit exceeded. Set NVD_API_KEY to raise the limit to 50 requests per 30 seconds.'
      );
    }
    throw new Error(`NVD API error ${res.status}`);
  }
  return res.json();
}

// ─── Subnet calculation helpers ───────────────────────────────────────────────

function ipToNum(ip: string): number {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0) >>> 0;
}

function numToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function prefixLenToMask(bits: number): number {
  return bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
}

export interface SubnetInfo {
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  subnetMask: string;
  wildcardMask: string;
  prefixLength: number;
  hostCount: number;
  cidr: string;
}

export function calculateSubnet(cidr: string): SubnetInfo {
  const [ipPart, bitsStr] = cidr.split('/');
  if (!ipPart || !bitsStr) throw new Error(`Invalid CIDR notation: ${cidr}`);
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32)
    throw new Error(`Invalid prefix length: ${bitsStr}`);
  const ipv4Re = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (!ipv4Re.test(ipPart)) throw new Error(`Invalid IPv4 address: ${ipPart}`);

  const mask = prefixLenToMask(bits);
  const wildcard = ~mask >>> 0;
  const networkNum = (ipToNum(ipPart) & mask) >>> 0;
  const broadcastNum = (networkNum | wildcard) >>> 0;
  const hostCount = bits >= 31 ? Math.pow(2, 32 - bits) : Math.max(0, Math.pow(2, 32 - bits) - 2);

  return {
    network: numToIp(networkNum),
    broadcast: numToIp(broadcastNum),
    firstHost: bits >= 31 ? numToIp(networkNum) : numToIp(networkNum + 1),
    lastHost: bits >= 31 ? numToIp(broadcastNum) : numToIp(broadcastNum - 1),
    subnetMask: numToIp(mask),
    wildcardMask: numToIp(wildcard),
    prefixLength: bits,
    hostCount,
    cidr: `${numToIp(networkNum)}/${bits}`,
  };
}

export interface VlsmAllocation {
  requirement: number;
  allocatedHosts: number;
  cidr: string;
  network: string;
  broadcast: string;
  subnetMask: string;
}

export function calculateVlsm(parentCidr: string, hostRequirements: number[]): VlsmAllocation[] {
  const parent = calculateSubnet(parentCidr);
  const parentNetNum = ipToNum(parent.network);
  const parentBroadNum = ipToNum(parent.broadcast);

  // Sort largest-first for efficient packing
  const sorted = [...hostRequirements].sort((a, b) => b - a);
  const allocations: VlsmAllocation[] = [];
  let currentNum = parentNetNum;

  for (const req of sorted) {
    if (req < 1) throw new Error(`Invalid host requirement: ${req}`);
    // Find smallest prefix that fits req + 2 (network + broadcast)
    let bits = 32;
    while (bits > 0 && Math.pow(2, 32 - bits) < req + 2) bits--;
    if (bits === 0) throw new Error(`Cannot fit ${req} hosts in a /0`);

    const mask = prefixLenToMask(bits);
    const wildcard = ~mask >>> 0;
    const netNum = (currentNum & mask) >>> 0;
    const broadNum = (netNum | wildcard) >>> 0;

    if (broadNum > parentBroadNum) {
      throw new Error(
        `Not enough address space in ${parentCidr} for all requirements. Failed at requirement ${req}.`
      );
    }

    const subnet = calculateSubnet(`${numToIp(netNum)}/${bits}`);
    allocations.push({
      requirement: req,
      allocatedHosts: subnet.hostCount,
      cidr: subnet.cidr,
      network: subnet.network,
      broadcast: subnet.broadcast,
      subnetMask: subnet.subnetMask,
    });

    currentNum = broadNum + 1;
  }

  return allocations;
}

export function subnetMaskToWildcard(input: string): string {
  // Accept dotted-decimal mask or prefix length
  let bits: number;
  if (input.includes('.')) {
    const maskNum = ipToNum(input);
    // Count leading 1-bits
    let b = 0;
    for (let i = 31; i >= 0; i--) {
      if (maskNum & (1 << i)) b++;
      else break;
    }
    bits = b;
  } else {
    bits = parseInt(input, 10);
    if (Number.isNaN(bits) || bits < 0 || bits > 32)
      throw new Error(`Invalid prefix length: ${input}`);
  }
  const wildcard = ~prefixLenToMask(bits) >>> 0;
  return numToIp(wildcard);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// jsonResponse, errorResponse, registerDisabledStub imported from tool-utils.js

const STUB_TOOLS = [
  // Device automation (46.1)
  'network_device_connect',
  'network_show_command',
  'network_config_push',
  'network_health_check',
  'network_ping_test',
  'network_traceroute',
  // Discovery & topology (46.2)
  'network_discovery_cdp',
  'network_discovery_lldp',
  'network_topology_build',
  'network_arp_table',
  'network_mac_table',
  // Routing & switching (46.3)
  'network_routing_table',
  'network_ospf_neighbors',
  'network_ospf_lsdb',
  'network_bgp_peers',
  'network_interface_status',
  'network_vlan_list',
  // Security auditing (46.4)
  'network_acl_audit',
  'network_aaa_status',
  'network_port_security',
  'network_stp_status',
  'network_software_version',
  // NetBox (46.5)
  'netbox_devices_list',
  'netbox_interfaces_list',
  'netbox_ipam_ips',
  'netbox_cables',
  'netbox_reconcile',
  // NVD (46.6)
  'nvd_cve_search',
  'nvd_cve_by_software',
  'nvd_cve_get',
  // Network utils (46.7)
  'subnet_calculator',
  'subnet_vlsm',
  'wildcard_mask_calc',
  // PCAP (46.8)
  'pcap_upload',
  'pcap_protocol_hierarchy',
  'pcap_conversations',
  'pcap_dns_queries',
  'pcap_http_requests',
];

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerNetworkTools(
  server: McpServer,
  config: McpServiceConfig,
  middleware: ToolMiddleware
): Promise<void> {
  if (!config.exposeNetworkTools) {
    for (const name of STUB_TOOLS) {
      registerDisabledStub(server, middleware, name, DISABLED_MSG);
    }
    return;
  }

  const tsharkAvailable = await checkTshark();
  if (!tsharkAvailable) {
    // eslint-disable-next-line no-console
    console.info(
      '[network-tools] tshark: not found — PCAP tools will return an error at call time'
    );
  }

  // ── 46.1 Device Automation ─────────────────────────────────────────────────

  server.registerTool(
    'network_device_connect',
    {
      description:
        'Open an SSH session to a network device. Returns a sessionId for subsequent commands. Enforces MCP_ALLOWED_NETWORK_TARGETS scope.',
      inputSchema: {
        host: z.string().describe('Device hostname or IP address'),
        port: z.number().int().min(1).max(65535).default(22).describe('SSH port (default 22)'),
        username: z.string().describe('SSH username'),
        password: z
          .string()
          .optional()
          .describe('SSH password (use privateKey for key-based auth)'),
        privateKey: z.string().optional().describe('PEM-encoded SSH private key'),
      },
    },
    wrapToolHandler('network_device_connect', middleware, async (args) => {
      const { host, port, username, password, privateKey } = args as {
        host: string;
        port: number;
        username: string;
        password?: string;
        privateKey?: string;
      };
      const sessionId = await openSshSession(
        config,
        host,
        port ?? 22,
        username,
        password,
        privateKey
      );
      return jsonResponse({ sessionId, host, username, connectedAt: new Date().toISOString() });
    })
  );

  server.registerTool(
    'network_show_command',
    {
      description:
        'Execute one or more IOS-XE/NX-OS/IOS-XR/EOS show commands on a connected device.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        commands: z
          .array(z.string().startsWith('show'))
          .min(1)
          .max(10)
          .describe('Show commands to run (must start with "show")'),
      },
    },
    wrapToolHandler('network_show_command', middleware, async (args) => {
      const { sessionId, commands } = args as { sessionId: string; commands: string[] };
      const results: Record<string, string> = {};
      for (const cmd of commands) {
        results[cmd] = await runSshCommand(sessionId, cmd);
      }
      return jsonResponse(results);
    })
  );

  server.registerTool(
    'network_config_push',
    {
      description:
        'Push configuration lines to a device via SSH config mode. Use dryRun:true to validate without committing.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        configLines: z
          .array(z.string())
          .min(1)
          .describe('Configuration lines to push (IOS syntax)'),
        dryRun: z
          .boolean()
          .default(false)
          .describe('If true, enter config mode and run "do show" only; do not commit'),
      },
    },
    wrapToolHandler('network_config_push', middleware, async (args) => {
      const { sessionId, configLines, dryRun } = args as {
        sessionId: string;
        configLines: string[];
        dryRun: boolean;
      };
      const sess = sshSessions.get(sessionId);
      if (!sess) return errorResponse(`Session "${sessionId}" not found or expired.`);

      if (dryRun) {
        const preview = ['configure terminal', ...configLines, 'end'].join('\n');
        return jsonResponse({ dryRun: true, preview, message: 'Dry run — no changes committed.' });
      }

      const output = await runSshCommand(
        sessionId,
        `configure terminal\n${configLines.join('\n')}\nend`
      );
      return jsonResponse({ pushed: configLines.length, output });
    })
  );

  server.registerTool(
    'network_health_check',
    {
      description:
        'Run "show version" and "show interfaces" on a list of targets. Returns structured health summary.',
      inputSchema: {
        targets: z
          .array(
            z.object({
              host: z.string(),
              port: z.number().int().min(1).max(65535).default(22),
              username: z.string(),
              password: z.string().optional(),
            })
          )
          .min(1)
          .max(20)
          .describe('List of devices to health-check (max 20)'),
      },
    },
    wrapToolHandler('network_health_check', middleware, async (args) => {
      const { targets } = args as {
        targets: { host: string; port: number; username: string; password?: string }[];
      };
      const results = await Promise.allSettled(
        targets.map(async (t) => {
          validateNetworkTarget(t.host, config);
          const sid = await openSshSession(config, t.host, t.port ?? 22, t.username, t.password);
          const [version, interfaces] = await Promise.all([
            runSshCommand(sid, 'show version'),
            runSshCommand(sid, 'show interfaces'),
          ]);
          const sess = sshSessions.get(sid);
          try {
            sess?.client.end();
          } catch {
            /**/
          }
          sshSessions.delete(sid);
          return {
            host: t.host,
            version: version.slice(0, 500),
            interfaces: interfaces.slice(0, 500),
          };
        })
      );
      const summary = results.map((r, i) =>
        r.status === 'fulfilled'
          ? { status: 'ok', ...r.value }
          : { host: targets[i]!.host, status: 'error', error: (r.reason as Error).message }
      );
      return jsonResponse(summary);
    })
  );

  server.registerTool(
    'network_ping_test',
    {
      description:
        'Execute ping from a connected device to a target IP. Returns loss %, RTT min/avg/max.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        target: z.string().describe('Target IP address to ping'),
        count: z.number().int().min(1).max(100).default(5).describe('Ping count'),
      },
    },
    wrapToolHandler('network_ping_test', middleware, async (args) => {
      const { sessionId, target, count } = args as {
        sessionId: string;
        target: string;
        count: number;
      };
      const output = await runSshCommand(
        sessionId,
        `ping ${safeNetArg(target, 'target')} repeat ${count ?? 5}`
      );
      return jsonResponse({ target, output });
    })
  );

  server.registerTool(
    'network_traceroute',
    {
      description: 'Execute traceroute from a connected device. Returns hop list with latency.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        target: z.string().describe('Target IP address or hostname'),
        maxHops: z.number().int().min(1).max(30).default(30).describe('Maximum hops (TTL)'),
      },
    },
    wrapToolHandler('network_traceroute', middleware, async (args) => {
      const { sessionId, target, maxHops } = args as {
        sessionId: string;
        target: string;
        maxHops: number;
      };
      const output = await runSshCommand(
        sessionId,
        `traceroute ${safeNetArg(target, 'target')} ttl 1 ${maxHops ?? 30}`
      );
      return jsonResponse({ target, output });
    })
  );

  // ── 46.2 Discovery & Topology ─────────────────────────────────────────────

  server.registerTool(
    'network_discovery_cdp',
    {
      description:
        'Run "show cdp neighbors detail" on a device. Returns structured neighbor list (device ID, IP, platform, interface).',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_discovery_cdp', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const output = await runSshCommand(sessionId, 'show cdp neighbors detail');
      return jsonResponse({ raw: output, parsed: parseCdpNeighbors(output) });
    })
  );

  server.registerTool(
    'network_discovery_lldp',
    {
      description:
        'Run "show lldp neighbors detail" on a device. Returns structured neighbor list.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_discovery_lldp', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const output = await runSshCommand(sessionId, 'show lldp neighbors detail');
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_topology_build',
    {
      description:
        'Seed from a list of devices, recursively discover via CDP, build an adjacency graph. Returns JSON graph and Mermaid diagram.',
      inputSchema: {
        seeds: z
          .array(
            z.object({
              host: z.string(),
              username: z.string(),
              password: z.string().optional(),
            })
          )
          .min(1)
          .max(10)
          .describe('Seed devices to start discovery from (max 10)'),
        maxDepth: z.number().int().min(1).max(5).default(2).describe('Maximum discovery depth'),
      },
    },
    wrapToolHandler('network_topology_build', middleware, async (args) => {
      const { seeds, maxDepth } = args as {
        seeds: { host: string; username: string; password?: string }[];
        maxDepth: number;
      };
      const nodes = new Map<string, { hostname: string; ip: string; platform?: string }>();
      const edges: { from: string; to: string; localIface: string; remoteIface: string }[] = [];
      const visited = new Set<string>();

      const discover = async (
        host: string,
        username: string,
        password: string | undefined,
        depth: number
      ): Promise<void> => {
        if (depth > (maxDepth ?? 2) || visited.has(host)) return;
        visited.add(host);
        validateNetworkTarget(host, config);
        const sid = await openSshSession(config, host, 22, username, password);
        const cdpOut = await runSshCommand(sid, 'show cdp neighbors detail');
        try {
          sshSessions.get(sid)?.client.end();
        } catch {
          /**/
        }
        sshSessions.delete(sid);

        nodes.set(host, { hostname: host, ip: host });
        const neighbors = parseCdpNeighbors(cdpOut);

        for (const n of neighbors) {
          if (n.ip) {
            nodes.set(n.ip, { hostname: n.deviceId, ip: n.ip, platform: n.platform ?? undefined });
            edges.push({
              from: host,
              to: n.ip,
              localIface: n.localInterface,
              remoteIface: n.remoteInterface,
            });
            await discover(n.ip, username, password, depth + 1);
          }
        }
      };

      await Promise.allSettled(seeds.map((s) => discover(s.host, s.username, s.password, 1)));

      const nodeList = Array.from(nodes.values());
      const mermaid = [
        'graph TD',
        ...edges.map(
          (e) =>
            `  ${e.from.replace(/\./g, '_')}["${e.from}"] -->|${e.localIface}| ${e.to.replace(/\./g, '_')}["${e.to}"]`
        ),
      ].join('\n');

      return jsonResponse({ nodes: nodeList, edges, mermaid });
    })
  );

  server.registerTool(
    'network_arp_table',
    {
      description: 'Return parsed ARP table (IP → MAC → interface) from a connected device.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        vrf: z.string().optional().describe('VRF name (optional, default VRF if omitted)'),
      },
    },
    wrapToolHandler('network_arp_table', middleware, async (args) => {
      const { sessionId, vrf } = args as { sessionId: string; vrf?: string };
      const cmd = vrf ? `show arp vrf ${safeNetArg(vrf, 'vrf')}` : 'show arp';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_mac_table',
    {
      description:
        'Return parsed MAC address table (MAC → VLAN → interface) from a connected switch.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        vlan: z.number().int().min(1).max(4094).optional().describe('Filter by VLAN ID'),
      },
    },
    wrapToolHandler('network_mac_table', middleware, async (args) => {
      const { sessionId, vlan } = args as { sessionId: string; vlan?: number };
      const cmd = vlan ? `show mac address-table vlan ${vlan}` : 'show mac address-table';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  // ── 46.3 Routing & Switching ───────────────────────────────────────────────

  server.registerTool(
    'network_routing_table',
    {
      description:
        'Parse "show ip route" and return structured route entries with protocol, prefix, next-hop, AD/metric.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        prefix: z.string().optional().describe('Filter by specific prefix (e.g. "10.0.0.0/8")'),
        protocol: z
          .enum(['all', 'ospf', 'bgp', 'static', 'connected'])
          .default('all')
          .describe('Filter by routing protocol'),
        ipv6: z.boolean().default(false).describe('Show IPv6 routing table instead of IPv4'),
      },
    },
    wrapToolHandler('network_routing_table', middleware, async (args) => {
      const { sessionId, prefix, protocol, ipv6 } = args as {
        sessionId: string;
        prefix?: string;
        protocol: string;
        ipv6: boolean;
      };
      let cmd = ipv6 ? 'show ipv6 route' : 'show ip route';
      if (protocol && protocol !== 'all') cmd += ` ${protocol}`;
      if (prefix) cmd += ` ${safeNetArg(prefix, 'prefix')}`;
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_ospf_neighbors',
    {
      description:
        'Parse "show ip ospf neighbor" and return neighbor list with state, dead timer, interface.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_ospf_neighbors', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const output = await runSshCommand(sessionId, 'show ip ospf neighbor');
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_ospf_lsdb',
    {
      description: 'Parse "show ip ospf database" and return LSA summary by type.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        processId: z.number().int().optional().describe('OSPF process ID (optional)'),
      },
    },
    wrapToolHandler('network_ospf_lsdb', middleware, async (args) => {
      const { sessionId, processId } = args as { sessionId: string; processId?: number };
      const cmd = processId ? `show ip ospf ${processId} database` : 'show ip ospf database';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_bgp_peers',
    {
      description: 'Parse "show bgp summary" and return peer list with ASN, state, prefix count.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        afi: z.enum(['ipv4', 'ipv6', 'vpnv4']).default('ipv4').describe('Address family'),
      },
    },
    wrapToolHandler('network_bgp_peers', middleware, async (args) => {
      const { sessionId, afi } = args as { sessionId: string; afi: string };
      const cmd = afi === 'ipv4' ? 'show bgp summary' : `show bgp ${afi} unicast summary`;
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_interface_status',
    {
      description:
        'Parse "show interfaces" and return per-interface admin/oper state, speed, duplex, errors.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        interface: z
          .string()
          .optional()
          .describe('Filter to a specific interface (e.g. "GigabitEthernet0/1")'),
      },
    },
    wrapToolHandler('network_interface_status', middleware, async (args) => {
      const { sessionId, interface: iface } = args as { sessionId: string; interface?: string };
      const cmd = iface
        ? `show interfaces ${safeNetArg(iface, 'interface')}`
        : 'show interfaces status';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_vlan_list',
    {
      description: 'Parse "show vlan brief" and return VLAN ID, name, active ports.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_vlan_list', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const output = await runSshCommand(sessionId, 'show vlan brief');
      return jsonResponse({ raw: output });
    })
  );

  // ── 46.4 Security Auditing ────────────────────────────────────────────────

  server.registerTool(
    'network_acl_audit',
    {
      description:
        'Parse "show ip access-lists" and return ACL entries, match counts, and implicit deny analysis.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        aclName: z.string().optional().describe('Filter to a specific ACL name'),
      },
    },
    wrapToolHandler('network_acl_audit', middleware, async (args) => {
      const { sessionId, aclName } = args as { sessionId: string; aclName?: string };
      const cmd = aclName
        ? `show ip access-lists ${safeNetArg(aclName, 'aclName')}`
        : 'show ip access-lists';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_aaa_status',
    {
      description: 'Return AAA server list and method config from a connected device.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_aaa_status', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const [servers, runningConfig] = await Promise.all([
        runSshCommand(sessionId, 'show aaa servers'),
        runSshCommand(sessionId, 'show running-config | section aaa'),
      ]);
      return jsonResponse({ servers, aaaConfig: runningConfig });
    })
  );

  server.registerTool(
    'network_port_security',
    {
      description:
        'Parse "show port-security" and return per-interface violations, max MAC, sticky config.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        interface: z.string().optional().describe('Filter to a specific interface'),
      },
    },
    wrapToolHandler('network_port_security', middleware, async (args) => {
      const { sessionId, interface: iface } = args as { sessionId: string; interface?: string };
      const cmd = iface
        ? `show port-security interface ${safeNetArg(iface, 'interface')}`
        : 'show port-security';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_stp_status',
    {
      description:
        'Parse "show spanning-tree" and return root bridge, port roles/states, topology change count.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
        vlan: z.number().int().min(1).max(4094).optional().describe('Filter by VLAN ID'),
      },
    },
    wrapToolHandler('network_stp_status', middleware, async (args) => {
      const { sessionId, vlan } = args as { sessionId: string; vlan?: number };
      const cmd = vlan ? `show spanning-tree vlan ${vlan}` : 'show spanning-tree';
      const output = await runSshCommand(sessionId, cmd);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'network_software_version',
    {
      description:
        'Parse "show version" and return OS family, version string, uptime, platform, serial number.',
      inputSchema: {
        sessionId: z.string().describe('Session ID from network_device_connect'),
      },
    },
    wrapToolHandler('network_software_version', middleware, async (args) => {
      const { sessionId } = args as { sessionId: string };
      const output = await runSshCommand(sessionId, 'show version');
      return jsonResponse({ raw: output, parsed: parseShowVersion(output) });
    })
  );

  // ── 46.5 NetBox ────────────────────────────────────────────────────────────

  server.registerTool(
    'netbox_devices_list',
    {
      description: 'Query NetBox devices with optional filters. Returns structured device list.',
      inputSchema: {
        site: z.string().optional().describe('Filter by site slug'),
        role: z.string().optional().describe('Filter by device role slug'),
        tag: z.string().optional().describe('Filter by tag'),
        status: z
          .enum(['active', 'planned', 'staged', 'failed', 'inventory', 'decommissioning'])
          .optional(),
        limit: z.number().int().min(1).max(500).default(50).describe('Maximum results'),
      },
    },
    wrapToolHandler('netbox_devices_list', middleware, async (args) => {
      const { site, role, tag, status, limit } = args as {
        site?: string;
        role?: string;
        tag?: string;
        status?: string;
        limit: number;
      };
      const params: string[] = [`limit=${limit ?? 50}`];
      if (site) params.push(`site=${encodeURIComponent(site)}`);
      if (role) params.push(`role=${encodeURIComponent(role)}`);
      if (tag) params.push(`tag=${encodeURIComponent(tag)}`);
      if (status) params.push(`status=${status}`);
      const data = await netboxFetch(config, `/dcim/devices/?${params.join('&')}`);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'netbox_interfaces_list',
    {
      description:
        'Query NetBox interfaces for a device. Returns interface list with IP assignments.',
      inputSchema: {
        deviceName: z.string().describe('Device name in NetBox'),
        enabledOnly: z.boolean().default(false).describe('Filter to enabled interfaces only'),
      },
    },
    wrapToolHandler('netbox_interfaces_list', middleware, async (args) => {
      const { deviceName, enabledOnly } = args as { deviceName: string; enabledOnly: boolean };
      const path = `/dcim/interfaces/?device=${encodeURIComponent(deviceName)}${enabledOnly ? '&enabled=true' : ''}`;
      const data = await netboxFetch(config, path);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'netbox_ipam_ips',
    {
      description:
        'Query NetBox IP addresses with prefix or VRF filters. Returns IP–device assignment map.',
      inputSchema: {
        prefix: z.string().optional().describe('Filter by parent prefix (e.g. "10.0.0.0/8")'),
        vrf: z.string().optional().describe('Filter by VRF name'),
        deviceName: z.string().optional().describe('Filter by device name'),
        limit: z.number().int().min(1).max(500).default(50),
      },
    },
    wrapToolHandler('netbox_ipam_ips', middleware, async (args) => {
      const { prefix, vrf, deviceName, limit } = args as {
        prefix?: string;
        vrf?: string;
        deviceName?: string;
        limit: number;
      };
      const params: string[] = [`limit=${limit ?? 50}`];
      if (prefix) params.push(`parent=${encodeURIComponent(prefix)}`);
      if (vrf) params.push(`vrf=${encodeURIComponent(vrf)}`);
      if (deviceName) params.push(`device=${encodeURIComponent(deviceName)}`);
      const data = await netboxFetch(config, `/ipam/ip-addresses/?${params.join('&')}`);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'netbox_cables',
    {
      description:
        'Query NetBox cables. Returns cable list with endpoint A/B device and interface.',
      inputSchema: {
        site: z.string().optional().describe('Filter by site slug'),
        limit: z.number().int().min(1).max(500).default(50),
      },
    },
    wrapToolHandler('netbox_cables', middleware, async (args) => {
      const { site, limit } = args as { site?: string; limit: number };
      const params = [`limit=${limit ?? 50}`];
      if (site) params.push(`site=${encodeURIComponent(site)}`);
      const data = await netboxFetch(config, `/dcim/cables/?${params.join('&')}`);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'netbox_reconcile',
    {
      description:
        'Compare live CDP/LLDP topology against NetBox cables and interfaces. Returns structured drift report (missing in NetBox, missing on live, mismatches).',
      inputSchema: {
        sessionId: z
          .string()
          .describe('Session ID from network_device_connect (seed device for topology)'),
        site: z.string().optional().describe('NetBox site slug to scope the comparison'),
      },
    },
    wrapToolHandler('netbox_reconcile', middleware, async (args) => {
      const { sessionId, site } = args as { sessionId: string; site?: string };

      const cdpOut = await runSshCommand(sessionId, 'show cdp neighbors detail');
      const liveNeighbors = parseCdpNeighbors(cdpOut);

      const params = ['limit=500'];
      if (site) params.push(`site=${encodeURIComponent(site)}`);
      const nbCables = (await netboxFetch(config, `/dcim/cables/?${params.join('&')}`)) as {
        results: { id: number; termination_a: unknown; termination_b: unknown }[];
      };

      const missingInNetbox: string[] = [];
      for (const n of liveNeighbors) {
        const found = nbCables.results.some(
          (c) => JSON.stringify(c).includes(n.deviceId) || JSON.stringify(c).includes(n.ip ?? '')
        );
        if (!found)
          missingInNetbox.push(`${n.deviceId} (${n.ip ?? 'no IP'}) via ${n.localInterface}`);
      }

      return jsonResponse({
        liveNeighborCount: liveNeighbors.length,
        netboxCableCount: nbCables.results.length,
        missingInNetbox,
        missingOnLive: [], // full bidirectional check requires iterating all NetBox cables — future enhancement
        note: 'Full bidirectional reconciliation requires iterating all NetBox devices. Run network_topology_build for comprehensive discovery.',
      });
    })
  );

  // ── 46.6 NVD / CVE ────────────────────────────────────────────────────────

  server.registerTool(
    'nvd_cve_search',
    {
      description:
        'Search NVD CVE database by keyword and optional CVSS score filter. Returns CVE ID, description, CVSS v3 score, published date.',
      inputSchema: {
        keyword: z.string().min(2).describe('Search keyword (e.g. "cisco ios buffer overflow")'),
        cvssV3SeverityMin: z
          .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
          .optional()
          .describe('Minimum CVSS v3 severity'),
        pubStartDate: z
          .string()
          .optional()
          .describe('Published after (ISO 8601 date, e.g. "2024-01-01")'),
        pubEndDate: z
          .string()
          .optional()
          .describe('Published before (ISO 8601 date, e.g. "2025-01-01")'),
      },
    },
    wrapToolHandler('nvd_cve_search', middleware, async (args) => {
      const { keyword, cvssV3SeverityMin, pubStartDate, pubEndDate } = args as {
        keyword: string;
        cvssV3SeverityMin?: string;
        pubStartDate?: string;
        pubEndDate?: string;
      };
      const params: Record<string, string> = { keywordSearch: keyword };
      if (cvssV3SeverityMin) params.cvssV3Severity = cvssV3SeverityMin;
      if (pubStartDate) params.pubStartDate = pubStartDate + 'T00:00:00.000';
      if (pubEndDate) params.pubEndDate = pubEndDate + 'T23:59:59.999';
      const data = await nvdFetch(config, params);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'nvd_cve_by_software',
    {
      description:
        'Look up CVEs for a specific vendor + product + version using CPE match. Targeted for IOS XE version strings from network_software_version.',
      inputSchema: {
        vendor: z.string().describe('CPE vendor (e.g. "cisco")'),
        product: z.string().describe('CPE product (e.g. "ios_xe")'),
        version: z.string().optional().describe('Version string (e.g. "17.9.4")'),
        cvssV3SeverityMin: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      },
    },
    wrapToolHandler('nvd_cve_by_software', middleware, async (args) => {
      const { vendor, product, version, cvssV3SeverityMin } = args as {
        vendor: string;
        product: string;
        version?: string;
        cvssV3SeverityMin?: string;
      };
      const cpeName = version
        ? `cpe:2.3:o:${vendor}:${product}:${version}:*:*:*:*:*:*:*`
        : `cpe:2.3:o:${vendor}:${product}:*:*:*:*:*:*:*:*`;
      const params: Record<string, string> = { cpeName };
      if (cvssV3SeverityMin) params.cvssV3Severity = cvssV3SeverityMin;
      const data = await nvdFetch(config, params);
      return jsonResponse(data);
    })
  );

  server.registerTool(
    'nvd_cve_get',
    {
      description:
        'Fetch full CVE record by CVE ID. Returns description, CVSS v3 vector, CWE, references.',
      inputSchema: {
        cveId: z
          .string()
          .regex(/^CVE-\d{4}-\d+$/)
          .describe('CVE ID (e.g. "CVE-2024-20399")'),
      },
    },
    wrapToolHandler('nvd_cve_get', middleware, async (args) => {
      const { cveId } = args as { cveId: string };
      const data = await nvdFetch(config, { cveId });
      return jsonResponse(data);
    })
  );

  // ── 46.7 Network Utilities ────────────────────────────────────────────────

  server.registerTool(
    'subnet_calculator',
    {
      description:
        'Calculate IPv4 subnet details: network, broadcast, first/last host, mask, wildcard mask, host count.',
      inputSchema: {
        cidr: z
          .string()
          .describe('IPv4 CIDR notation (e.g. "192.168.1.0/24" or "192.168.1.100/24")'),
      },
    },
    wrapToolHandler('subnet_calculator', middleware, async (args) => {
      const { cidr } = args as { cidr: string };
      try {
        return jsonResponse(calculateSubnet(cidr));
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    })
  );

  server.registerTool(
    'subnet_vlsm',
    {
      description:
        'VLSM (Variable Length Subnet Masking) — given a parent prefix and host requirements, return an allocation table ordered largest-first.',
      inputSchema: {
        parentCidr: z.string().describe('Parent IPv4 CIDR block to carve (e.g. "10.0.0.0/20")'),
        hostRequirements: z
          .array(z.number().int().min(1))
          .min(1)
          .max(20)
          .describe('List of required host counts per subnet'),
      },
    },
    wrapToolHandler('subnet_vlsm', middleware, async (args) => {
      const { parentCidr, hostRequirements } = args as {
        parentCidr: string;
        hostRequirements: number[];
      };
      try {
        return jsonResponse(calculateVlsm(parentCidr, hostRequirements));
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    })
  );

  server.registerTool(
    'wildcard_mask_calc',
    {
      description: 'Convert a subnet mask or prefix length to a wildcard mask (for ACL authoring).',
      inputSchema: {
        input: z
          .string()
          .describe(
            'Dotted-decimal subnet mask (e.g. "255.255.255.0") or prefix length (e.g. "24")'
          ),
      },
    },
    wrapToolHandler('wildcard_mask_calc', middleware, async (args) => {
      const { input } = args as { input: string };
      try {
        const wildcard = subnetMaskToWildcard(input);
        return jsonResponse({ input, wildcardMask: wildcard });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    })
  );

  // ── 46.8 PCAP Analysis ────────────────────────────────────────────────────

  const PCAP_DISABLED_MSG =
    'tshark is not installed. Install Wireshark/tshark to enable PCAP analysis tools.';

  const pcapStore = new Map<string, string>(); // pcapId → tmpfile path

  server.registerTool(
    'pcap_upload',
    {
      description:
        'Upload a pcap/pcapng file (base64-encoded) for analysis. Returns a pcapId for use with other pcap_* tools.',
      inputSchema: {
        data: z.string().describe('Base64-encoded pcap or pcapng file contents'),
        filename: z.string().optional().describe('Original filename (informational only)'),
      },
    },
    wrapToolHandler('pcap_upload', middleware, async (args) => {
      if (!tsharkAvailable) return errorResponse(PCAP_DISABLED_MSG);
      const { data } = args as { data: string; filename?: string };
      const buf = Buffer.from(data, 'base64');
      if (buf.length === 0) return errorResponse('Empty file data');
      if (buf.length > 100 * 1024 * 1024) return errorResponse('File too large (max 100MB)');
      const pcapId = randomUUID();
      const tmpPath = join(tmpdir(), `sy-pcap-${pcapId}.pcap`);
      await writeFile(tmpPath, buf);
      pcapStore.set(pcapId, tmpPath);
      // Auto-cleanup after 30 minutes
      setTimeout(
        () => {
          pcapStore.delete(pcapId);
          void unlink(tmpPath).catch(() => undefined);
        },
        30 * 60 * 1000
      );
      return jsonResponse({
        pcapId,
        bytes: buf.length,
        message: 'File uploaded. Use pcapId with pcap_* tools.',
      });
    })
  );

  server.registerTool(
    'pcap_protocol_hierarchy',
    {
      description:
        'Run tshark protocol hierarchy statistics on an uploaded pcap. Returns protocol tree with packet/byte counts.',
      inputSchema: {
        pcapId: z.string().describe('pcapId from pcap_upload'),
      },
    },
    wrapToolHandler('pcap_protocol_hierarchy', middleware, async (args) => {
      if (!tsharkAvailable) return errorResponse(PCAP_DISABLED_MSG);
      const { pcapId } = args as { pcapId: string };
      const path = pcapStore.get(pcapId);
      if (!path)
        return errorResponse(`pcapId "${pcapId}" not found. Upload a file first with pcap_upload.`);
      const output = await runTshark(['-r', path, '-qz', 'io,phs']);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'pcap_conversations',
    {
      description: 'List IP conversations in an uploaded pcap with bytes, packets, and duration.',
      inputSchema: {
        pcapId: z.string().describe('pcapId from pcap_upload'),
        layer: z.enum(['ip', 'tcp', 'udp']).default('ip').describe('Conversation layer'),
      },
    },
    wrapToolHandler('pcap_conversations', middleware, async (args) => {
      if (!tsharkAvailable) return errorResponse(PCAP_DISABLED_MSG);
      const { pcapId, layer } = args as { pcapId: string; layer: string };
      const path = pcapStore.get(pcapId);
      if (!path) return errorResponse(`pcapId "${pcapId}" not found.`);
      const output = await runTshark(['-r', path, '-qz', `conv,${layer ?? 'ip'}`]);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'pcap_dns_queries',
    {
      description:
        'Extract DNS query/response pairs from an uploaded pcap. Returns domain, record type, response, client IP.',
      inputSchema: {
        pcapId: z.string().describe('pcapId from pcap_upload'),
      },
    },
    wrapToolHandler('pcap_dns_queries', middleware, async (args) => {
      if (!tsharkAvailable) return errorResponse(PCAP_DISABLED_MSG);
      const { pcapId } = args as { pcapId: string };
      const path = pcapStore.get(pcapId);
      if (!path) return errorResponse(`pcapId "${pcapId}" not found.`);
      const output = await runTshark([
        '-r',
        path,
        '-Y',
        'dns',
        '-T',
        'fields',
        '-e',
        'frame.time',
        '-e',
        'ip.src',
        '-e',
        'dns.qry.name',
        '-e',
        'dns.qry.type',
        '-e',
        'dns.resp.name',
        '-E',
        'header=y',
        '-E',
        'separator=\t',
      ]);
      return jsonResponse({ raw: output });
    })
  );

  server.registerTool(
    'pcap_http_requests',
    {
      description:
        'Extract HTTP request/response metadata from an uploaded pcap. Returns method, host, URI, status, content-type.',
      inputSchema: {
        pcapId: z.string().describe('pcapId from pcap_upload'),
      },
    },
    wrapToolHandler('pcap_http_requests', middleware, async (args) => {
      if (!tsharkAvailable) return errorResponse(PCAP_DISABLED_MSG);
      const { pcapId } = args as { pcapId: string };
      const path = pcapStore.get(pcapId);
      if (!path) return errorResponse(`pcapId "${pcapId}" not found.`);
      const output = await runTshark([
        '-r',
        path,
        '-Y',
        'http',
        '-T',
        'fields',
        '-e',
        'frame.time',
        '-e',
        'ip.src',
        '-e',
        'ip.dst',
        '-e',
        'http.request.method',
        '-e',
        'http.host',
        '-e',
        'http.request.uri',
        '-e',
        'http.response.code',
        '-e',
        'http.content_type',
        '-E',
        'header=y',
        '-E',
        'separator=\t',
      ]);
      return jsonResponse({ raw: output });
    })
  );
}

// ─── Output parsers ───────────────────────────────────────────────────────────

interface CdpNeighbor {
  deviceId: string;
  ip: string | null;
  platform: string | null;
  localInterface: string;
  remoteInterface: string;
}

function parseCdpNeighbors(raw: string): CdpNeighbor[] {
  const neighbors: CdpNeighbor[] = [];
  // IOS CDP detail blocks are separated by "---" or "Device ID:"
  const blocks = raw.split(/(?=Device ID:)/i).filter((b) => b.trim());

  for (const block of blocks) {
    const deviceId = /Device ID:\s*(\S+)/i.exec(block)?.[1] ?? '';
    const ip =
      /IP(?:v4)? [Aa]ddress:\s*(\d+\.\d+\.\d+\.\d+)/.exec(block)?.[1] ??
      /Entry address\(es\):\s*\n\s*IP address:\s*(\S+)/i.exec(block)?.[1] ??
      null;
    const platform = /Platform:\s*([^,\n]+)/i.exec(block)?.[1]?.trim() ?? null;
    const localInterface = /Interface:\s*(\S+)/i.exec(block)?.[1] ?? '';
    const remoteInterface = /Port ID \(outgoing port\):\s*(\S+)/i.exec(block)?.[1] ?? '';

    if (deviceId) {
      neighbors.push({ deviceId, ip, platform, localInterface, remoteInterface });
    }
  }
  return neighbors;
}

interface ShowVersionInfo {
  iosFamily: string | null;
  version: string | null;
  hostname: string | null;
  uptime: string | null;
  platform: string | null;
  serialNumber: string | null;
}

function parseShowVersion(raw: string): ShowVersionInfo {
  return {
    iosFamily: /Cisco IOS (XE|XR|NX-OS) Software/i.exec(raw)?.[1]
      ? `IOS ${/Cisco IOS (XE|XR|NX-OS) Software/i.exec(raw)![1]}`
      : (/Cisco (IOS|NX-OS) Software/i.exec(raw)?.[1] ?? null),
    version: /Version ([\d.()A-Za-z]+)/i.exec(raw)?.[1] ?? null,
    hostname: /^(\S+)\s+uptime/im.exec(raw)?.[1] ?? null,
    uptime: /uptime is (.+)/i.exec(raw)?.[1]?.trim() ?? null,
    platform:
      /Cisco (\S+ \S+) \(revision/i.exec(raw)?.[1] ??
      /Hardware:\s+(.+)/i.exec(raw)?.[1]?.trim() ??
      null,
    serialNumber:
      /Processor board ID\s+(\S+)/i.exec(raw)?.[1] ??
      /System serial number\s*:\s*(\S+)/i.exec(raw)?.[1] ??
      null,
  };
}
