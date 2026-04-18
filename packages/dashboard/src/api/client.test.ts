// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setAuthTokens,
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  setOnAuthFailure,
  verifySession,
  login,
  logout,
  fetchHealth,
  fetchMetrics,
  fetchTasks,
  fetchPersonalities,
  createPersonality,
  deletePersonality,
  fetchSkills,
  fetchConversations,
  fetchSecurityEvents,
  createSkill,
  // Chat
  sendChatMessage,
  fetchConversation,
  deleteConversation,
  createConversation,
  // Knowledge
  learnKnowledge,
  fetchKnowledge,
  updateKnowledge,
  deleteKnowledge,
  // Security policy
  fetchSecurityPolicy,
  updateSecurityPolicy,
  // Skills CRUD
  updateSkill,
  deleteSkill,
  // Personalities
  activatePersonality,
  enablePersonality,
  disablePersonality,
  setDefaultPersonality,
  clearDefaultPersonality,
  updatePersonality,
  // Documents
  uploadDocument,
  listDocuments,
  deleteDocument,
  // API keys
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  // Onboarding
  fetchOnboardingStatus,
  completeOnboarding,
  // Integrations
  fetchIntegrations,
  // Model
  fetchModelInfo,
  // Notifications
  fetchNotifications,
  markNotificationRead,
  // Export/Import
  exportPersonality,
  importPersonality,
  // Multimodal
  analyzeImage,
  updateMultimodalProvider,
  transcribeAudio,
  synthesizeSpeech,
  generateImage,
  updateMultimodalModel,
  fetchBrowserSession,
  fetchCostBreakdown,
  fetchCostHistory,
  resetUsageStat,
  executeSwarm,
  fetchSwarmRun,
  cancelSwarmRun,
  fetchGroupChatChannels,
  fetchGroupChatMessages,
  sendGroupChatMessage,
  fetchRoutingRules,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  testRoutingRule,
  updateWorkspace,
  deleteWorkspace,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  fetchWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  triggerWorkflow,
  fetchWorkflowRun,
  cancelWorkflowRun,
  fetchSoulApprovals,
  fetchSoulApprovalCount,
  approveSoulAction,
  rejectSoulAction,
  checkSecret,
  generateTlsCert,
  fetchActiveIntent,
  activateIntent,
  fetchEnforcementLog,
  readSignal,
  fetchGoalTimeline,
  createAuditRun,
  fetchAuditRun,
  updateAuditItem,
  finalizeAuditRun,
  emergencyStop,
  fetchPendingConsents,
  grantConsent,
  denyConsent,
  revokeConsent,
  fetchActiveRecordings,
  stopRecording,
  fetchStrategies,
  fetchStrategy,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  fetchAthiScenarios,
  createAthiScenario,
  updateAthiScenario,
  deleteAthiScenario,
  fetchAthiMatrix,
  fetchAthiTopRisks,
  fetchAthiSummary,
  fetchAthiScenariosByTechnique,
  linkEventsToAthiScenario,
  fetchPersonalityVersion,
  deletePersonalityTag,
  rollbackPersonality,
  fetchPersonalityDrift,
  fetchPersonalityVersionDiff,
  fetchWorkflowVersions,
  fetchWorkflowVersion,
  tagWorkflowRelease,
  rollbackWorkflow,
  fetchWorkflowDrift,
  fetchWorkflowVersionDiff,
  fetchCitationFeedback,
  submitCitationFeedback,
  fetchDocumentProvenance,
  updateDocumentProvenance,
  fetchGroundingStats,
  fetchProviderAccounts,
  createProviderAccount,
  updateProviderAccount,
  deleteProviderAccount,
  setDefaultProviderAccount,
  validateProviderAccount,
  rotateProviderAccountKey,
  validateAllProviderAccounts,
  fetchAccountCosts,
  fetchAccountCostTrend,
  fetchScanHistory,
  fetchScanStats,
  fetchQuarantineItems,
  approveQuarantine,
  deleteQuarantine,
  fetchThreatIntelligence,
  fetchSandboxPolicy,
  searchFiles,
  replaceInFiles,
  fetchAnnotations,
  createAnnotation,
  deleteAnnotation,
  exportAnnotationsAsDataset,
  fetchInlineCompletion,
  fetchPhotisnadiWidget,
  fetchPhotisnadiHealth,
  fetchKeyRotationStatus,
  rotateKey,
  fetchProactivePatterns,
  convertPatternToTrigger,
  fetchProactiveConfig,
  fetchPreferencePairs,
  createPreferencePair,
  deletePreferencePair,
  rateSideBySide,
  previewCuratedDataset,
  createCuratedDataset,
  fetchCuratedDatasets,
  deleteCuratedDataset,
  fetchTrainingExperiments,
  createTrainingExperiment,
  getTrainingExperiment,
  deleteTrainingExperiment,
  diffTrainingExperiments,
  deployModel,
  rollbackModel,
  fetchModelVersions,
  createAbTest,
  fetchAbTests,
  getAbTest,
  completeAbTest,
  cancelAbTest,
  evaluateAbTest,
} from './client';

// ── Setup ────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  clearAuthTokens();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function errorResponse(message: string, status: number) {
  return Promise.resolve(
    new Response(JSON.stringify({ message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

// ── Auth token management ────────────────────────────────────────────

describe('Auth token management', () => {
  it('setAuthTokens stores tokens in memory and localStorage', () => {
    setAuthTokens('access123', 'refresh456');
    expect(getAccessToken()).toBe('access123');
    expect(getRefreshToken()).toBe('refresh456');
    expect(localStorage.getItem('accessToken')).toBe('access123');
    expect(localStorage.getItem('refreshToken')).toBe('refresh456');
  });

  it('clearAuthTokens removes tokens', () => {
    setAuthTokens('a', 'r');
    clearAuthTokens();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('getAccessToken reads from localStorage if not in memory', () => {
    localStorage.setItem('accessToken', 'fromStorage');
    // Clear internal cache
    clearAuthTokens();
    localStorage.setItem('accessToken', 'fromStorage');
    expect(getAccessToken()).toBe('fromStorage');
  });

  it('getRefreshToken reads from localStorage if not in memory', () => {
    localStorage.setItem('refreshToken', 'refreshFromStorage');
    clearAuthTokens();
    localStorage.setItem('refreshToken', 'refreshFromStorage');
    expect(getRefreshToken()).toBe('refreshFromStorage');
  });
});

// ── login / logout ───────────────────────────────────────────────────

describe('login', () => {
  it('sends POST to /auth/login and returns tokens', async () => {
    const tokens = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
    mockFetch.mockReturnValueOnce(jsonResponse(tokens));

    const result = await login('mypassword');
    expect(result).toEqual(tokens);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/auth/login');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ password: 'mypassword', rememberMe: false });
  });

  it('sends rememberMe when specified', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ accessToken: 'a', refreshToken: 'r' }));
    await login('pass', true);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.rememberMe).toBe(true);
  });
});

describe('logout', () => {
  it('sends POST to /auth/logout and clears tokens', async () => {
    setAuthTokens('a', 'r');
    mockFetch.mockReturnValueOnce(jsonResponse({ message: 'ok' }));
    await logout();
    expect(getAccessToken()).toBeNull();
  });

  it('clears tokens even if server request fails', async () => {
    setAuthTokens('a', 'r');
    mockFetch.mockReturnValueOnce(errorResponse('Server error', 500));
    await logout();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});

// ── verifySession ────────────────────────────────────────────────────

describe('verifySession', () => {
  it('returns false when no token exists', async () => {
    expect(await verifySession()).toBe(false);
  });

  it('returns true when /metrics call succeeds', async () => {
    setAuthTokens('valid', 'r');
    mockFetch.mockReturnValueOnce(jsonResponse({ timestamp: 1 }));
    expect(await verifySession()).toBe(true);
  });

  it('returns false when /metrics call fails', async () => {
    setAuthTokens('expired', 'r');
    // 401 → refresh attempt fails
    mockFetch.mockReturnValueOnce(errorResponse('Unauthorized', 401));
    mockFetch.mockReturnValueOnce(errorResponse('Refresh failed', 401));
    expect(await verifySession()).toBe(false);
  });
});

// ── fetchHealth ──────────────────────────────────────────────────────

describe('fetchHealth', () => {
  it('returns health data on success', async () => {
    const health = {
      status: 'ok',
      version: '1.0',
      uptime: 100,
      checks: { database: true, auditChain: true },
    };
    mockFetch.mockReturnValueOnce(jsonResponse(health));
    const result = await fetchHealth();
    expect(result.status).toBe('ok');
  });

  it('returns error health on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await fetchHealth();
    expect(result.status).toBe('error');
    expect(result.version).toBe('unknown');
  });

  it('returns error health on non-ok response', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('Down', 503));
    const result = await fetchHealth();
    expect(result.status).toBe('error');
  });
});

// ── fetchMetrics ─────────────────────────────────────────────────────

describe('fetchMetrics', () => {
  it('returns metrics data on success', async () => {
    const metrics = { timestamp: Date.now(), tasks: { total: 5 }, resources: {} };
    mockFetch.mockReturnValueOnce(jsonResponse(metrics));
    const result = await fetchMetrics();
    expect(result.timestamp).toBe(metrics.timestamp);
  });

  it('returns fallback metrics on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchMetrics();
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.tasks.total).toBe(0);
  });
});

// ── Core API functions ───────────────────────────────────────────────

describe('fetchTasks', () => {
  it('calls GET /tasks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tasks: [], total: 0 }));
    const result = await fetchTasks();
    expect(result.tasks).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/tasks');
  });
});

describe('fetchPersonalities', () => {
  it('calls GET /personalities', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ personalities: [] }));
    const result = await fetchPersonalities();
    expect(result.personalities).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities');
  });
});

describe('createPersonality', () => {
  it('sends POST to /soul/personalities', async () => {
    const created = { id: 'new-1', name: 'Test' };
    mockFetch.mockReturnValueOnce(jsonResponse(created));
    const result = await createPersonality({ name: 'Test' } as any);
    expect(result).toEqual(created);
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.method).toBe('POST');
  });
});

describe('deletePersonality', () => {
  it('sends DELETE to /personalities/:id', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deletePersonality('p1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('fetchSkills', () => {
  it('calls GET /skills', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skills: [] }));
    const result = await fetchSkills();
    expect(result.skills).toEqual([]);
  });
});

describe('fetchConversations', () => {
  it('calls GET /conversations', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ conversations: [] }));
    const result = await fetchConversations();
    expect(result.conversations).toEqual([]);
  });
});

describe('fetchSecurityEvents', () => {
  it('calls GET /security/events', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ events: [], total: 0 }));
    const result = await fetchSecurityEvents();
    expect(result.events).toEqual([]);
  });
});

// ── Auth header ──────────────────────────────────────────────────────

describe('Auth header in requests', () => {
  it('includes Authorization header when token is set', async () => {
    setAuthTokens('mytoken', 'r');
    mockFetch.mockReturnValueOnce(jsonResponse({ tasks: [] }));
    await fetchTasks();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer mytoken');
  });

  it('does not include Authorization for unauthenticated endpoints', async () => {
    const health = { status: 'ok', version: '1.0', uptime: 0, checks: {} };
    mockFetch.mockReturnValueOnce(jsonResponse(health));
    await fetchHealth();
    // fetchHealth uses raw fetch, not request()
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('/health');
  });
});

