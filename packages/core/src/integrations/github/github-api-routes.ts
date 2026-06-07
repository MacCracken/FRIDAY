/**
 * GitHub API Routes — GitHub REST API proxy that enforces per-personality integration access modes.
 *
 * All routes require a valid GitHub OAuth token stored via the OAuth flow.
 * The active personality's integrationAccess mode is respected:
 *   auto   → full access (list, read, create issues/PRs, comment)
 *   draft  → list, read, create issues — no PR create (returns preview) or direct comments
 *   suggest → list, read only (no write operations)
 */

import type { FastifyInstance } from 'fastify';
import type { OAuthTokenService } from '../../gateway/oauth-token-service.js';
import type { SoulManager } from '../../soul/manager.js';
import { sendError } from '../../utils/errors.js';
import { fetchWithOAuthRetry, createApiErrorFormatter } from '../oauth-fetch.js';

const GITHUB_API = 'https://api.github.com';

// Scopes required by write operations — must be present in the stored token grant.
const GITHUB_WRITE_SCOPES = ['repo', 'public_repo'];

export interface GithubApiRoutesOptions {
  oauthTokenService: OAuthTokenService;
  soulManager?: SoulManager;
}

// ─── Helpers ──────────────────────────────────────────────────

const githubErrorMessage = createApiErrorFormatter('GitHub', {
  403: 'GitHub access denied: your connected account lacks required permissions. Disconnect and reconnect your GitHub account to re-authorize with repo/public_repo scopes.',
  404: (body) =>
    `GitHub resource not found. Verify the repository owner/name and that the token has access to it. Details: ${body}`,
});

const GITHUB_AUTH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function fetchGithub(
  url: string,
  opts: RequestInit,
  tokenId: string,
  accessToken: string,
  oauthTokenService: OAuthTokenService
): Promise<Response> {
  return fetchWithOAuthRetry(
    url,
    opts,
    { Authorization: `Bearer ${accessToken}`, ...GITHUB_AUTH_HEADERS },
    tokenId,
    accessToken,
    oauthTokenService,
    (newToken) => ({ Authorization: `Bearer ${newToken}`, ...GITHUB_AUTH_HEADERS })
  );
}

/**
 * Find the GitHub OAuth token and return { accessToken, email, tokenId, mode, scopes }.
 */
async function resolveGithubAccess(
  oauthTokenService: OAuthTokenService,
  soulManager?: SoulManager
): Promise<{
  accessToken: string;
  email: string;
  tokenId: string;
  mode: string;
  scopes: string;
} | null> {
  const tokens = await oauthTokenService.listTokens();
  const githubToken = tokens.find((t) => t.provider === 'github');
  if (!githubToken) return null;

  const accessToken = await oauthTokenService.getValidToken('github', githubToken.email);
  if (!accessToken) return null;

  let mode = 'suggest';
  if (soulManager) {
    try {
      const personality = await soulManager.getActivePersonality();
      const accessList = personality?.body?.integrationAccess ?? [];
      const entry = accessList.find((a) => a.id === githubToken.id);
      if (entry) mode = entry.mode;
    } catch {
      // soulManager may not be configured
    }
  }

  return {
    accessToken,
    email: githubToken.email,
    tokenId: githubToken.id,
    mode,
    scopes: githubToken.scopes ?? '',
  };
}

/**
 * Check whether stored scopes include at least one write scope.
 * Returns an error message string if insufficient, or null if OK.
 */
function checkWriteScopes(scopes: string): string | null {
  if (!scopes) return null; // no scope info — let the API decide
  const granted = new Set(scopes.split(/[\s,]+/));
  const hasWrite = GITHUB_WRITE_SCOPES.some((s) => granted.has(s));
  if (!hasWrite) {
    return (
      'GitHub access denied: your connected account was not granted repo or public_repo permissions. ' +
      'Disconnect and reconnect your GitHub account — on the GitHub permissions screen make sure to ' +
      'approve repository access. If the problem persists, verify that your GitHub OAuth App has ' +
      'the required scopes configured.'
    );
  }
  return null;
}

// ─── Route registration ────────────────────────────────────────

