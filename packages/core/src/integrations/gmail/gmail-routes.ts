/**
 * Gmail Routes — Gmail API proxy that enforces per-personality integration access modes.
 *
 * All routes require a valid Gmail OAuth token stored via the OAuth flow.
 * The active personality's integrationAccess mode is respected:
 *   auto   → full access (list, read, draft, send)
 *   draft  → list, read, draft only (no send)
 *   suggest → list, read only (no compose or send)
 */

import type { FastifyInstance } from 'fastify';
import type { OAuthTokenService } from '../../gateway/oauth-token-service.js';
import type { SoulManager } from '../../soul/manager.js';
import { sendError } from '../../utils/errors.js';
import { fetchWithOAuthRetry, createApiErrorFormatter } from '../oauth-fetch.js';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Scopes required by write operations — must be present in the stored token grant.
// Includes the broad https://mail.google.com/ scope as an acceptable alternative.
const GMAIL_WRITE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
];

export interface GmailRoutesOptions {
  oauthTokenService: OAuthTokenService;
  soulManager?: SoulManager;
}

// ─── Helpers ──────────────────────────────────────────────────

const gmailErrorMessage = createApiErrorFormatter('Gmail', {
  403: (body) =>
    body.includes('SCOPE_INSUFFICIENT') ||
    body.includes('insufficient_scopes') ||
    body.includes('insufficientPermissions')
      ? 'Gmail access denied: your account is missing required permissions. Please reconnect your Gmail account via Settings → Connections → OAuth and re-authorize with Gmail scopes.'
      : `Gmail API error (403): ${body}`,
});

function fetchGmail(
  url: string,
  opts: RequestInit,
  tokenId: string,
  accessToken: string,
  oauthTokenService: OAuthTokenService
): Promise<Response> {
  return fetchWithOAuthRetry(
    url,
    opts,
    { Authorization: `Bearer ${accessToken}` },
    tokenId,
    accessToken,
    oauthTokenService
  );
}

/**
 * Find the first gmail OAuth token and return { accessToken, email, tokenId, mode, scopes }.
 * Also returns the mode from the active personality's integrationAccess, defaulting to 'auto'.
 */
async function resolveGmailAccess(
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
  // Prefer the gmail-specific token (has Gmail API scopes) over a generic google token
  const gmailToken =
    tokens.find((t) => t.provider === 'gmail') ?? tokens.find((t) => t.provider === 'google');
  if (!gmailToken) return null;

  // Get a fresh access token (auto-refreshes if near expiry)
  const accessToken = await oauthTokenService.getValidToken(gmailToken.provider, gmailToken.email);
  if (!accessToken) return null;

  // Determine the integration access mode from the active personality
  let mode = 'suggest';
  if (soulManager) {
    try {
      const personality = await soulManager.getActivePersonality();
      const accessList = personality?.body?.integrationAccess ?? [];
      const entry = accessList.find((a) => a.id === gmailToken.id);
      if (entry) mode = entry.mode;
    } catch {
      // soulManager may not be configured — default to 'auto'
    }
  }

  return {
    accessToken,
    email: gmailToken.email,
    tokenId: gmailToken.id,
    mode,
    scopes: gmailToken.scopes ?? '',
  };
}

/**
 * Check whether the stored token scopes include at least one of the required write scopes.
 * Returns an error message string if insufficient, or null if OK.
 */
function checkWriteScopes(scopes: string): string | null {
  if (!scopes) return null; // no scope info stored — let the API decide
  const granted = new Set(scopes.split(/\s+/));
  const hasWrite = GMAIL_WRITE_SCOPES.some((s) => granted.has(s));
  if (!hasWrite) {
    return (
      'Gmail access denied: your connected account was not granted compose/modify permissions. ' +
      'Disconnect and reconnect your Gmail account — on the Google permissions screen make sure to ' +
      'approve all requested Gmail permissions. If the problem persists, verify that your Google Cloud ' +
      'project has the Gmail API enabled and the required scopes on the OAuth consent screen.'
    );
  }
  return null;
}

// ─── Route registration ────────────────────────────────────────