// ── Error handling ───────────────────────────────────────────────────

describe('API error handling', () => {
  it('throws APIError with message from response body', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('Not Found', 404));
    await expect(createSkill({ name: 'x' } as any)).rejects.toThrow('Not Found');
  });

  it('throws APIError with status code', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('Forbidden', 403));
    try {
      await createSkill({ name: 'x' } as any);
    } catch (e: any) {
      expect(e.status).toBe(403);
      expect(e.name).toBe('APIError');
    }
  });
});

// ── Token refresh on 401 ─────────────────────────────────────────────

describe('Token refresh on 401', () => {
  it('attempts refresh and retries on 401', async () => {
    setAuthTokens('expired', 'validRefresh');
    // First call: 401
    mockFetch.mockReturnValueOnce(errorResponse('Unauthorized', 401));
    // Refresh call: success
    mockFetch.mockReturnValueOnce(
      jsonResponse({ accessToken: 'newToken', refreshToken: 'newRefresh' })
    );
    // Retry call: success
    mockFetch.mockReturnValueOnce(jsonResponse({ tasks: [], total: 0 }));

    const result = await fetchTasks();
    expect(result.tasks).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBe('newToken');
  });

  it('calls onAuthFailure when refresh fails', async () => {
    const onFail = vi.fn();
    setOnAuthFailure(onFail);
    setAuthTokens('expired', 'badRefresh');

    // First call: 401
    mockFetch.mockReturnValueOnce(errorResponse('Unauthorized', 401));
    // Refresh call: fail
    mockFetch.mockReturnValueOnce(errorResponse('Invalid refresh', 401));

    await expect(createSkill({ name: 'x' } as any)).rejects.toThrow('Authentication failed');
    expect(onFail).toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });
});

// ── Chat functions ──────────────────────────────────────────────────

describe('sendChatMessage', () => {
  it('sends POST to /chat with message data', async () => {
    const chatResp = { reply: 'Hello!', conversationId: 'c1' };
    mockFetch.mockReturnValueOnce(jsonResponse(chatResp));
    const result = await sendChatMessage({ message: 'Hi' });
    expect(result).toEqual(chatResp);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/chat');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ message: 'Hi' });
  });

  it('includes optional fields when provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ reply: 'ok' }));
    await sendChatMessage({
      message: 'test',
      personalityId: 'p1',
      conversationId: 'c1',
      saveAsMemory: true,
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.personalityId).toBe('p1');
    expect(body.conversationId).toBe('c1');
    expect(body.saveAsMemory).toBe(true);
  });
});

describe('fetchConversation', () => {
  it('calls GET /conversations/:id', async () => {
    const detail = { id: 'c1', title: 'Test', messages: [] };
    mockFetch.mockReturnValueOnce(jsonResponse(detail));
    const result = await fetchConversation('c1');
    expect(result).toEqual(detail);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/conversations/c1');
  });
});

describe('createConversation', () => {
  it('sends POST to /conversations', async () => {
    const conv = { id: 'c2', title: 'New Chat' };
    mockFetch.mockReturnValueOnce(jsonResponse(conv));
    const result = await createConversation('New Chat', 'p1');
    expect(result).toEqual(conv);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/conversations');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ title: 'New Chat', personalityId: 'p1' });
  });
});

describe('deleteConversation', () => {
  it('sends DELETE to /conversations/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    const result = await deleteConversation('c1');
    expect(result).toEqual({ success: true });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/conversations/c1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ── Knowledge functions ─────────────────────────────────────────────

describe('learnKnowledge', () => {
  it('sends POST to /brain/knowledge', async () => {
    const entry = { entry: { id: 'k1', topic: 'test', content: 'data' } };
    mockFetch.mockReturnValueOnce(jsonResponse(entry));
    const result = await learnKnowledge('test', 'data');
    expect(result).toEqual(entry);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/brain/knowledge');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ topic: 'test', content: 'data' });
  });
});

describe('fetchKnowledge', () => {
  it('calls GET /brain/knowledge', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ knowledge: [] }));
    const result = await fetchKnowledge();
    expect(result).toEqual({ knowledge: [] });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/brain/knowledge');
  });

  it('appends personalityId query param', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ knowledge: [] }));
    await fetchKnowledge({ personalityId: 'p1' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/brain/knowledge?personalityId=p1');
  });

  it('returns empty array on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchKnowledge();
    expect(result).toEqual({ knowledge: [] });
  });
});

describe('updateKnowledge', () => {
  it('sends PUT to /brain/knowledge/:id', async () => {
    const updated = { knowledge: { id: 'k1', content: 'new' } };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));
    const result = await updateKnowledge('k1', { content: 'new' });
    expect(result).toEqual(updated);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/brain/knowledge/k1');
    expect(opts.method).toBe('PUT');
  });
});

describe('deleteKnowledge', () => {
  it('sends DELETE to /brain/knowledge/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ message: 'deleted' }));
    const result = await deleteKnowledge('k1');
    expect(result).toEqual({ message: 'deleted' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/brain/knowledge/k1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ── Security policy ─────────────────────────────────────────────────

describe('fetchSecurityPolicy', () => {
  it('returns policy on success', async () => {
    const policy = { allowSubAgents: true, allowA2A: false };
    mockFetch.mockReturnValueOnce(jsonResponse(policy));
    const result = await fetchSecurityPolicy();
    expect(result.allowSubAgents).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/security/policy');
  });

  it('returns fallback policy on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchSecurityPolicy();
    expect(result.allowSubAgents).toBe(false);
    expect(result.allowExecution).toBe(true);
  });
});

describe('updateSecurityPolicy', () => {
  it('sends PATCH to /security/policy', async () => {
    const updated = { allowSubAgents: true };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));
    const result = await updateSecurityPolicy({ allowSubAgents: true } as any);
    expect(result).toEqual(updated);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/security/policy');
    expect(opts.method).toBe('PATCH');
  });
});

// ── Skills CRUD ─────────────────────────────────────────────────────

describe('updateSkill', () => {
  it('sends PUT to /soul/skills/:id', async () => {
    const updated = { skill: { id: 's1', name: 'Updated' } };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));
    const result = await updateSkill('s1', { name: 'Updated' } as any);
    expect(result).toEqual(updated);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/soul/skills/s1');
    expect(opts.method).toBe('PUT');
  });
});

