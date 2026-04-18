import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────

const { mockGetSecret, mockSecretsManager } = vi.hoisted(() => ({
  mockGetSecret: vi.fn().mockReturnValue(undefined),
  mockSecretsManager: {
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../config/loader.js', () => ({
  getSecret: mockGetSecret,
}));

// ── Import after mocks ──────────────────────────────────────────────

import { ServiceDiscoveryManager } from './service-discovery.js';

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'info' as const,
};

describe('ServiceDiscoveryManager', () => {
  let manager: ServiceDiscoveryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockReturnValue(undefined);
    manager = new ServiceDiscoveryManager({
      secretsManager: mockSecretsManager as any,
      logger: mockLogger as any,
    });
  });

  describe('getServices', () => {
    it('returns all services in disconnected state initially', () => {
      const services = manager.getServices();
      expect(services).toHaveLength(12);

      const agnostic = services.find((s) => s.id === 'agnostic');
      expect(agnostic).toBeDefined();
      expect(agnostic!.status).toBe('disconnected');
      expect(agnostic!.enabled).toBe(false);
      expect(agnostic!.displayName).toBe('Agnostic Agentic System');
      expect(agnostic!.requiredSecrets).toEqual(['AGNOSTIC_API_KEY', 'AGNOSTIC_WEBHOOK_SECRET']);

      const agnos = services.find((s) => s.id === 'agnos');
      expect(agnos).toBeDefined();
      expect(agnos!.status).toBe('disconnected');
      expect(agnos!.enabled).toBe(false);
      expect(agnos!.displayName).toBe('AGNOS Runtime');
      expect(agnos!.requiredSecrets).toEqual(['AGNOS_GATEWAY_API_KEY', 'AGNOS_RUNTIME_API_KEY']);

      const ifran = services.find((s) => s.id === 'ifran');
      expect(ifran).toBeDefined();
      expect(ifran!.status).toBe('disconnected');
      expect(ifran!.enabled).toBe(false);
      expect(ifran!.displayName).toBe('Ifran LLM Controller');
      expect(ifran!.requiredSecrets).toEqual([]);

      const delta = services.find((s) => s.id === 'delta');
      expect(delta).toBeDefined();
      expect(delta!.status).toBe('disconnected');
      expect(delta!.displayName).toBe('Delta Code Forge');

      const bullshift = services.find((s) => s.id === 'bullshift');
      expect(bullshift).toBeDefined();
      expect(bullshift!.status).toBe('disconnected');
      expect(bullshift!.displayName).toBe('BullShift Trading');

      const photisnadi = services.find((s) => s.id === 'photisnadi');
      expect(photisnadi).toBeDefined();
      expect(photisnadi!.status).toBe('disconnected');
      expect(photisnadi!.displayName).toBe('Photisnadi');

      const aequi = services.find((s) => s.id === 'aequi');
      expect(aequi).toBeDefined();
      expect(aequi!.status).toBe('disconnected');
      expect(aequi!.displayName).toBe('Aequi Accounting');

      const shruti = services.find((s) => s.id === 'shruti');
      expect(shruti).toBeDefined();
      expect(shruti!.status).toBe('disconnected');
      expect(shruti!.displayName).toBe('Shruti DAW');
      expect(shruti!.requiredSecrets).toEqual(['SHRUTI_API_KEY']);
    });
  });

  describe('getService', () => {
    it('returns undefined for unknown id', () => {
      const result = manager.getService('unknown' as any);
      expect(result).toBeUndefined();
    });

    it('returns service info for known id', () => {
      const result = manager.getService('agnostic');
      expect(result).toBeDefined();
      expect(result!.id).toBe('agnostic');
    });
  });

  describe('probe', () => {
    it('returns unreachable when fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await manager.probe('agnostic');
      expect(result.status).toBe('unreachable');
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.lastProbeAt).toBeTypeOf('number');
      expect(result.lastProbeLatencyMs).toBeTypeOf('number');

      vi.unstubAllGlobals();
    });

    it('returns unreachable when health check returns non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      const result = await manager.probe('agnostic');
      expect(result.status).toBe('unreachable');
      expect(result.error).toContain('503');

      vi.unstubAllGlobals();
    });

    it('updates state when health check succeeds', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const result = await manager.probe('agnostic');
      // Not enabled yet, so stays disconnected
      expect(result.status).toBe('disconnected');
      expect(result.error).toBeNull();
      expect(result.lastProbeAt).toBeTypeOf('number');

      vi.unstubAllGlobals();
    });
  });

  describe('enable', () => {
    it('generates keys and stores them when service is reachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const result = await manager.enable('agnostic');
      expect(result.status).toBe('connected');
      expect(result.enabled).toBe(true);
      expect(result.error).toBeNull();

      // Should have stored both required secrets
      expect(mockSecretsManager.set).toHaveBeenCalledTimes(2);
      expect(mockSecretsManager.set).toHaveBeenCalledWith('AGNOSTIC_API_KEY', expect.any(String));
      expect(mockSecretsManager.set).toHaveBeenCalledWith(
        'AGNOSTIC_WEBHOOK_SECRET',
        expect.any(String)
      );

      vi.unstubAllGlobals();
    });

    it('does not regenerate keys that already exist', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      mockGetSecret.mockImplementation((key: string) => {
        if (key === 'AGNOSTIC_API_KEY') return 'existing-key';
        return undefined;
      });

      await manager.enable('agnostic');
      // Only AGNOSTIC_WEBHOOK_SECRET should be generated
      expect(mockSecretsManager.set).toHaveBeenCalledTimes(1);
      expect(mockSecretsManager.set).toHaveBeenCalledWith(
        'AGNOSTIC_WEBHOOK_SECRET',
        expect.any(String)
      );

      vi.unstubAllGlobals();
    });

    it('returns unreachable status when service is not reachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await manager.enable('agnostic');
      expect(result.status).toBe('unreachable');
      expect(result.enabled).toBe(false);
      expect(mockSecretsManager.set).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('disable', () => {
    it('clears secrets and sets status to disconnected', async () => {
      // First enable
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      await manager.enable('agnostic');
      vi.clearAllMocks();

      // Then disable
      const result = await manager.disable('agnostic');
      expect(result.status).toBe('disconnected');
      expect(result.enabled).toBe(false);
      expect(result.error).toBeNull();

      expect(mockSecretsManager.delete).toHaveBeenCalledTimes(2);
      expect(mockSecretsManager.delete).toHaveBeenCalledWith('AGNOSTIC_API_KEY');
      expect(mockSecretsManager.delete).toHaveBeenCalledWith('AGNOSTIC_WEBHOOK_SECRET');

      vi.unstubAllGlobals();
    });
  });
});