export function registerGmailRoutes(app: FastifyInstance, opts: GmailRoutesOptions): void {
  const { oauthTokenService, soulManager } = opts;

  // GET /api/v1/gmail/profile
  app.get('/api/v1/gmail/profile', async (_req, reply) => {
    const creds = await resolveGmailAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Gmail account connected. Connect a Google account via Settings > Connections > OAuth.'
      );
    }
    const resp = await fetchGmail(
      `${GMAIL_API}/profile`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, gmailErrorMessage(resp.status, body));
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

  // GET /api/v1/gmail/messages?q=&maxResults=&pageToken=
  app.get<{
    Querystring: { q?: string; maxResults?: string; pageToken?: string; labelIds?: string };
  }>('/api/v1/gmail/messages', async (req, reply) => {
    const creds = await resolveGmailAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Gmail account connected.');
    }

    const url = new URL(`${GMAIL_API}/messages`);
    if (req.query.q) url.searchParams.set('q', req.query.q);
    if (req.query.maxResults) url.searchParams.set('maxResults', req.query.maxResults);
    if (req.query.pageToken) url.searchParams.set('pageToken', req.query.pageToken);
    if (req.query.labelIds) url.searchParams.set('labelIds', req.query.labelIds);

    const resp = await fetchGmail(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, gmailErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // GET /api/v1/gmail/messages/:messageId
  app.get<{ Params: { messageId: string }; Querystring: { format?: string } }>(
    '/api/v1/gmail/messages/:messageId',
    async (req, reply) => {
      const creds = await resolveGmailAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 404, 'No Gmail account connected.');
      }

      const format = req.query.format ?? 'full';
      const resp = await fetchGmail(
        `${GMAIL_API}/messages/${req.params.messageId}?format=${format}`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, gmailErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // GET /api/v1/gmail/threads/:threadId
  app.get<{ Params: { threadId: string } }>(
    '/api/v1/gmail/threads/:threadId',
    async (req, reply) => {
      const creds = await resolveGmailAccess(oauthTokenService, soulManager);
      if (!creds) {
        return sendError(reply, 404, 'No Gmail account connected.');
      }

      const resp = await fetchGmail(
        `${GMAIL_API}/threads/${req.params.threadId}?format=full`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, gmailErrorMessage(resp.status, body));
      }
      const data = await resp.json();
      return reply.send(data);
    }
  );

  // POST /api/v1/gmail/drafts  (requires mode: auto or draft)
  app.post<{
    Body: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
    };
  }>('/api/v1/gmail/drafts', async (req, reply) => {
    const creds = await resolveGmailAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Gmail account connected.');
    }
    if (creds.mode === 'suggest') {
      return sendError(
        reply,
        403,
        `Gmail mode is '${creds.mode}' — composing drafts is not permitted. The personality may only read messages.`
      );
    }
    const scopeErr = checkWriteScopes(creds.scopes);
    if (scopeErr) return sendError(reply, 403, scopeErr);

    const { to, subject, body: bodyText, threadId, cc, bcc } = req.body;
    const headers = [
      `From: ${creds.email}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
    ];
    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);

    const raw = headers.join('\r\n') + '\r\n\r\n' + bodyText;
    const encoded = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const draftBody: Record<string, unknown> = { message: { raw: encoded } };
    if (threadId) (draftBody.message as Record<string, string>).threadId = threadId;

    const resp = await fetchGmail(
      `${GMAIL_API}/drafts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, gmailErrorMessage(resp.status, errBody));
    }

    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/gmail/send  (requires mode: auto only)
  app.post<{
    Body: {
      to: string;
      subject: string;
      body: string;
      threadId?: string;
      cc?: string;
      bcc?: string;
      inReplyTo?: string;
      references?: string;
    };
  }>('/api/v1/gmail/send', async (req, reply) => {
    const creds = await resolveGmailAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Gmail account connected.');
    }
    if (creds.mode !== 'auto') {
      return sendError(
        reply,
        403,
        `Gmail mode is '${creds.mode}' — sending emails directly is not permitted. ` +
          (creds.mode === 'draft'
            ? 'Use gmail_compose_draft to create a draft for human review.'
            : 'The personality may only read messages.')
      );
    }
    const scopeErrSend = checkWriteScopes(creds.scopes);
    if (scopeErrSend) return sendError(reply, 403, scopeErrSend);

    const { to, subject, body: bodyText, threadId, cc, bcc, inReplyTo, references } = req.body;
    const headers = [
      `From: ${creds.email}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
    ];
    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references) headers.push(`References: ${references}`);

    const raw = headers.join('\r\n') + '\r\n\r\n' + bodyText;
    const encoded = Buffer.from(raw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const sendBody: Record<string, string> = { raw: encoded };
    if (threadId) sendBody.threadId = threadId;

    const resp = await fetchGmail(
      `${GMAIL_API}/messages/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, gmailErrorMessage(resp.status, errBody));
    }

    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // GET /api/v1/gmail/labels
  app.get('/api/v1/gmail/labels', async (_req, reply) => {
    const creds = await resolveGmailAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Gmail account connected.');
    }
    const resp = await fetchGmail(
      `${GMAIL_API}/labels`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, gmailErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });
}