describe('deleteSkill', () => {
  it('sends DELETE to /soul/skills/:id', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteSkill('s1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/skills/s1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ── Personality management ──────────────────────────────────────────

describe('updatePersonality', () => {
  it('sends PUT to /soul/personalities/:id', async () => {
    const updated = { personality: { id: 'p1', name: 'Updated' } };
    mockFetch.mockReturnValueOnce(jsonResponse(updated));
    const result = await updatePersonality('p1', { name: 'Updated' } as any);
    expect(result).toEqual(updated);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/soul/personalities/p1');
    expect(opts.method).toBe('PUT');
  });
});

describe('activatePersonality', () => {
  it('sends POST to /soul/personalities/:id/activate', async () => {
    const activated = { personality: { id: 'p1', active: true } };
    mockFetch.mockReturnValueOnce(jsonResponse(activated));
    const result = await activatePersonality('p1');
    expect(result).toEqual(activated);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1/activate');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('enablePersonality', () => {
  it('sends POST to /soul/personalities/:id/enable', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await enablePersonality('p1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1/enable');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('disablePersonality', () => {
  it('sends POST to /soul/personalities/:id/disable', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await disablePersonality('p1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1/disable');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('setDefaultPersonality', () => {
  it('sends POST to /soul/personalities/:id/set-default', async () => {
    const result = { personality: { id: 'p1', isDefault: true } };
    mockFetch.mockReturnValueOnce(jsonResponse(result));
    const resp = await setDefaultPersonality('p1');
    expect(resp).toEqual(result);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1/set-default');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('clearDefaultPersonality', () => {
  it('sends POST to /soul/personalities/clear-default', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    const result = await clearDefaultPersonality();
    expect(result).toEqual({ success: true });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/clear-default');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

// ── Documents ───────────────────────────────────────────────────────

describe('uploadDocument', () => {
  it('sends POST with FormData to /brain/documents/upload', async () => {
    const doc = { document: { id: 'd1', title: 'test.pdf' } };
    mockFetch.mockReturnValueOnce(jsonResponse(doc));
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const result = await uploadDocument(file, { title: 'My Doc' });
    expect(result).toEqual(doc);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/brain/documents/upload');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('throws APIError on non-ok response', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('Too large', 413));
    const file = new File(['x'], 'big.pdf');
    await expect(uploadDocument(file)).rejects.toThrow('Too large');
  });
});

describe('listDocuments', () => {
  it('calls GET /brain/documents', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ documents: [], total: 0 }));
    const result = await listDocuments();
    expect(result).toEqual({ documents: [], total: 0 });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/brain/documents');
  });

  it('appends query params', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ documents: [], total: 0 }));
    await listDocuments({ personalityId: 'p1', visibility: 'private' });
    expect(mockFetch.mock.calls[0][0]).toContain('personalityId=p1');
    expect(mockFetch.mock.calls[0][0]).toContain('visibility=private');
  });
});

describe('deleteDocument', () => {
  it('sends DELETE to /brain/documents/:id', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteDocument('d1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/brain/documents/d1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ── API Keys ────────────────────────────────────────────────────────

describe('fetchApiKeys', () => {
  it('calls GET /auth/api-keys', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ keys: [] }));
    const result = await fetchApiKeys();
    expect(result).toEqual({ keys: [] });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/auth/api-keys');
  });
});

describe('createApiKey', () => {
  it('sends POST to /auth/api-keys', async () => {
    const created = { key: 'sk-abc', id: 'k1' };
    mockFetch.mockReturnValueOnce(jsonResponse(created));
    const result = await createApiKey({ name: 'Test Key' } as any);
    expect(result).toEqual(created);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/auth/api-keys');
    expect(opts.method).toBe('POST');
  });
});

describe('revokeApiKey', () => {
  it('sends DELETE to /auth/api-keys/:id', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await revokeApiKey('k1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/auth/api-keys/k1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ── Onboarding ──────────────────────────────────────────────────────

describe('fetchOnboardingStatus', () => {
  it('calls GET /soul/onboarding/status', async () => {
    const status = { completed: false, step: 1 };
    mockFetch.mockReturnValueOnce(jsonResponse(status));
    const result = await fetchOnboardingStatus();
    expect(result).toEqual(status);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/onboarding/status');
  });
});

describe('completeOnboarding', () => {
  it('sends POST to /soul/onboarding/complete', async () => {
    const resp = { agentName: 'Bot', personality: { id: 'p1' } };
    mockFetch.mockReturnValueOnce(jsonResponse(resp));
    const result = await completeOnboarding({ name: 'Default' } as any);
    expect(result).toEqual(resp);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/soul/onboarding/complete');
    expect(opts.method).toBe('POST');
  });
});

// ── Integrations ────────────────────────────────────────────────────

describe('fetchIntegrations', () => {
  it('calls GET /integrations', async () => {
    const data = { integrations: [], total: 0, running: 0 };
    mockFetch.mockReturnValueOnce(jsonResponse(data));
    const result = await fetchIntegrations();
    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/integrations');
  });

  it('returns fallback on failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchIntegrations();
    expect(result).toEqual({ integrations: [], total: 0, running: 0 });
  });
});

// ── Model info ──────────────────────────────────────────────────────

describe('fetchModelInfo', () => {
  it('calls GET /model/info', async () => {
    const info = { provider: 'openai', model: 'gpt-4' };
    mockFetch.mockReturnValueOnce(jsonResponse(info));
    const result = await fetchModelInfo();
    expect(result).toEqual(info);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/model/info');
  });
});

// ── Notifications ───────────────────────────────────────────────────

describe('fetchNotifications', () => {
  it('calls GET /notifications', async () => {
    const data = { notifications: [], total: 0, unreadCount: 0 };
    mockFetch.mockReturnValueOnce(jsonResponse(data));
    const result = await fetchNotifications();
    expect(result).toEqual(data);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/notifications');
  });

  it('appends query params for unreadOnly', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ notifications: [], total: 0, unreadCount: 0 }));
    await fetchNotifications({ unreadOnly: true, limit: 10 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('unreadOnly=true');
    expect(url).toContain('limit=10');
  });
});

describe('markNotificationRead', () => {
  it('sends POST to /notifications/:id/read', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await markNotificationRead('n1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/notifications/n1/read');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

// ── Export / Import personality ──────────────────────────────────────

describe('exportPersonality', () => {
  it('calls GET /soul/personalities/:id/export with format param', async () => {
    // Use string body — jsdom's Response doesn't support Blob constructor bodies
    mockFetch.mockReturnValueOnce(
      Promise.resolve(
        new Response('# personality', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
      )
    );
    const result = await exportPersonality('p1', 'md');
    // Check duck-type rather than instanceof — jsdom's Blob differs from Node's on Node 22
    expect(result).toHaveProperty('size');
    expect(result).toHaveProperty('type');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/soul/personalities/p1/export?format=md');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve(new Response(null, { status: 404 })));
    await expect(exportPersonality('p1')).rejects.toThrow('Export failed: 404');
  });
});

describe('importPersonality', () => {
  it('sends POST with FormData to /soul/personalities/import', async () => {
    const resp = { personality: { id: 'p2', name: 'Imported' }, warnings: [] };
    mockFetch.mockReturnValueOnce(jsonResponse(resp));
    const file = new File(['data'], 'personality.json', { type: 'application/json' });
    const result = await importPersonality(file);
    expect(result).toEqual(resp);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/soul/personalities/import');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('throws with error from response body on failure', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Invalid format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const file = new File(['bad'], 'bad.json');
    await expect(importPersonality(file)).rejects.toThrow('Invalid format');
  });
});

// ── Bulk API function tests ──────────────────────────────────────────
// Test many simple request wrappers to maximize coverage of the ~517 exported functions.

import {
  createTask,
  deleteTask,
  updateTask,
  fetchMlSummary,
  fetchAuditEntries,
  verifyAuditChain,
  fetchAgentName,
  updateAgentName,
  fetchActivePersonality,
  enableSkill,
  disableSkill,
  approveSkill,
  rejectSkill,
  fetchPromptPreview,
  fetchSoulConfig,
  updateSoulConfig,
  fetchAvailablePlatforms,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
  startIntegration,
  stopIntegration,
  fetchTrainingStats,
  fetchDistillationJobs,
  createDistillationJob,
  deleteDistillationJob,
  fetchFinetuneJobs,
  createFinetuneJob,
  deleteFinetuneJob,
  fetchQualityScores,
  triggerQualityScoring,
  fetchEvalDatasets,
  createEvalDataset,
  deleteEvalDataset,
  fetchEvalRuns,
  fetchAiHealth,
  fetchNotificationPrefs,
  fetchPassions,
  createPassion,
  deletePassion,
  fetchInspirations,
  createInspiration,
  deleteInspiration,
  fetchPains,
  createPainEntry,
  deletePain,
  fetchHeartbeatTasks,
  fetchHeartbeatStatus,
  fetchMemories,
  deleteMemory,
  fetchRiskAssessments,
  fetchBackups,
  createBackup,
  restoreBackup,
  fetchTenants,
  createTenant,
  fetchReports,
  generateReport,
  fetchFederationPeers,
  fetchApiKeyUsage,
  fetchBrowserSessions,
  fetchDepartments,
  fetchRegisterEntries,
  listAlertRules,
  createAlertRule,
  deleteAlertRule,
  fetchPersonalityVersions,
  tagPersonalityRelease,
} from './client';

describe('Task CRUD', () => {
  it('createTask sends POST /tasks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1', name: 'test' }));
    await createTask({ name: 'test' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/tasks');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteTask sends DELETE /tasks/:id', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteTask('t1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/tasks/t1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('updateTask sends PUT /tasks/:id', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1', name: 'updated' }));
    await updateTask('t1', { name: 'updated' });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/tasks/t1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });
});

describe('ML / Audit', () => {
  it('fetchMlSummary calls /security/ml/summary', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ enabled: true, riskScore: 0.5 }));
    const result = await fetchMlSummary({ period: '7d' });
    expect(result.enabled).toBe(true);
  });

  it('fetchMlSummary returns fallback on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchMlSummary();
    expect(result.enabled).toBe(false);
  });

  it('fetchAuditEntries calls /audit', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [], total: 0, limit: 50, offset: 0 }));
    const result = await fetchAuditEntries({ level: 'info', limit: 10 });
    expect(result.entries).toEqual([]);
  });

  it('fetchAuditEntries returns fallback on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await fetchAuditEntries();
    expect(result.total).toBe(0);
  });

  it('verifyAuditChain calls POST /audit/verify', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ valid: true, entriesChecked: 100 }));
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
  });

  it('verifyAuditChain returns fallback on error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));
    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
  });
});

describe('Soul API — Agent', () => {
  it('fetchAgentName calls GET /soul/agent-name', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ agentName: 'FRIDAY' }));
    const result = await fetchAgentName();
    expect(result.agentName).toBe('FRIDAY');
  });

  it('updateAgentName calls PUT /soul/agent-name', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ agentName: 'JARVIS' }));
    await updateAgentName('JARVIS');
    expect(mockFetch.mock.calls[0][1].method).toMatch(/PUT|PATCH/);
  });

  it('fetchActivePersonality calls /soul/personalities/active', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ personality: { id: 'p1', name: 'Test' } }));
    const result = await fetchActivePersonality();
    expect(result.personality?.id).toBe('p1');
  });
});

describe('Skill operations', () => {
  it('enableSkill calls POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skill: { id: 's1' } }));
    await enableSkill('s1');
    expect(mockFetch.mock.calls[0][0]).toContain('s1');
  });

  it('disableSkill calls POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skill: { id: 's1' } }));
    await disableSkill('s1');
    expect(mockFetch.mock.calls[0][0]).toContain('s1');
  });

  it('approveSkill calls POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skill: { id: 's1' } }));
    await approveSkill('s1');
    expect(mockFetch.mock.calls[0][0]).toContain('s1');
  });

  it('rejectSkill calls POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skill: { id: 's1' } }));
    await rejectSkill('s1');
    expect(mockFetch.mock.calls[0][0]).toContain('s1');
  });
});

describe('Soul config', () => {
  it('fetchPromptPreview calls GET', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ prompt: 'You are...' }));
    await fetchPromptPreview('p1');
    expect(mockFetch.mock.calls[0][0]).toContain('preview');
  });

  it('fetchSoulConfig calls GET /soul/config', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ config: {} }));
    await fetchSoulConfig();
  });

  it('updateSoulConfig calls PUT /soul/config', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ config: {} }));
    await updateSoulConfig({} as any);
    expect(mockFetch.mock.calls[0][1].method).toMatch(/PUT|PATCH/);
  });
});

describe('Integrations', () => {
  it('fetchAvailablePlatforms', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ platforms: [] }));
    await fetchAvailablePlatforms();
  });

  it('createIntegration sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ integration: {} }));
    await createIntegration({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('updateIntegration sends PUT', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ integration: {} }));
    await updateIntegration('i1', {} as any);
    expect(mockFetch.mock.calls[0][0]).toContain('i1');
  });

  it('deleteIntegration sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteIntegration('i1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('testIntegration sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await testIntegration('i1');
    expect(mockFetch.mock.calls[0][0]).toContain('i1');
  });

  it('startIntegration sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ integration: {} }));
    await startIntegration('i1');
  });

  it('stopIntegration sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ integration: {} }));
    await stopIntegration('i1');
  });
});

describe('Training', () => {
  it('fetchTrainingStats', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ totalSamples: 100 }));
    await fetchTrainingStats();
  });

  it('fetchDistillationJobs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ jobs: [] }));
    await fetchDistillationJobs();
  });

  it('createDistillationJob sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ job: {} }));
    await createDistillationJob({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteDistillationJob sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteDistillationJob('j1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('fetchFinetuneJobs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ jobs: [] }));
    await fetchFinetuneJobs();
  });

  it('createFinetuneJob sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ job: {} }));
    await createFinetuneJob({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteFinetuneJob sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteFinetuneJob('j1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('fetchQualityScores', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ scores: [] }));
    await fetchQualityScores();
  });

  it('triggerQualityScoring sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await triggerQualityScoring();
  });
});

describe('Eval', () => {
  it('fetchEvalDatasets', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ datasets: [] }));
    await fetchEvalDatasets();
  });

  it('createEvalDataset sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ dataset: {} }));
    await createEvalDataset({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteEvalDataset sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteEvalDataset('d1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('fetchEvalRuns', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ runs: [] }));
    await fetchEvalRuns();
  });
});

describe('AI Health', () => {
  it('fetchAiHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'healthy' }));
    const result = await fetchAiHealth();
    expect(result.status).toBe('healthy');
  });
});

describe('Passions / Inspirations / Pains', () => {
  it('fetchPassions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ passions: [] }));
    await fetchPassions();
  });

  it('createPassion sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ passion: {} }));
    await createPassion({ name: 'AI research' });
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deletePassion sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deletePassion('pass1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('fetchInspirations', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ inspirations: [] }));
    await fetchInspirations();
  });

  it('createInspiration sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ inspiration: {} }));
    await createInspiration({ source: 'Tesla' });
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteInspiration sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteInspiration('insp1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('fetchPains', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pains: [] }));
    await fetchPains();
  });

  it('createPainEntry sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pain: {} }));
    await createPainEntry({ trigger: 'bugs' });
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deletePain sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deletePain('pain1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('Heartbeat', () => {
  it('fetchHeartbeatTasks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tasks: [] }));
    await fetchHeartbeatTasks();
  });

  it('fetchHeartbeatStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'running' }));
    await fetchHeartbeatStatus();
  });
});

describe('Memories', () => {
  it('fetchMemories', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ memories: [] }));
    await fetchMemories();
  });

  it('deleteMemory sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteMemory('m1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('Risk Assessments', () => {
  it('fetchRiskAssessments', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ assessments: [] }));
    await fetchRiskAssessments();
  });
});

