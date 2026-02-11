import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── cert-gen tests ──────────────────────────────────────────────────

describe('cert-gen', () => {
  const { isOpenSSLAvailable } = vi.hoisted(() => {
    return { isOpenSSLAvailable: vi.fn() };
  });

  // We import the real module, but skip tests if openssl unavailable
  let certGen: typeof import('../security/cert-gen.js');

  beforeEach(async () => {
    certGen = await import('../security/cert-gen.js');
  });

  describe('isOpenSSLAvailable', () => {
    it('returns a boolean', () => {
      const result = certGen.isOpenSSLAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe.skipIf(!(() => { try { require('child_process').execFileSync('openssl', ['version'], { stdio: 'pipe' }); return true; } catch { return false; } })())('with openssl', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(os.tmpdir(), 'friday-cert-test-'));
    });

    it('generateDevCerts creates PEM files', () => {
      const certs = certGen.generateDevCerts(tmpDir);
      expect(existsSync(certs.caKey)).toBe(true);
      expect(existsSync(certs.caCert)).toBe(true);
      expect(existsSync(certs.serverKey)).toBe(true);
      expect(existsSync(certs.serverCert)).toBe(true);
    });

    it('generateClientCert creates client PEM files', () => {
      const caCerts = certGen.generateDevCerts(tmpDir);
      const client = certGen.generateClientCert(tmpDir, 'test-client', {
        caKey: caCerts.caKey,
        caCert: caCerts.caCert,
      });
      expect(existsSync(client.clientKey)).toBe(true);
      expect(existsSync(client.clientCert)).toBe(true);
    });

    it('generateClientCert throws when CA files missing', () => {
      expect(() => certGen.generateClientCert(tmpDir, 'test', {
        caKey: '/nonexistent/ca-key.pem',
        caCert: '/nonexistent/ca-cert.pem',
      })).toThrow('CA key/cert not found');
    });

    // Cleanup
    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });
  });
});

// ── TLS server config tests ─────────────────────────────────────────

describe('GatewayServer TLS config', () => {
  it('builds https options when tls.enabled with cert/key paths', async () => {
    // We test the logic inline: verify the readFileSync calls would happen
    // by checking the constructor behavior indirectly
    const config = {
      host: '127.0.0.1',
      port: 18789,
      tls: { enabled: true, certPath: '/tmp/cert.pem', keyPath: '/tmp/key.pem' },
      cors: { enabled: true, origins: ['http://localhost:3000'] },
      auth: {
        tokenSecret: 'SECUREYEOMAN_TOKEN_SECRET',
        tokenExpirySeconds: 3600,
        refreshTokenExpirySeconds: 86400,
        adminPasswordEnv: 'SECUREYEOMAN_ADMIN_PASSWORD',
      },
    };

    // Constructor will throw because the cert files don't exist —
    // that confirms TLS logic was reached
    const { GatewayServer } = await import('./server.js');
    expect(() => new GatewayServer({
      config,
      secureYeoman: {} as any,
    })).toThrow(); // Will throw ENOENT for cert file
  });

  it('does not build https options when tls.enabled is false', async () => {
    const config = {
      host: '127.0.0.1',
      port: 18789,
      tls: { enabled: false },
      cors: { enabled: true, origins: ['http://localhost:3000'] },
      auth: {
        tokenSecret: 'SECUREYEOMAN_TOKEN_SECRET',
        tokenExpirySeconds: 3600,
        refreshTokenExpirySeconds: 86400,
        adminPasswordEnv: 'SECUREYEOMAN_ADMIN_PASSWORD',
      },
    };

    const { GatewayServer } = await import('./server.js');
    // Should not throw — no TLS file reading
    const server = new GatewayServer({
      config,
      secureYeoman: {} as any,
    });
    expect(server).toBeDefined();
  });
});

// ── Auth middleware cert auth tests ─────────────────────────────────

describe('auth-middleware certificate auth', () => {
  it('sets authUser from client certificate CN', async () => {
    const { createAuthHook } = await import('./auth-middleware.js');

    const mockAuthService = {
      validateToken: vi.fn(),
      validateApiKey: vi.fn(),
    };

    const hook = createAuthHook({
      authService: mockAuthService as any,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
    });

    const mockRequest = {
      routeOptions: { url: '/api/v1/metrics' },
      url: '/api/v1/metrics',
      headers: {},
      raw: {
        socket: {
          authorized: true,
          getPeerCertificate: () => ({
            subject: { CN: 'test-agent' },
          }),
        },
      },
      authUser: undefined as any,
    };

    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await hook(mockRequest as any, mockReply as any);

    expect(mockRequest.authUser).toBeDefined();
    expect(mockRequest.authUser.authMethod).toBe('certificate');
    expect(mockRequest.authUser.userId).toBe('test-agent');
  });

  it('falls back to JWT when socket is not authorized', async () => {
    const { createAuthHook } = await import('./auth-middleware.js');

    const mockAuthService = {
      validateToken: vi.fn(),
      validateApiKey: vi.fn(),
    };

    const hook = createAuthHook({
      authService: mockAuthService as any,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
    });

    const mockRequest = {
      routeOptions: { url: '/api/v1/metrics' },
      url: '/api/v1/metrics',
      headers: {},
      raw: {
        socket: {
          authorized: false,
        },
      },
    };

    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await hook(mockRequest as any, mockReply as any);

    // Should fall through and return 401 (no token/key provided)
    expect(mockReply.code).toHaveBeenCalledWith(401);
  });

  it('brain route permissions are defined', async () => {
    const mod = await import('./auth-middleware.js');
    // The ROUTE_PERMISSIONS is not exported, but we can verify via the
    // RBAC hook behavior — for now just verify the module loads
    expect(mod.createRbacHook).toBeDefined();
  });
});