export function registerGithubApiRoutes(app: FastifyInstance, opts: GithubApiRoutesOptions): void {
  const { oauthTokenService, soulManager } = opts;

  // GET /api/v1/github/profile
  app.get('/api/v1/github/profile', async (_req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(
        reply,
        401,
        'No GitHub account connected. Connect a GitHub account via Settings > Connections > OAuth.'
      );
    }
    const resp = await fetchGithub(
      `${GITHUB_API}/user`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send({
      ...(data as object),
      email: creds.email,
      mode: creds.mode,
      tokenId: creds.tokenId,
      scopes: creds.scopes,
    });
  });

  // GET /api/v1/github/repos
  app.get<{ Querystring: { type?: string; sort?: string; per_page?: string; page?: string } }>(
    '/api/v1/github/repos',
    async (req, reply) => {
      const creds = await resolveGithubAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 401, 'No GitHub account connected.');
      }
      const url = new URL(`${GITHUB_API}/user/repos`);
      if (req.query.type) url.searchParams.set('type', req.query.type);
      if (req.query.sort) url.searchParams.set('sort', req.query.sort);
      if (req.query.per_page) url.searchParams.set('per_page', req.query.per_page);
      if (req.query.page) url.searchParams.set('page', req.query.page);

      const resp = await fetchGithub(
        url.toString(),
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // GET /api/v1/github/repos/:owner/:repo
  app.get<{ Params: { owner: string; repo: string } }>(
    '/api/v1/github/repos/:owner/:repo',
    async (req, reply) => {
      const creds = await resolveGithubAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 401, 'No GitHub account connected.');
      }
      const resp = await fetchGithub(
        `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // GET /api/v1/github/repos/:owner/:repo/pulls
  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { state?: string; per_page?: string; page?: string };
  }>('/api/v1/github/repos/:owner/:repo/pulls', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    const url = new URL(`${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/pulls`);
    if (req.query.state) url.searchParams.set('state', req.query.state);
    if (req.query.per_page) url.searchParams.set('per_page', req.query.per_page);
    if (req.query.page) url.searchParams.set('page', req.query.page);

    const resp = await fetchGithub(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // GET /api/v1/github/repos/:owner/:repo/pulls/:number
  app.get<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/v1/github/repos/:owner/:repo/pulls/:number',
    async (req, reply) => {
      const creds = await resolveGithubAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 401, 'No GitHub account connected.');
      }
      const resp = await fetchGithub(
        `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/pulls/${req.params.number}`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // GET /api/v1/github/repos/:owner/:repo/issues
  app.get<{
    Params: { owner: string; repo: string };
    Querystring: { state?: string; labels?: string; per_page?: string; page?: string };
  }>('/api/v1/github/repos/:owner/:repo/issues', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    const url = new URL(`${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/issues`);
    if (req.query.state) url.searchParams.set('state', req.query.state);
    if (req.query.labels) url.searchParams.set('labels', req.query.labels);
    if (req.query.per_page) url.searchParams.set('per_page', req.query.per_page);
    if (req.query.page) url.searchParams.set('page', req.query.page);

    const resp = await fetchGithub(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // GET /api/v1/github/repos/:owner/:repo/issues/:number
  app.get<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/v1/github/repos/:owner/:repo/issues/:number',
    async (req, reply) => {
      const creds = await resolveGithubAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 401, 'No GitHub account connected.');
      }
      const resp = await fetchGithub(
        `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/issues/${req.params.number}`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // POST /api/v1/github/repos/:owner/:repo/issues  (mode: draft + auto)
  app.post<{
    Params: { owner: string; repo: string };
    Body: { title: string; body?: string; labels?: string[]; assignees?: string[] };
  }>('/api/v1/github/repos/:owner/:repo/issues', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — creating issues is not permitted in suggest mode. The personality may only read repository data.`
      );
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const issueBody = {
      title: req.body.title,
      body: req.body.body,
      labels: req.body.labels,
      assignees: req.body.assignees,
    };

    const resp = await fetchGithub(
      `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issueBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/github/repos/:owner/:repo/pulls  (mode: auto only; draft → preview JSON)
  app.post<{
    Params: { owner: string; repo: string };
    Body: { title: string; head: string; base: string; body?: string; draft?: boolean };
  }>('/api/v1/github/repos/:owner/:repo/pulls', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — creating pull requests is not permitted. The personality may only read repository data.`
      );
    }
    if (creds.mode === 'draft') {
      // Return a preview instead of creating the PR
      return reply.send({
        preview: true,
        message:
          'GitHub mode is "draft" — this pull request has NOT been created. Review the details below and create it manually if approved.',
        owner: req.params.owner,
        repo: req.params.repo,
        title: req.body.title,
        head: req.body.head,
        base: req.body.base,
        body: req.body.body,
        draft: req.body.draft,
      });
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const prBody = {
      title: req.body.title,
      head: req.body.head,
      base: req.body.base,
      body: req.body.body,
      draft: req.body.draft,
    };

    const resp = await fetchGithub(
      `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/pulls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // GET /api/v1/github/ssh-keys  (list SSH keys — all modes)
  app.get('/api/v1/github/ssh-keys', async (_req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    const resp = await fetchGithub(
      `${GITHUB_API}/user/keys`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // POST /api/v1/github/ssh-keys  (add SSH key — mode: draft → preview, auto only for live add)
  app.post<{
    Body: { title: string; key: string };
  }>('/api/v1/github/ssh-keys', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — adding SSH keys is not permitted. The personality may only read account data.`
      );
    }
    if (creds.mode === 'draft') {
      return reply.send({
        preview: true,
        message:
          'GitHub mode is "draft" — this SSH key has NOT been added. Review the details below and add it manually via GitHub Settings > SSH Keys if approved.',
        title: req.body.title,
        key: req.body.key,
      });
    }
    const resp = await fetchGithub(
      `${GITHUB_API}/user/keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: req.body.title, key: req.body.key }),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // DELETE /api/v1/github/ssh-keys/:key_id  (delete SSH key — auto only)
  app.delete<{ Params: { key_id: string } }>(
    '/api/v1/github/ssh-keys/:key_id',
    async (req, reply) => {
      const creds = await resolveGithubAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 401, 'No GitHub account connected.');
      }
      if (creds.mode !== 'auto') {
        return sendError(
          reply,
          403,
          `GitHub mode is '${creds.mode}' — deleting SSH keys is not permitted. ` +
            (creds.mode === 'draft'
              ? 'Draft mode blocks destructive operations; remove the key manually via GitHub Settings > SSH Keys.'
              : 'The personality may only read account data.')
        );
      }
      const resp = await fetchGithub(
        `${GITHUB_API}/user/keys/${req.params.key_id}`,
        { method: 'DELETE' },
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const errBody = await resp.text();
        return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
      }
      return reply.code(204).send();
    }
  );

  // POST /api/v1/github/repos  (create repo — mode: auto only; draft → preview JSON)
  app.post<{
    Body: { name: string; description?: string; private?: boolean; auto_init?: boolean };
  }>('/api/v1/github/repos', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — creating repositories is not permitted. The personality may only read repository data.`
      );
    }
    if (creds.mode === 'draft') {
      return reply.send({
        preview: true,
        message:
          'GitHub mode is "draft" — this repository has NOT been created. Review the details below and create it manually if approved.',
        name: req.body.name,
        description: req.body.description,
        private: req.body.private ?? false,
        auto_init: req.body.auto_init ?? false,
      });
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const repoBody = {
      name: req.body.name,
      description: req.body.description,
      private: req.body.private ?? false,
      auto_init: req.body.auto_init ?? false,
    };

    const resp = await fetchGithub(
      `${GITHUB_API}/user/repos`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repoBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/github/repos/:owner/:repo/forks  (fork repo — mode: auto only; draft → preview JSON)
  app.post<{
    Params: { owner: string; repo: string };
    Body: { organization?: string; name?: string; default_branch_only?: boolean };
  }>('/api/v1/github/repos/:owner/:repo/forks', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — forking repositories is not permitted. The personality may only read repository data.`
      );
    }
    if (creds.mode === 'draft') {
      return reply.send({
        preview: true,
        message:
          'GitHub mode is "draft" — this repository has NOT been forked. Review the details below and fork it manually if approved.',
        source_owner: req.params.owner,
        source_repo: req.params.repo,
        organization: req.body.organization,
        name: req.body.name,
        default_branch_only: req.body.default_branch_only ?? false,
      });
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const forkBody: Record<string, unknown> = {};
    if (req.body.organization) forkBody.organization = req.body.organization;
    if (req.body.name) forkBody.name = req.body.name;
    if (req.body.default_branch_only !== undefined)
      forkBody.default_branch_only = req.body.default_branch_only;

    const resp = await fetchGithub(
      `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/forks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forkBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    // GitHub returns 202 Accepted for forks (async operation)
    return reply.code(202).send(data);
  });

  // POST /api/v1/github/repos/:owner/:repo/sync-fork  (mode: auto only; draft → preview JSON; suggest → 403)
  // Calls GitHub POST /repos/{owner}/{repo}/merges to merge upstream changes into a fork branch.
  // GitHub returns 201 when a merge commit is created, 204 when already up-to-date.
  app.post<{
    Params: { owner: string; repo: string };
    Body: { base: string; head?: string; commit_message?: string };
  }>('/api/v1/github/repos/:owner/:repo/sync-fork', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — syncing a fork is not permitted. The personality may only read repository data.`
      );
    }
    if (creds.mode === 'draft') {
      return reply.send({
        preview: true,
        message:
          'GitHub mode is "draft" — the fork sync has NOT been performed. Review the details below and sync manually if approved.',
        owner: req.params.owner,
        repo: req.params.repo,
        base: req.body.base,
        head: req.body.head ?? null,
        commit_message: req.body.commit_message ?? null,
      });
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const mergeBody: Record<string, unknown> = { base: req.body.base };
    if (req.body.head) mergeBody.head = req.body.head;
    if (req.body.commit_message) mergeBody.commit_message = req.body.commit_message;

    const resp = await fetchGithub(
      `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/merges`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergeBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    // 204 = already up-to-date, no merge commit created
    if (resp.status === 204) {
      return reply.code(204).send();
    }
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/github/repos/:owner/:repo/issues/:number/comments  (mode: auto only)
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { body: string };
  }>('/api/v1/github/repos/:owner/:repo/issues/:number/comments', async (req, reply) => {
    const creds = await resolveGithubAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 401, 'No GitHub account connected.');
    }
    if (creds.mode !== 'auto') {
      return sendError(
        reply,
        403,
        `GitHub mode is '${creds.mode}' — posting comments directly is not permitted. ` +
          (creds.mode === 'draft'
            ? 'Draft mode blocks direct comments; review and post manually.'
            : 'The personality may only read repository data.')
      );
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const resp = await fetchGithub(
      `${GITHUB_API}/repos/${req.params.owner}/${req.params.repo}/issues/${req.params.number}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: req.body.body }),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, githubErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });
}