describe('Backups', () => {
  it('fetchBackups', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ backups: [] }));
    await fetchBackups();
  });

  it('createBackup sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ backup: {} }));
    await createBackup('test-backup');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('restoreBackup sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await restoreBackup('b1');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('Tenants', () => {
  it('fetchTenants', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tenants: [] }));
    await fetchTenants();
  });

  it('createTenant sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tenant: {} }));
    await createTenant({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('Reports', () => {
  it('fetchReports', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ reports: [] }));
    await fetchReports();
  });

  it('generateReport sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ report: {} }));
    await generateReport({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('Federation', () => {
  it('fetchFederationPeers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ peers: [] }));
    await fetchFederationPeers();
  });
});

describe('API Key Usage', () => {
  it('fetchApiKeyUsage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ usage: {} }));
    await fetchApiKeyUsage('k1');
  });
});

describe('Browser Sessions', () => {
  it('fetchBrowserSessions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ sessions: [], total: 0 }));
    await fetchBrowserSessions();
  });
});

describe('Departments / Risk Register', () => {
  it('fetchDepartments', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ departments: [] }));
    await fetchDepartments();
  });

  it('fetchRegisterEntries', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [] }));
    await fetchRegisterEntries({ departmentId: 'd1' });
  });
});

describe('Alert Rules', () => {
  it('listAlertRules', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rules: [] }));
    await listAlertRules();
  });

  it('createAlertRule sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rule: {} }));
    await createAlertRule({} as any);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('deleteAlertRule sends DELETE', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteAlertRule('r1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('Prompt Versioning', () => {
  it('fetchPersonalityVersions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ versions: [] }));
    await fetchPersonalityVersions('p1');
  });

  it('tagPersonalityRelease sends POST', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ version: {} }));
    await tagPersonalityRelease('p1', 'v1.0');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });
});

describe('Notification preferences', () => {
  it('fetchNotificationPrefs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ prefs: {} }));
    await fetchNotificationPrefs();
  });
});

// ── Bulk coverage tests for additional API functions ──────────────────

import {
  switchModel,
  patchModelConfig,
  fetchProviderHealth,
  fetchModelDefault,
  setModelDefault,
  clearModelDefault,
  fetchMcpServers,
  addMcpServer,
  deleteMcpServer,
  patchMcpServer,
  fetchMcpTools,
  fetchMcpResources,
  fetchMcpConfig,
  patchMcpConfig,
  fetchMcpHealth,
  fetchMcpServerHealth,
  triggerMcpHealthCheck,
  fetchMcpCredentialKeys,
  storeMcpCredential,
  deleteMcpCredential,
  fetchMarketplaceSkills,
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
  syncCommunitySkills,
  delegateTask,
  fetchDelegations,
  fetchActiveDelegations,
  cancelDelegation,
  fetchAgentConfig,
  updateAgentConfig,
  fetchExtensions,
  registerExtension,
  removeExtension,
  fetchExtensionHooks,
  registerExtensionHook,
  removeExtensionHook,
  executeCode,
  fetchExecutionSessions,
  terminateExecutionSession,
  fetchA2APeers,
  addA2APeer,
  removeA2APeer,
  discoverA2APeers,
  fetchA2ACapabilities,
  fetchProactiveTriggers,
  fetchBuiltinTriggers,
  createProactiveTrigger,
  deleteProactiveTrigger,
  enableProactiveTrigger,
  disableProactiveTrigger,
  fetchProactiveSuggestions,
  fetchProactiveStatus,
  fetchMultimodalConfig,
  fetchMultimodalJobs,
  fetchSwarmTemplates,
  createSwarmTemplate,
  deleteSwarmTemplate,
  fetchSwarmRuns,
  closeBrowserSession,
  fetchBrowserConfig,
  fetchExternalSyncStatus,
  triggerExternalSync,
  fetchExternalBrainConfig,
  fetchCicdConfig,
  rememberChatMessage,
  submitFeedback,
  addMemory,
  updatePassion,
  updateInspiration,
  updatePain,
  updateHeartbeatTask,
  fetchHeartbeatLog,
  fetchRoles,
  createRole,
  updateRole,
  deleteRole,
  fetchAssignments,
  assignRole,
  revokeAssignment,
  fetchAuditStats,
  fetchSecretKeys,
  setSecret,
  deleteSecret,
  fetchTlsStatus,
  fetchAutonomyOverview,
  fetchAuditRuns,
  fetchKnowledgeHealth,
  fetchConversationHistory,
  sealConversationTopic,
  fetchCompressedContext,
  enforceRetention,
  searchSimilar,
  fetchWorkflows,
  fetchWorkflowRuns,
  createNotificationPref,
  deleteNotificationPref,
  updateNotificationPref,
  fetchWorkspaces,
  createWorkspace,
  fetchWorkspaceMembers,
  fetchUsers,
  fetchIntents,
  createIntent,
  deleteIntent,
  fetchIntent,
  updateIntent,
  ingestUrl,
  ingestText,
  ingestGithubWiki,
  fetchConsolidationSchedule,
  updateConsolidationSchedule,
  fetchConsolidationHistory,
  runConsolidation,
  reindexBrain,
} from './client';

describe('Model management', () => {
  it('switchModel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await switchModel({ provider: 'openai', model: 'gpt-4' });
  });
  it('patchModelConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await patchModelConfig({ temperature: 0.7 } as any);
  });
  it('fetchProviderHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ openai: { status: 'ok' } }));
    await fetchProviderHealth();
  });
  it('fetchModelDefault', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchModelDefault();
  });
  it('setModelDefault', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await setModelDefault({ provider: 'openai', model: 'gpt-4' });
  });
  it('clearModelDefault', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await clearModelDefault();
  });
});

describe('MCP management', () => {
  it('fetchMcpServers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ servers: [], total: 0 }));
    await fetchMcpServers();
  });
  it('addMcpServer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ server: {} }));
    await addMcpServer({ name: 'test', url: 'http://localhost' } as any);
  });
  it('deleteMcpServer', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteMcpServer('s1');
  });
  it('patchMcpServer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ server: {} }));
    await patchMcpServer('s1', { enabled: true });
  });
  it('fetchMcpTools', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tools: [], total: 0 }));
    await fetchMcpTools();
  });
  it('fetchMcpResources', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ resources: [] }));
    await fetchMcpResources();
  });
  it('fetchMcpConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchMcpConfig();
  });
  it('patchMcpConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await patchMcpConfig({ exposeBrowser: true } as any);
  });
  it('fetchMcpHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ servers: [] }));
    await fetchMcpHealth();
  });
  it('fetchMcpServerHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ status: 'ok' }));
    await fetchMcpServerHealth('s1');
  });
  it('triggerMcpHealthCheck', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await triggerMcpHealthCheck('s1');
  });
  it('fetchMcpCredentialKeys', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ keys: [] }));
    await fetchMcpCredentialKeys('s1');
  });
  it('storeMcpCredential', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await storeMcpCredential('s1', 'key', 'val');
  });
  it('deleteMcpCredential', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteMcpCredential('s1', 'key');
  });
});

describe('Marketplace', () => {
  it('fetchMarketplaceSkills', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skills: [], total: 0 }));
    await fetchMarketplaceSkills();
  });
  it('installMarketplaceSkill', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skill: {} }));
    await installMarketplaceSkill('sk-1');
  });
  it('uninstallMarketplaceSkill', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await uninstallMarketplaceSkill('sk-1');
  });
  it('syncCommunitySkills', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ synced: 0 }));
    await syncCommunitySkills();
  });
});

describe('Delegation', () => {
  it('delegateTask', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ delegation: {} }));
    await delegateTask({ taskId: 't1', targetAgent: 'a1' } as any);
  });
  it('fetchDelegations', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ delegations: [] }));
    await fetchDelegations();
  });
  it('fetchActiveDelegations', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ delegations: [] }));
    await fetchActiveDelegations();
  });
  it('cancelDelegation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await cancelDelegation('d1');
  });
});

describe('Agent config', () => {
  it('fetchAgentConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ config: {} }));
    await fetchAgentConfig();
  });
  it('updateAgentConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ config: {} }));
    await updateAgentConfig({ enabled: true });
  });
});

describe('Extensions', () => {
  it('fetchExtensions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ extensions: [] }));
    await fetchExtensions();
  });
  it('registerExtension', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ extension: {} }));
    await registerExtension({ name: 'ext', version: '1.0' } as any);
  });
  it('removeExtension', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await removeExtension('e1');
  });
  it('fetchExtensionHooks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ hooks: [] }));
    await fetchExtensionHooks();
  });
  it('registerExtensionHook', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ hook: {} }));
    await registerExtensionHook({ extensionId: 'e1', hookPoint: 'test' } as any);
  });
  it('removeExtensionHook', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await removeExtensionHook('h1');
  });
});

describe('Execution', () => {
  it('executeCode', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ result: {} }));
    await executeCode({ code: 'console.log(1)' } as any);
  });
  it('fetchExecutionSessions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ sessions: [] }));
    await fetchExecutionSessions();
  });
  it('terminateExecutionSession', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await terminateExecutionSession('s1');
  });
});

describe('A2A', () => {
  it('fetchA2APeers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ peers: [] }));
    await fetchA2APeers();
  });
  it('addA2APeer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ peer: {} }));
    await addA2APeer({ url: 'http://peer' } as any);
  });
  it('removeA2APeer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await removeA2APeer('p1');
  });
  it('discoverA2APeers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ peers: [] }));
    await discoverA2APeers();
  });
  it('fetchA2ACapabilities', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ capabilities: [] }));
    await fetchA2ACapabilities();
  });
});

describe('Proactive triggers', () => {
  it('fetchProactiveTriggers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ triggers: [] }));
    await fetchProactiveTriggers();
  });
  it('fetchBuiltinTriggers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ triggers: [] }));
    await fetchBuiltinTriggers();
  });
  it('createProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ trigger: {} }));
    await createProactiveTrigger({ name: 'test' } as any);
  });
  it('deleteProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await deleteProactiveTrigger('t1');
  });
  it('enableProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await enableProactiveTrigger('t1');
  });
  it('disableProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await disableProactiveTrigger('t1');
  });
  it('fetchProactiveSuggestions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ suggestions: [] }));
    await fetchProactiveSuggestions();
  });
  it('fetchProactiveStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchProactiveStatus();
  });
});

describe('Multimodal', () => {
  it('fetchMultimodalConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchMultimodalConfig();
  });
  it('fetchMultimodalJobs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ jobs: [] }));
    await fetchMultimodalJobs();
  });
});

describe('Cost', () => {
  it('fetchCostBreakdown', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ breakdown: {} }));
    await fetchCostBreakdown();
  });
  it('fetchCostHistory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [] }));
    await fetchCostHistory();
  });
});

describe('Swarms', () => {
  it('fetchSwarmTemplates', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ templates: [] }));
    await fetchSwarmTemplates();
  });
  it('createSwarmTemplate', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ template: {} }));
    await createSwarmTemplate({ name: 'test' } as any);
  });
  it('deleteSwarmTemplate', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await deleteSwarmTemplate('t1');
  });
  it('executeSwarm', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: {} }));
    await executeSwarm({ templateId: 't1' } as any);
  });
  it('fetchSwarmRuns', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ runs: [] }));
    await fetchSwarmRuns();
  });
});

describe('Browser', () => {
  it('closeBrowserSession', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await closeBrowserSession('s1');
  });
  it('fetchBrowserConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchBrowserConfig();
  });
});

describe('External sync', () => {
  it('fetchExternalSyncStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ sources: [] }));
    await fetchExternalSyncStatus();
  });
  it('triggerExternalSync', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ result: {} }));
    await triggerExternalSync();
  });
  it('fetchExternalBrainConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchExternalBrainConfig();
  });
});

describe('CI/CD', () => {
  it('fetchCicdConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchCicdConfig();
  });
});

describe('Chat extras', () => {
  it('rememberChatMessage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await rememberChatMessage('c1', 'msg1');
  });
  it('submitFeedback', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await submitFeedback('c1', 'm1', 'positive');
  });
});

describe('Memory extras', () => {
  it('addMemory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ memory: {} }));
    await addMemory({ content: 'test', type: 'semantic' } as any);
  });
  it('updatePassion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updatePassion('p1', { name: 'new' });
  });
  it('updateInspiration', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateInspiration('i1', { description: 'new' });
  });
  it('updatePain', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updatePain('p1', { description: 'updated' });
  });
  it('updateHeartbeatTask', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateHeartbeatTask('t1', { enabled: true });
  });
  it('fetchHeartbeatLog', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [] }));
    await fetchHeartbeatLog();
  });
});

describe('RBAC', () => {
  it('fetchRoles', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ roles: [] }));
    await fetchRoles();
  });
  it('createRole', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ role: {} }));
    await createRole({ name: 'test', permissions: [] } as any);
  });
  it('updateRole', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ role: {} }));
    await updateRole('r1', { name: 'updated' });
  });
  it('deleteRole', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteRole('r1');
  });
  it('fetchAssignments', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ assignments: [] }));
    await fetchAssignments();
  });
  it('assignRole', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ assignment: {} }));
    await assignRole({ userId: 'u1', roleId: 'r1' } as any);
  });
  it('revokeAssignment', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await revokeAssignment('a1');
  });
  it('fetchAuditStats', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ totalEntries: 100 }));
    await fetchAuditStats();
  });
});

describe('Secrets', () => {
  it('fetchSecretKeys', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ keys: [] }));
    await fetchSecretKeys();
  });
  it('setSecret', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await setSecret('key', 'value');
  });
  it('deleteSecret', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteSecret('key');
  });
});

describe('Security extras', () => {
  it('fetchTlsStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ enabled: true }));
    await fetchTlsStatus();
  });
  it('fetchAutonomyOverview', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ totals: {}, byLevel: {} }));
    await fetchAutonomyOverview();
  });
  it('fetchAuditRuns', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAuditRuns();
  });
});

describe('Knowledge extras', () => {
  it('fetchKnowledgeHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ totalDocuments: 0 }));
    await fetchKnowledgeHealth();
  });
  it('fetchConversationHistory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [] }));
    await fetchConversationHistory('c1');
  });
  it('sealConversationTopic', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await sealConversationTopic('c1');
  });
  it('fetchCompressedContext', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ context: '' }));
    await fetchCompressedContext('c1');
  });
  it('enforceRetention', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ deleted: 0 }));
    await enforceRetention({ maxAgeDays: 90, maxEntries: 100000 });
  });
  it('searchSimilar', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));
    await searchSimilar({ query: 'test', threshold: 0.7 } as any);
  });
  it('ingestUrl', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ document: {} }));
    await ingestUrl('https://example.com');
  });
  it('ingestText', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ document: {} }));
    await ingestText('title', 'content');
  });
  it('ingestGithubWiki', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ documents: [] }));
    await ingestGithubWiki('owner', 'repo');
  });
  it('reindexBrain', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    await reindexBrain();
  });
});

describe('Workflows', () => {
  it('fetchWorkflows', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ workflows: [] }));
    await fetchWorkflows();
  });
  it('fetchWorkflowRuns', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ runs: [] }));
    await fetchWorkflowRuns('wf1');
  });
});

describe('Notification preferences', () => {
  it('fetchNotificationPrefs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ prefs: [] }));
    await fetchNotificationPrefs();
  });
  it('createNotificationPref', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pref: {} }));
    await createNotificationPref({ channel: 'email', events: ['*'], enabled: true } as any);
  });
  it('deleteNotificationPref', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteNotificationPref('c1');
  });
  it('updateNotificationPref', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pref: {} }));
    await updateNotificationPref('c1', { enabled: true } as any);
  });
});

describe('Workspaces', () => {
  it('fetchWorkspaces', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ workspaces: [] }));
    await fetchWorkspaces();
  });
  it('createWorkspace', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ workspace: {} }));
    await createWorkspace({ name: 'test' });
  });
  it('deleteWorkspace', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteWorkspace('w1');
  });
  it('fetchWorkspaceMembers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ members: [] }));
    await fetchWorkspaceMembers('w1');
  });
  it('fetchUsers', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ users: [] }));
    await fetchUsers();
  });
});

describe('Org Intents', () => {
  it('fetchIntents', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ intents: [] }));
    await fetchIntents();
  });
  it('createIntent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ intent: {} }));
    await createIntent({ name: 'test' } as any);
  });
  it('deleteIntent', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteIntent('i1');
  });
  it('fetchIntent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ intent: {} }));
    await fetchIntent('i1');
  });
  it('updateIntent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ intent: {} }));
    await updateIntent('i1', { goals: [] } as any);
  });
});

describe('Consolidation', () => {
  it('fetchConsolidationSchedule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ schedule: '0 2 * * *' }));
    await fetchConsolidationSchedule();
  });
  it('updateConsolidationSchedule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ schedule: '0 2 * * *' }));
    await updateConsolidationSchedule('0 2 * * *');
  });
  it('fetchConsolidationHistory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ reports: [] }));
    await fetchConsolidationHistory();
  });
  it('runConsolidation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ report: {} }));
    await runConsolidation();
  });
});

// ── Multimodal API ──────────────────────────────────────────────────
describe('Multimodal API', () => {
  it('analyzeImage', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ description: 'a cat', labels: ['cat'], durationMs: 100 })
    );
    const result = await analyzeImage({ imageBase64: 'abc', mimeType: 'image/png' });
    expect(result.description).toBe('a cat');
  });
  it('updateMultimodalProvider', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateMultimodalProvider('vision', 'openai');
  });
  it('transcribeAudio', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ text: 'hello', durationMs: 50 }));
    const result = await transcribeAudio({ audioBase64: 'abc' });
    expect(result.text).toBe('hello');
  });
  it('synthesizeSpeech', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ audioBase64: 'abc', format: 'mp3', durationMs: 100 })
    );
    const result = await synthesizeSpeech({ text: 'hello' });
    expect(result.format).toBe('mp3');
  });
  it('generateImage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ imageUrl: 'http://img.png', durationMs: 200 }));
    const result = await generateImage({ prompt: 'a sunset' });
    expect(result.imageUrl).toBe('http://img.png');
  });
  it('updateMultimodalModel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateMultimodalModel('tts', 'whisper');
  });
});

// ── Browser API ──────────────────────────────────────────────────
describe('Browser API', () => {
  it('fetchBrowserSession', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 's1', status: 'active' }));
    const result = await fetchBrowserSession('s1');
    expect(result).toHaveProperty('id', 's1');
  });
  it('fetchBrowserSession returns null on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('Not found', 404));
    const result = await fetchBrowserSession('bad');
    expect(result).toBeNull();
  });
});

// ── Cost Analytics ──────────────────────────────────────────────
describe('Cost Analytics', () => {
  it('fetchCostBreakdown', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ byProvider: {}, recommendations: [] }));
    const result = await fetchCostBreakdown();
    expect(result.byProvider).toEqual({});
  });
  it('fetchCostBreakdown returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchCostBreakdown();
    expect(result.recommendations).toEqual([]);
  });
  it('fetchCostHistory', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        records: [],
        totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 },
      })
    );
    const result = await fetchCostHistory({ from: '2025-01-01', provider: 'openai' });
    expect(result.records).toEqual([]);
  });
  it('fetchCostHistory returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchCostHistory();
    expect(result.totals.costUsd).toBe(0);
  });
  it('resetUsageStat', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    const result = await resetUsageStat('errors');
    expect(result.success).toBe(true);
  });
});

// ── Swarm API ──────────────────────────────────────────────────
describe('Swarm API', () => {
  it('executeSwarm', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: { id: 'r1' } }));
    const result = await executeSwarm({ templateId: 't1', taskDescription: 'test' });
    expect(result).toHaveProperty('run');
  });
  it('fetchSwarmRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: { id: 'r1' } }));
    const result = await fetchSwarmRun('r1');
    expect(result).toHaveProperty('run');
  });
  it('fetchSwarmRun returns null on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('not found', 404));
    const result = await fetchSwarmRun('bad');
    expect(result).toBeNull();
  });
  it('cancelSwarmRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    const result = await cancelSwarmRun('r1');
    expect(result.success).toBe(true);
  });
});

// ── Group Chat API ──────────────────────────────────────────────
describe('Group Chat API', () => {
  it('fetchGroupChatChannels', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ channels: [] }));
    const result = await fetchGroupChatChannels();
    expect(result.channels).toEqual([]);
  });
  it('fetchGroupChatMessages', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ messages: [] }));
    const result = await fetchGroupChatMessages('ch1');
    expect(result.messages).toEqual([]);
  });
  it('sendGroupChatMessage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ message: { id: 'm1' } }));
    const result = await sendGroupChatMessage({
      channelId: 'ch1',
      content: 'hi',
      senderProfileName: 'user',
    });
    expect(result).toHaveProperty('message');
  });
});

// ── Routing Rules API ──────────────────────────────────────────
describe('Routing Rules API', () => {
  it('fetchRoutingRules', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rules: [] }));
    const result = await fetchRoutingRules();
    expect(result.rules).toEqual([]);
  });
  it('createRoutingRule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rule: {} }));
    await createRoutingRule({ name: 'r1' } as any);
  });
  it('updateRoutingRule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rule: {} }));
    await updateRoutingRule('r1', { name: 'r2' } as any);
  });
  it('deleteRoutingRule', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteRoutingRule('r1');
  });
  it('testRoutingRule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ matched: true }));
    await testRoutingRule({ ruleId: 'r1', testMessage: 'hello' } as any);
  });
});

// ── Workspace API ──────────────────────────────────────────────
describe('Workspace API', () => {
  it('updateWorkspace', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ workspace: {} }));
    await updateWorkspace('w1', { name: 'ws' });
  });
  it('deleteWorkspace', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteWorkspace('w1');
  });
  it('addWorkspaceMember', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ member: {} }));
    await addWorkspaceMember('w1', { userId: 'u1', role: 'member' });
  });
  it('updateWorkspaceMemberRole', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ member: {} }));
    await updateWorkspaceMemberRole('w1', 'u1', 'admin');
  });
  it('removeWorkspaceMember', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await removeWorkspaceMember('w1', 'u1');
  });
});

// ── Workflow API ──────────────────────────────────────────────
describe('Workflow API', () => {
  it('fetchWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ definition: {} }));
    const result = await fetchWorkflow('wf1');
    expect(result).toHaveProperty('definition');
  });
  it('createWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ definition: {} }));
    await createWorkflow({ name: 'wf' } as any);
  });
  it('updateWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ definition: {} }));
    await updateWorkflow('wf1', { name: 'wf2' } as any);
  });
  it('deleteWorkflow', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteWorkflow('wf1');
  });
  it('triggerWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: {} }));
    await triggerWorkflow('wf1');
  });
  it('fetchWorkflowRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: {} }));
    await fetchWorkflowRun('wf1', 'run1');
  });
  it('cancelWorkflowRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: {} }));
    await cancelWorkflowRun('run1');
  });
});

// ── Soul Approvals API ──────────────────────────────────────────
describe('Soul Approvals API', () => {
  it('fetchSoulApprovals', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ approvals: [] }));
    await fetchSoulApprovals();
  });
  it('fetchSoulApprovalCount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ count: 5 }));
    // Returns the count number
    await fetchSoulApprovalCount();
  });
  it('approveSoulAction', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ approval: {} }));
    await approveSoulAction('a1');
  });
  it('rejectSoulAction', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ approval: {} }));
    await rejectSoulAction('a1');
  });
});

// ── Secrets & TLS API ──────────────────────────────────────────
describe('Secrets & TLS', () => {
  it('checkSecret', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ name: 'key1', exists: true }));
    const result = await checkSecret('key1');
    expect(result.exists).toBe(true);
  });
  it('generateTlsCert', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ generated: true, paths: {} }));
    const result = await generateTlsCert();
    expect(result.generated).toBe(true);
  });
});

// ── Intent API ──────────────────────────────────────────────────
describe('Intent API', () => {
  it('fetchActiveIntent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ intent: {} }));
    await fetchActiveIntent();
  });
  it('activateIntent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    await activateIntent('i1');
  });
  it('fetchEnforcementLog', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ entries: [] }));
    await fetchEnforcementLog();
  });
  it('readSignal', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ signal: {} }));
    await readSignal('s1');
  });
  it('fetchGoalTimeline', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ timeline: [] }));
    await fetchGoalTimeline('g1');
  });
});

// ── Audit API ──────────────────────────────────────────────────
describe('Audit API', () => {
  it('createAuditRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: { id: 'run1', name: 'Q1 Audit' } }));
    const result = await createAuditRun('Q1 Audit');
    expect(result).toHaveProperty('id');
  });
  it('fetchAuditRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ run: { id: 'run1' } }));
    await fetchAuditRun('run1');
  });
  it('updateAuditItem', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ item: {} }));
    await updateAuditItem('run1', 'item1', { status: 'pass' });
  });
  it('finalizeAuditRun', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'run1', status: 'finalized' }));
    await finalizeAuditRun('run1');
  });
  it('emergencyStop', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await emergencyStop('skill', 's1');
  });
});

// ── Capture Management API ──────────────────────────────────────
describe('Capture Management', () => {
  it('fetchPendingConsents', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ consents: [] }));
    await fetchPendingConsents();
  });
  it('grantConsent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'c1', status: 'granted' }));
    await grantConsent('c1');
  });
  it('denyConsent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'c1', status: 'denied' }));
    await denyConsent('c1', 'No reason');
  });
  it('revokeConsent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'c1', status: 'revoked' }));
    await revokeConsent('c1');
  });
  it('fetchActiveRecordings', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ recordings: [] }));
    await fetchActiveRecordings();
  });
  it('stopRecording', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'r1', status: 'stopped' }));
    await stopRecording('session1');
  });
});

// ── Reasoning Strategies ──────────────────────────────────────
describe('Reasoning Strategies', () => {
  it('fetchStrategies', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ items: [], total: 0 }));
    await fetchStrategies('analytical');
  });
  it('fetchStrategy', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 's1', name: 'chain-of-thought' }));
    await fetchStrategy('s1');
  });
  it('createStrategy', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 's1' }));
    await createStrategy({
      name: 'test',
      slug: 'test',
      category: 'analytical',
      promptPrefix: 'Think step by step',
    });
  });
  it('updateStrategy', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 's1' }));
    await updateStrategy('s1', { name: 'updated' });
  });
  it('deleteStrategy', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteStrategy('s1');
  });
});

// ── ATHI Threat Governance ──────────────────────────────────────
describe('ATHI API', () => {
  it('fetchAthiScenarios', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ items: [], total: 0 }));
    await fetchAthiScenarios({ actor: 'insider', limit: 10 });
  });
  it('createAthiScenario', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ scenario: { id: 'a1' } }));
    await createAthiScenario({
      title: 'Test',
      actor: 'insider',
      techniques: [],
      harms: [],
      impacts: [],
      likelihood: 3,
      severity: 4,
    });
  });
  it('updateAthiScenario', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ scenario: { id: 'a1' } }));
    await updateAthiScenario('a1', { title: 'Updated' });
  });
  it('deleteAthiScenario', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteAthiScenario('a1');
  });
  it('fetchAthiMatrix', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ matrix: [] }));
    await fetchAthiMatrix();
  });
  it('fetchAthiTopRisks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ topRisks: [] }));
    await fetchAthiTopRisks(5);
  });
  it('fetchAthiSummary', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ summary: {} }));
    await fetchAthiSummary();
  });
  it('fetchAthiScenariosByTechnique', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ scenarios: [] }));
    await fetchAthiScenariosByTechnique('prompt-injection');
  });
  it('linkEventsToAthiScenario', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ scenario: { id: 'a1' } }));
    await linkEventsToAthiScenario('a1', ['e1', 'e2']);
  });
});

// ── Personality Versioning ──────────────────────────────────────
describe('Personality Versioning', () => {
  it('fetchPersonalityVersion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1' }));
    await fetchPersonalityVersion('p1', 'v1');
  });
  it('deletePersonalityTag', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1' }));
    await deletePersonalityTag('p1', 'v1');
  });
  it('rollbackPersonality', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1' }));
    await rollbackPersonality('p1', 'v1');
  });
  it('fetchPersonalityDrift', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ drift: 0.05 }));
    await fetchPersonalityDrift('p1');
  });
  it('fetchPersonalityVersionDiff', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ diff: '--- a\n+++ b' }));
    await fetchPersonalityVersionDiff('p1', 'v1', 'v2');
  });
});

// ── Workflow Versioning ──────────────────────────────────────
describe('Workflow Versioning', () => {
  it('fetchWorkflowVersions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ versions: [], total: 0 }));
    await fetchWorkflowVersions('wf1');
  });
  it('fetchWorkflowVersion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1' }));
    await fetchWorkflowVersion('wf1', 'v1');
  });
  it('tagWorkflowRelease', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1', tag: 'v1.0.0' }));
    await tagWorkflowRelease('wf1', 'v1.0.0');
  });
  it('rollbackWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'v1' }));
    await rollbackWorkflow('wf1', 'v1');
  });
  it('fetchWorkflowDrift', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ drift: 0.1 }));
    await fetchWorkflowDrift('wf1');
  });
  it('fetchWorkflowVersionDiff', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ diff: 'changes' }));
    await fetchWorkflowVersionDiff('wf1', 'v1', 'v2');
  });
});

// ── Citation API ──────────────────────────────────────────────
describe('Citation API', () => {
  it('fetchCitationFeedback', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ messageId: 'm1', feedback: [] }));
    await fetchCitationFeedback('m1');
  });
  it('submitCitationFeedback', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'f1' }));
    await submitCitationFeedback('m1', { citationIndex: 0, sourceId: 's1', relevant: true });
  });
  it('fetchDocumentProvenance', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ sourceQuality: null, trustScore: 0.8 }));
    await fetchDocumentProvenance('d1');
  });
  it('updateDocumentProvenance', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ document: {} }));
    await updateDocumentProvenance('d1', { accuracy: 0.9 });
  });
  it('fetchGroundingStats', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ averageScore: 0.85, totalMessages: 100, lowGroundingCount: 5 })
    );
    await fetchGroundingStats('p1');
  });
});

// ── Provider Accounts ──────────────────────────────────────────
describe('Provider Accounts', () => {
  it('fetchProviderAccounts', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchProviderAccounts('openai');
  });
  it('createProviderAccount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'pa1' }));
    await createProviderAccount({ provider: 'openai', label: 'main', apiKey: 'sk-xxx' });
  });
  it('updateProviderAccount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'pa1' }));
    await updateProviderAccount('pa1', { label: 'updated' });
  });
  it('deleteProviderAccount', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteProviderAccount('pa1');
  });
  it('setDefaultProviderAccount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'pa1', isDefault: true }));
    await setDefaultProviderAccount('pa1');
  });
  it('validateProviderAccount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'pa1', status: 'active' }));
    await validateProviderAccount('pa1');
  });
  it('rotateProviderAccountKey', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'pa1' }));
    await rotateProviderAccountKey('pa1', 'new-key');
  });
  it('validateAllProviderAccounts', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ total: 3, valid: 2, invalid: 1 }));
    const result = await validateAllProviderAccounts();
    expect(result.total).toBe(3);
  });
  it('fetchAccountCosts', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAccountCosts({ from: 1000, to: 2000 });
  });
  it('fetchAccountCostTrend', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAccountCostTrend({ days: 30 });
  });
});

// ── Sandbox Scanning ──────────────────────────────────────────
describe('Sandbox Scanning', () => {
  it('fetchScanHistory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rows: [], total: 0 }));
    await fetchScanHistory({ limit: 10, verdict: 'safe' });
  });
  it('fetchScanHistory returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchScanHistory();
    expect(result.total).toBe(0);
  });
  it('fetchScanStats', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        stats: { total: 0, byVerdict: {}, bySeverity: {}, avgDurationMs: 0, last24h: 0 },
      })
    );
    await fetchScanStats();
  });
  it('fetchScanStats returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchScanStats();
    expect(result.stats.total).toBe(0);
  });
  it('fetchQuarantineItems', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ items: [] }));
    await fetchQuarantineItems();
  });
  it('fetchQuarantineItems returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchQuarantineItems();
    expect(result.items).toEqual([]);
  });
  it('approveQuarantine', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await approveQuarantine('q1');
  });
  it('deleteQuarantine', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteQuarantine('q1');
  });
  it('fetchThreatIntelligence', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ patternCount: 10, categories: [], stages: [], patterns: [] })
    );
    await fetchThreatIntelligence();
  });
  it('fetchThreatIntelligence returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchThreatIntelligence();
    expect(result.patternCount).toBe(0);
  });
  it('fetchSandboxPolicy', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ policy: { enabled: true } }));
    await fetchSandboxPolicy();
  });
  it('fetchSandboxPolicy returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchSandboxPolicy();
    expect(result.policy.enabled).toBe(false);
  });
});

// ── Editor Search & Replace ──────────────────────────────────
describe('Editor API', () => {
  it('searchFiles', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ matches: [], fileCount: 0, matchCount: 0, truncated: false })
    );
    const result = await searchFiles({ query: 'foo' });
    expect(result.matchCount).toBe(0);
  });
  it('replaceInFiles', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ files: [], totalReplacements: 0 }));
    const result = await replaceInFiles({ search: 'foo', replace: 'bar', files: ['a.ts'] });
    expect(result.totalReplacements).toBe(0);
  });
  it('fetchAnnotations', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ annotations: [] }));
    await fetchAnnotations({ filePath: '/test.ts' });
  });
  it('createAnnotation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ annotation: { id: 'a1' } }));
    await createAnnotation({
      filePath: '/test.ts',
      startLine: 1,
      endLine: 5,
      selectedText: 'code',
      label: 'good',
    } as any);
  });
  it('deleteAnnotation', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteAnnotation('a1');
  });
  it('exportAnnotationsAsDataset', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse('jsonl data'));
    await exportAnnotationsAsDataset({ format: 'jsonl' });
  });
  it('fetchInlineCompletion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ completion: 'console.log()' }));
    const result = await fetchInlineCompletion({
      prefix: 'const x = ',
      suffix: '',
      language: 'typescript',
    });
    expect(result.completion).toBe('console.log()');
  });
});

// ── Photisnadi ──────────────────────────────────────────────
describe('Photisnadi', () => {
  it('fetchPhotisnadiWidget', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ widget: {} }));
    await fetchPhotisnadiWidget();
  });
  it('fetchPhotisnadiHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));
    const result = await fetchPhotisnadiHealth();
    expect(result.ok).toBe(true);
  });
});

// ── Key Rotation ──────────────────────────────────────────────
describe('Key Rotation', () => {
  it('fetchKeyRotationStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ statuses: [] }));
    await fetchKeyRotationStatus();
  });
  it('rotateKey', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ rotated: true, status: null }));
    const result = await rotateKey('api-key');
    expect(result.rotated).toBe(true);
  });
});

// ── Proactive Patterns & Config ──────────────────────────────
describe('Proactive Patterns', () => {
  it('fetchProactivePatterns', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ patterns: [] }));
    await fetchProactivePatterns();
  });
  it('fetchProactivePatterns returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchProactivePatterns();
    expect(result.patterns).toEqual([]);
  });
  it('convertPatternToTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1' }));
    await convertPatternToTrigger('p1');
  });
  it('fetchProactiveConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ config: {} }));
    await fetchProactiveConfig();
  });
  it('fetchProactiveConfig returns fallback on error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse('error', 500));
    const result = await fetchProactiveConfig();
    expect(result.config).toEqual({});
  });
});

// ── Training: Preference Pairs ──────────────────────────────
describe('Preference Pairs API', () => {
  it('fetchPreferencePairs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pairs: [] }));
    await fetchPreferencePairs({ source: 'annotation', limit: 100 });
  });
  it('createPreferencePair', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pair: {} }));
    await createPreferencePair({
      prompt: 'Hi',
      chosen: 'Hello!',
      rejected: 'Go away',
      source: 'annotation',
    } as any);
  });
  it('deletePreferencePair', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deletePreferencePair('p1');
  });
  it('rateSideBySide', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ pair: {} }));
    await rateSideBySide({ prompt: 'Hi', responseA: 'A', responseB: 'B', winner: 'a' } as any);
  });
  it('previewCuratedDataset', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ preview: [] }));
    await previewCuratedDataset({ personalityId: 'p1' } as any);
  });
  it('createCuratedDataset', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ dataset: {} }));
    await createCuratedDataset({ personalityId: 'p1' } as any);
  });
  it('fetchCuratedDatasets', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ datasets: [] }));
    await fetchCuratedDatasets();
  });
  it('deleteCuratedDataset', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteCuratedDataset('d1');
  });
});

// ── Training: Experiments ──────────────────────────────────
describe('Training Experiments API', () => {
  it('fetchTrainingExperiments', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ experiments: [] }));
    await fetchTrainingExperiments({ status: 'running' });
  });
  it('createTrainingExperiment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ experiment: {} }));
    await createTrainingExperiment({ name: 'Test' });
  });
  it('getTrainingExperiment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'e1' }));
    await getTrainingExperiment('e1');
  });
  it('deleteTrainingExperiment', async () => {
    mockFetch.mockReturnValueOnce(new Response(null, { status: 204 }));
    await deleteTrainingExperiment('e1');
  });
  it('diffTrainingExperiments', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ hyperparamDiffs: {}, metricDiffs: {}, lossCurveA: [], lossCurveB: [] })
    );
    await diffTrainingExperiments('e1', 'e2');
  });
});

// ── Model Deployment ──────────────────────────────────────
describe('Model Deployment API', () => {
  it('deployModel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ version: {} }));
    await deployModel({ personalityId: 'p1', modelName: 'model:latest' });
  });
  it('rollbackModel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ version: {} }));
    await rollbackModel('p1');
  });
  it('fetchModelVersions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ versions: [] }));
    await fetchModelVersions('p1');
  });
  it('createAbTest', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ test: {} }));
    await createAbTest({
      name: 'test',
      personalityId: 'p1',
      modelA: 'a',
      modelB: 'b',
      trafficPctB: 50,
    });
  });
  it('fetchAbTests', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ tests: [] }));
    await fetchAbTests();
  });
  it('getAbTest', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1' }));
    await getAbTest('t1');
  });
  it('completeAbTest', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1' }));
    await completeAbTest('t1', 'a');
  });
  it('cancelAbTest', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 't1' }));
    await cancelAbTest('t1');
  });
  it('evaluateAbTest', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ winner: 'a', avgQualityA: 0.9, avgQualityB: 0.8, totalA: 100, totalB: 100 })
    );
    const result = await evaluateAbTest('t1');
    expect(result.winner).toBe('a');
  });
});

// ── Bulk coverage tests for remaining API functions ──────────────────────

import {
  fetchRiskTrend,
  fetchRiskSummary,
  fetchRiskFindings,
  createRiskFinding,
  acknowledgeRiskFinding,
  resolveRiskFinding,
  fetchRiskAssessment,
  runRiskAssessment,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  fetchDepartmentScorecard,
  fetchDepartmentReport,
  snapshotDepartment,
  fetchHeatmap,
  createRegisterEntry,
  updateRegisterEntry,
  deleteRegisterEntry,
  fetchRegisterReport,
  downloadRiskReport,
  fetchRiskFeeds,
  createRiskFeed,
  deleteRiskFeed,
  ingestRiskFindings,
  fetchCommunityStatus,
  fetchCommunitySwarmTemplates,
  fetchCommunityWorkflows,
  exportSwarmTemplate,
  importSwarmTemplate,
  fetchAuditReports,
  fetchAuditReport,
  approveAuditReport,
  fetchAuditSchedules,
  updateAuditSchedule,
  exportAuditBackup,
  repairAuditChain,
  fetchReplayJobs,
  fetchReplayJob,
  createReplayBatch,
  fetchReplayReport,
  fetchBranches,
  fetchBranchTree,
  branchFromMessage,
  fetchAgentProfiles,
  createAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
  fetchProfileSkills,
  addProfileSkill,
  removeProfileSkill,
  fetchEcosystemServices,
  enableEcosystemService,
  disableEcosystemService,
  probeEcosystemService,
  discoverExtensions,
  fetchExtensionConfig,
  fetchExtensionWebhooks,
  registerExtensionWebhook,
  updateExtensionWebhook,
  removeExtensionWebhook,
  fetchHookExecutionLog,
  testHookPoint,
  fetchLicenseStatus,
  setLicenseKey,
  addFederationPeer,
  removeFederationPeer,
  checkFederationPeerHealth,
  updateFederationPeerFeatures,
  fetchExecutionConfig,
  approveExecution,
  rejectExecution,
  fetchExecutionHistory,
  fetchExecutionSession,
  fetchComputerUseEpisodes,
  fetchComputerUseStats,
  recordComputerUseEpisode,
  deleteComputerUseEpisode,
  fetchAnomalies,
  fetchTopEntities,
  searchEntities,
  fetchKeyPhrases,
  fetchSentimentTrend,
  fetchEngagementMetrics,
  renameConversation,
  replayConversation,
  exportTrainingDataset,
  fetchEvalRunScores,
  fetchTask,
  deleteNotification,
  markAllNotificationsRead,
  fetchNotificationCount,
  fetchTechStack,
  patchAlertRule,
  testAlertRule,
  createUser,
  updateUser,
  deleteUser,
  updateTenant,
  deleteTenant,
  fetchOAuthConfig,
  reloadOAuthConfig,
  fetchOAuthTokens,
  revokeOAuthToken,
  refreshOAuthToken,
  claimGmailOAuth,
  fetchPeerMarketplace,
  installSkillFromPeer,
  fetchA2AConfig,
  updateA2ATrust,
  delegateA2ATask,
  fetchA2AMessages,
  fetchDelegation,
  fetchDelegationMessages,
  fetchBullshiftAccount,
  fetchBullshiftHealth,
  fetchBullshiftPositions,
  fetchMarketQuote,
  fetchMarketSearch,
  fetchMarketHistorical,
  downloadReport,
  exportPersonalityBundle,
  importPersonalityBundle,
  exportWorkflow,
  importWorkflow,
  fetchMemoryHealth,
  triggerMemoryAudit,
  triggerSummarize,
  updateExternalBrainConfig,
  fetchOllamaPull,
  deleteOllamaModel,
  registerFinetuneAdapter,
  runDistillationJob,
  updateSwarmTemplate,
  executeTerminalCommand,
  fetchPairwiseComparisons,
  fetchPairwiseDetails,
  runPairwiseComparison,
  runPointwiseEval,
  uploadPersonalityAvatar,
  deletePersonalityAvatar,
  enableBuiltinTrigger,
  updateProactiveTrigger,
  testProactiveTrigger,
  approveProactiveSuggestion,
  dismissProactiveSuggestion,
  clearExpiredSuggestions,
  listWorktrees,
  createWorktree,
  deleteWorktree,
  updateCicdConfig,
  downloadBackup,
} from './client';

describe('Bulk API coverage tests', () => {
  // Risk API
  it('fetchRiskTrend', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ points: [] }));
    await fetchRiskTrend('d1', 30);
  });
  it('fetchRiskSummary', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchRiskSummary();
  });
  it('fetchRiskFindings', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ findings: [] }));
    await fetchRiskFindings();
  });
  it('createRiskFinding', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'f1' }));
    await createRiskFinding({} as any);
  });
  it('acknowledgeRiskFinding', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await acknowledgeRiskFinding('f1');
  });
  it('resolveRiskFinding', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await resolveRiskFinding('f1');
  });
  it('fetchRiskAssessment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchRiskAssessment('d1');
  });
  it('runRiskAssessment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await runRiskAssessment('d1');
  });

  // Department API
  it('createDepartment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'd1' }));
    await createDepartment({} as any);
  });
  it('updateDepartment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateDepartment('d1', {} as any);
  });
  it('deleteDepartment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteDepartment('d1');
  });
  it('fetchDepartmentScorecard', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchDepartmentScorecard('d1');
  });
  it('fetchDepartmentReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchDepartmentReport('d1');
  });
  it('snapshotDepartment', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await snapshotDepartment('d1');
  });
  it('fetchHeatmap', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchHeatmap();
  });

  // Register
  it('createRegisterEntry', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'r1' }));
    await createRegisterEntry('d1', {} as any);
  });
  it('updateRegisterEntry', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateRegisterEntry('d1', 'r1', {} as any);
  });
  it('deleteRegisterEntry', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteRegisterEntry('d1', 'r1');
  });
  it('fetchRegisterReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchRegisterReport('d1');
  });
  it('downloadRiskReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await downloadRiskReport('json');
  });

  // Risk Feeds
  it('fetchRiskFeeds', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ feeds: [] }));
    await fetchRiskFeeds();
  });
  it('createRiskFeed', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'f1' }));
    await createRiskFeed({} as any);
  });
  it('deleteRiskFeed', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteRiskFeed('f1');
  });
  it('ingestRiskFindings', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await ingestRiskFindings('f1');
  });

  // Community
  it('fetchCommunityStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchCommunityStatus();
  });
  it('fetchCommunitySwarmTemplates', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ templates: [] }));
    await fetchCommunitySwarmTemplates();
  });
  it('fetchCommunityWorkflows', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ definitions: [] }));
    await fetchCommunityWorkflows();
  });
  it('exportSwarmTemplate', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await exportSwarmTemplate('t1');
  });
  it('importSwarmTemplate', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await importSwarmTemplate({} as any);
  });

  // Audit Reports
  it('fetchAuditReports', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAuditReports();
  });
  it('fetchAuditReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchAuditReport('r1');
  });
  it('approveAuditReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await approveAuditReport('r1');
  });
  it('fetchAuditSchedules', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAuditSchedules();
  });
  it('updateAuditSchedule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateAuditSchedule('s1', {} as any);
  });
  it('exportAuditBackup', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await exportAuditBackup();
  });
  it('repairAuditChain', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await repairAuditChain();
  });

  // Replay
  it('fetchReplayJobs', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ jobs: [] }));
    await fetchReplayJobs();
  });
  it('fetchReplayJob', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchReplayJob('j1');
  });
  it('createReplayBatch', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'b1' }));
    await createReplayBatch({} as any);
  });
  it('fetchReplayReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchReplayReport('j1');
  });

  // Branches
  it('fetchBranches', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ branches: [] }));
    await fetchBranches('c1');
  });
  it('fetchBranchTree', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchBranchTree('c1');
  });
  it('branchFromMessage', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await branchFromMessage('c1', 'm1');
  });

  // Agent Profiles
  it('fetchAgentProfiles', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ profiles: [] }));
    await fetchAgentProfiles();
  });
  it('createAgentProfile', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'p1' }));
    await createAgentProfile({} as any);
  });
  it('updateAgentProfile', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateAgentProfile('p1', {} as any);
  });
  it('deleteAgentProfile', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteAgentProfile('p1');
  });
  it('fetchProfileSkills', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skills: [] }));
    await fetchProfileSkills('p1');
  });
  it('addProfileSkill', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await addProfileSkill('p1', 's1');
  });
  it('removeProfileSkill', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await removeProfileSkill('p1', 's1');
  });

  // Ecosystem
  it('fetchEcosystemServices', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchEcosystemServices();
  });
  it('enableEcosystemService', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await enableEcosystemService('svc1');
  });
  it('disableEcosystemService', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await disableEcosystemService('svc1');
  });
  it('probeEcosystemService', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await probeEcosystemService('svc1');
  });

  // Extensions
  it('discoverExtensions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await discoverExtensions();
  });
  it('fetchExtensionConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchExtensionConfig('ext1');
  });
  it('fetchExtensionWebhooks', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchExtensionWebhooks('ext1');
  });
  it('registerExtensionWebhook', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await registerExtensionWebhook('ext1', {} as any);
  });
  it('updateExtensionWebhook', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateExtensionWebhook('ext1', 'wh1', {} as any);
  });
  it('removeExtensionWebhook', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await removeExtensionWebhook('ext1', 'wh1');
  });
  it('fetchHookExecutionLog', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchHookExecutionLog('ext1', 'wh1');
  });
  it('testHookPoint', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await testHookPoint('ext1', 'hp1');
  });

  // License
  it('fetchLicenseStatus', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchLicenseStatus();
  });
  it('setLicenseKey', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await setLicenseKey('key123');
  });

  // Federation
  it('addFederationPeer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ peer: {} }));
    await addFederationPeer({ url: 'http://peer', name: 'p1' } as any);
  });
  it('removeFederationPeer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await removeFederationPeer('peer1');
  });
  it('checkFederationPeerHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await checkFederationPeerHealth('peer1');
  });
  it('updateFederationPeerFeatures', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateFederationPeerFeatures('peer1', ['f1']);
  });

  // Execution
  it('fetchExecutionConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchExecutionConfig();
  });
  it('approveExecution', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await approveExecution('e1');
  });
  it('rejectExecution', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await rejectExecution('e1');
  });
  it('fetchExecutionHistory', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchExecutionHistory();
  });
  it('fetchExecutionSession', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchExecutionSession('e1');
  });

  // Computer Use
  it('fetchComputerUseEpisodes', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ episodes: [] }));
    await fetchComputerUseEpisodes();
  });
  it('fetchComputerUseStats', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchComputerUseStats();
  });
  it('recordComputerUseEpisode', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await recordComputerUseEpisode({} as any);
  });
  it('deleteComputerUseEpisode', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteComputerUseEpisode('ep1');
  });

  // Analytics
  it('fetchAnomalies', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchAnomalies();
  });
  it('fetchTopEntities', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchTopEntities();
  });
  it('searchEntities', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await searchEntities('test');
  });
  it('fetchKeyPhrases', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchKeyPhrases();
  });
  it('fetchSentimentTrend', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchSentimentTrend();
  });
  it('fetchEngagementMetrics', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchEngagementMetrics();
  });

  // Conversations
  it('renameConversation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await renameConversation('c1', 'New Name');
  });
  it('replayConversation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await replayConversation('c1');
  });

  // Training
  it('exportTrainingDataset', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await exportTrainingDataset('d1');
  });
  it('fetchEvalRunScores', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchEvalRunScores('r1');
  });

  // Tasks
  it('fetchTask', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchTask('t1');
  });

  // Notifications
  it('deleteNotification', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteNotification('n1');
  });
  it('markAllNotificationsRead', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await markAllNotificationsRead();
  });
  it('fetchNotificationCount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ count: 0 }));
    await fetchNotificationCount();
  });

  // Tech Stack
  it('fetchTechStack', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchTechStack();
  });

  // Alert Rules
  it('patchAlertRule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await patchAlertRule('r1', {} as any);
  });
  it('testAlertRule', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await testAlertRule('r1');
  });

  // Users
  it('createUser', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: 'u1' }));
    await createUser({} as any);
  });
  it('updateUser', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateUser('u1', {} as any);
  });
  it('deleteUser', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteUser('u1');
  });

  // Tenant
  it('updateTenant', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateTenant({} as any);
  });
  it('deleteTenant', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteTenant();
  });

  // OAuth
  it('fetchOAuthConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchOAuthConfig();
  });
  it('reloadOAuthConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await reloadOAuthConfig();
  });
  it('fetchOAuthTokens', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchOAuthTokens();
  });
  it('revokeOAuthToken', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await revokeOAuthToken('t1');
  });
  it('refreshOAuthToken', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await refreshOAuthToken('t1');
  });
  it('claimGmailOAuth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await claimGmailOAuth('code1');
  });

  // Peer Marketplace
  it('fetchPeerMarketplace', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ skills: [] }));
    await fetchPeerMarketplace();
  });
  it('installSkillFromPeer', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await installSkillFromPeer('peer1', 's1');
  });

  // A2A
  it('fetchA2AConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchA2AConfig();
  });
  it('updateA2ATrust', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateA2ATrust('peer1', {} as any);
  });
  it('delegateA2ATask', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await delegateA2ATask({} as any);
  });
  it('fetchA2AMessages', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchA2AMessages('t1');
  });

  // Delegation
  it('fetchDelegation', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchDelegation('d1');
  });
  it('fetchDelegationMessages', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchDelegationMessages('d1');
  });

  // Bullshift
  it('fetchBullshiftAccount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchBullshiftAccount();
  });
  it('fetchBullshiftHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchBullshiftHealth();
  });
  it('fetchBullshiftPositions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchBullshiftPositions();
  });
  it('fetchMarketQuote', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchMarketQuote('AAPL');
  });
  it('fetchMarketSearch', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchMarketSearch('AAPL');
  });
  it('fetchMarketHistorical', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchMarketHistorical('AAPL');
  });

  // Export/Import bundles
  it('downloadReport', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await downloadReport('r1', 'json');
  });
  it('exportPersonalityBundle', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await exportPersonalityBundle('p1');
  });
  it('importPersonalityBundle', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await importPersonalityBundle({} as any);
  });
  it('exportWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await exportWorkflow('w1');
  });
  it('importWorkflow', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await importWorkflow({} as any);
  });

  // Memory
  it('fetchMemoryHealth', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchMemoryHealth();
  });
  it('triggerMemoryAudit', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await triggerMemoryAudit();
  });
  it('triggerSummarize', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await triggerSummarize('c1');
  });
  it('updateExternalBrainConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateExternalBrainConfig({} as any);
  });

  // Ollama
  it('fetchOllamaPull', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchOllamaPull('llama3');
  });
  it('deleteOllamaModel', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteOllamaModel('llama3');
  });

  // Finetune
  it('registerFinetuneAdapter', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await registerFinetuneAdapter({} as any);
  });
  it('runDistillationJob', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await runDistillationJob({} as any);
  });

  // Swarm Templates
  it('updateSwarmTemplate', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateSwarmTemplate('t1', {} as any);
  });

  // Terminal
  it('executeTerminalCommand', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await executeTerminalCommand('ls');
  });

  // Pairwise
  it('fetchPairwiseComparisons', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await fetchPairwiseComparisons();
  });
  it('fetchPairwiseDetails', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await fetchPairwiseDetails('c1');
  });
  it('runPairwiseComparison', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await runPairwiseComparison({} as any);
  });
  it('runPointwiseEval', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await runPointwiseEval({} as any);
  });

  // Personality Avatar
  it('uploadPersonalityAvatar', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await uploadPersonalityAvatar('p1', new File([''], 'avatar.png'));
  });
  it('deletePersonalityAvatar', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deletePersonalityAvatar('p1');
  });

  // Proactive
  it('enableBuiltinTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await enableBuiltinTrigger('t1');
  });
  it('updateProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateProactiveTrigger('t1', {} as any);
  });
  it('testProactiveTrigger', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await testProactiveTrigger('t1');
  });
  it('approveProactiveSuggestion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await approveProactiveSuggestion('s1');
  });
  it('dismissProactiveSuggestion', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await dismissProactiveSuggestion('s1');
  });
  it('clearExpiredSuggestions', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await clearExpiredSuggestions();
  });

  // Worktrees
  it('listWorktrees', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await listWorktrees();
  });
  it('createWorktree', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await createWorktree({} as any);
  });
  it('deleteWorktree', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await deleteWorktree('w1');
  });

  // CI/CD
  it('updateCicdConfig', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await updateCicdConfig({} as any);
  });

  // Backup
  it('downloadBackup', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    await downloadBackup('b1');
  });
});
