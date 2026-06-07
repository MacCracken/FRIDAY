/**
 * Google Workspace Routes — Drive, Sheets, and Docs API proxies.
 *
 * All routes require a valid Google OAuth token stored via the OAuth flow.
 * Token resolution prefers 'gdrive' provider, falling back to 'google'.
 */

import type { FastifyInstance } from 'fastify';
import type { OAuthTokenService } from '../gateway/oauth-token-service.js';
import { sendError } from '../utils/errors.js';
import { fetchWithOAuthRetry, createApiErrorFormatter } from './oauth-fetch.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DOCS_API = 'https://docs.googleapis.com/v1/documents';

export interface GoogleWorkspaceRoutesOptions {
  oauthTokenService: OAuthTokenService;
}

// ─── Helpers ──────────────────────────────────────────────────

const googleErrorMessage = createApiErrorFormatter('Google Workspace', {
  403: (body) =>
    body.includes('insufficientPermissions') || body.includes('PERMISSION_DENIED')
      ? 'Google Workspace access denied: your account is missing required permissions. Please reconnect your Google account via Settings \u2192 Connections \u2192 OAuth and re-authorize with the required scopes.'
      : `Google Workspace API error (403): ${body}`,
  404: 'The requested resource was not found in Google Workspace.',
});

async function resolveGoogleAccess(
  oauthTokenService: OAuthTokenService
): Promise<{ accessToken: string; tokenId: string } | null> {
  const tokens = await oauthTokenService.listTokens();
  const token =
    tokens.find((t) => t.provider === 'gdrive') ?? tokens.find((t) => t.provider === 'google');
  if (!token) return null;
  const accessToken = await oauthTokenService.getValidToken(token.provider, token.email);
  if (!accessToken) return null;
  return { accessToken, tokenId: token.id };
}

function fetchGoogle(
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

async function handleGoogleResponse(
  resp: Response,
  reply: {
    send: (data: unknown) => unknown;
    code: (n: number) => { send: (data: unknown) => unknown };
  }
): Promise<unknown> {
  if (!resp.ok) {
    const body = await resp.text();
    return sendError(reply as never, resp.status, googleErrorMessage(resp.status, body));
  }
  const data = await resp.json();
  return reply.send(data);
}

// ─── Route registration ────────────────────────────────────────

export function registerGoogleWorkspaceRoutes(
  app: FastifyInstance,
  opts: GoogleWorkspaceRoutesOptions
): void {
  const { oauthTokenService } = opts;

  // ─── Google Drive ────────────────────────────────────────────

  // GET /api/v1/integrations/gdrive/files — List files
  app.get<{
    Querystring: { q?: string; pageSize?: string; folderId?: string; mimeType?: string };
  }>('/api/v1/integrations/gdrive/files', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    const url = new URL(`${DRIVE_API}/files`);
    const qParts: string[] = [];
    if (req.query.q) qParts.push(req.query.q);
    if (req.query.folderId) qParts.push(`'${req.query.folderId}' in parents`);
    if (req.query.mimeType) qParts.push(`mimeType = '${req.query.mimeType}'`);
    if (qParts.length > 0) url.searchParams.set('q', qParts.join(' and '));
    url.searchParams.set('pageSize', req.query.pageSize ?? '20');
    url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,parents)');

    const resp = await fetchGoogle(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    return handleGoogleResponse(resp, reply);
  });

  // GET /api/v1/integrations/gdrive/files/search — Search files
  app.get<{
    Querystring: { query: string; pageSize?: string };
  }>('/api/v1/integrations/gdrive/files/search', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    if (!req.query.query) {
      return sendError(reply, 400, 'Missing required query parameter: query');
    }

    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set('q', `fullText contains '${req.query.query.replace(/'/g, "\\'")}'`);
    url.searchParams.set('pageSize', req.query.pageSize ?? '20');
    url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,description)');

    const resp = await fetchGoogle(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    return handleGoogleResponse(resp, reply);
  });

  // GET /api/v1/integrations/gdrive/files/:fileId — Get file metadata
  app.get<{ Params: { fileId: string } }>(
    '/api/v1/integrations/gdrive/files/:fileId',
    async (req, reply) => {
      const creds = await resolveGoogleAccess(oauthTokenService);
      if (!creds) {
        return sendError(
          reply,
          404,
          'No Google account connected. Connect via Settings > Connections > OAuth.'
        );
      }

      const resp = await fetchGoogle(
        `${DRIVE_API}/files/${encodeURIComponent(req.params.fileId)}?fields=*`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      return handleGoogleResponse(resp, reply);
    }
  );

  // POST /api/v1/integrations/gdrive/folders — Create folder
  app.post<{
    Body: { name: string; parentId?: string };
  }>('/api/v1/integrations/gdrive/folders', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    if (!req.body.name) {
      return sendError(reply, 400, 'Missing required field: name');
    }

    const metadata: Record<string, unknown> = {
      name: req.body.name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (req.body.parentId) metadata.parents = [req.body.parentId];

    const resp = await fetchGoogle(
      `${DRIVE_API}/files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, googleErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/integrations/gdrive/files — Upload file
  app.post<{
    Body: { name: string; mimeType: string; content: string; folderId?: string };
  }>('/api/v1/integrations/gdrive/files', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    const { name, mimeType, content, folderId } = req.body;
    if (!name || !mimeType || !content) {
      return sendError(reply, 400, 'Missing required fields: name, mimeType, content');
    }

    const metadata: Record<string, unknown> = { name, mimeType };
    if (folderId) metadata.parents = [folderId];

    // Decode base64 content
    const fileBytes = Buffer.from(content, 'base64');

    // Build multipart/related body
    const boundary = '----SecureYeomanUploadBoundary';
    const metadataPart =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      '\r\n';
    const mediaPart =
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      fileBytes.toString('base64') +
      '\r\n';
    const closing = `--${boundary}--`;

    const multipartBody = metadataPart + mediaPart + closing;

    const resp = await fetchGoogle(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody,
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, googleErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // DELETE /api/v1/integrations/gdrive/files/:fileId — Trash file
  app.delete<{ Params: { fileId: string } }>(
    '/api/v1/integrations/gdrive/files/:fileId',
    async (req, reply) => {
      const creds = await resolveGoogleAccess(oauthTokenService);
      if (!creds) {
        return sendError(
          reply,
          404,
          'No Google account connected. Connect via Settings > Connections > OAuth.'
        );
      }

      const resp = await fetchGoogle(
        `${DRIVE_API}/files/${encodeURIComponent(req.params.fileId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        },
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );

      if (!resp.ok) {
        const body = await resp.text();
        return sendError(reply, resp.status, googleErrorMessage(resp.status, body));
      }
      return reply.send({ success: true, fileId: req.params.fileId, trashed: true });
    }
  );

  // POST /api/v1/integrations/gdrive/files/:fileId/share — Share file
  app.post<{
    Params: { fileId: string };
    Body: { email: string; role: string };
  }>('/api/v1/integrations/gdrive/files/:fileId/share', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    const { email, role } = req.body;
    if (!email || !role) {
      return sendError(reply, 400, 'Missing required fields: email, role');
    }

    const resp = await fetchGoogle(
      `${DRIVE_API}/files/${encodeURIComponent(req.params.fileId)}/permissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', role, emailAddress: email }),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, googleErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // ─── Google Sheets ───────────────────────────────────────────

  // GET /api/v1/integrations/gsheets/spreadsheets/:spreadsheetId — Get spreadsheet
  app.get<{ Params: { spreadsheetId: string } }>(
    '/api/v1/integrations/gsheets/spreadsheets/:spreadsheetId',
    async (req, reply) => {
      const creds = await resolveGoogleAccess(oauthTokenService);
      if (!creds) {
        return sendError(
          reply,
          404,
          'No Google account connected. Connect via Settings > Connections > OAuth.'
        );
      }

      const url = `${SHEETS_API}/${encodeURIComponent(req.params.spreadsheetId)}?fields=spreadsheetId,properties,sheets.properties`;
      const resp = await fetchGoogle(url, {}, creds.tokenId, creds.accessToken, oauthTokenService);
      return handleGoogleResponse(resp, reply);
    }
  );

  // GET /api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values — Get values
  app.get<{
    Params: { spreadsheetId: string };
    Querystring: { range: string };
  }>('/api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    if (!req.query.range) {
      return sendError(reply, 400, 'Missing required query parameter: range');
    }

    const url = `${SHEETS_API}/${encodeURIComponent(req.params.spreadsheetId)}/values/${encodeURIComponent(req.query.range)}`;
    const resp = await fetchGoogle(url, {}, creds.tokenId, creds.accessToken, oauthTokenService);
    return handleGoogleResponse(resp, reply);
  });

  // PUT /api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values — Update values
  app.put<{
    Params: { spreadsheetId: string };
    Body: { range: string; values: unknown[][] };
  }>('/api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    const { range, values } = req.body;
    if (!range || !values) {
      return sendError(reply, 400, 'Missing required fields: range, values');
    }

    const url = `${SHEETS_API}/${encodeURIComponent(req.params.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
    const resp = await fetchGoogle(
      url,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    return handleGoogleResponse(resp, reply);
  });

  // POST /api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values/append — Append values
  app.post<{
    Params: { spreadsheetId: string };
    Body: { range: string; values: unknown[][] };
  }>(
    '/api/v1/integrations/gsheets/spreadsheets/:spreadsheetId/values/append',
    async (req, reply) => {
      const creds = await resolveGoogleAccess(oauthTokenService);
      if (!creds) {
        return sendError(
          reply,
          404,
          'No Google account connected. Connect via Settings > Connections > OAuth.'
        );
      }

      const { range, values } = req.body;
      if (!range || !values) {
        return sendError(reply, 400, 'Missing required fields: range, values');
      }

      const url = `${SHEETS_API}/${encodeURIComponent(req.params.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
      const resp = await fetchGoogle(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
        },
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      return handleGoogleResponse(resp, reply);
    }
  );

  // POST /api/v1/integrations/gsheets/spreadsheets — Create spreadsheet
  app.post<{
    Body: { title: string; sheetNames?: string[] };
  }>('/api/v1/integrations/gsheets/spreadsheets', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    if (!req.body.title) {
      return sendError(reply, 400, 'Missing required field: title');
    }

    const payload: Record<string, unknown> = {
      properties: { title: req.body.title },
    };
    if (req.body.sheetNames && req.body.sheetNames.length > 0) {
      payload.sheets = req.body.sheetNames.map((name) => ({
        properties: { title: name },
      }));
    }

    const resp = await fetchGoogle(
      SHEETS_API,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, googleErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // ─── Google Docs ─────────────────────────────────────────────

  // GET /api/v1/integrations/gdocs/documents/:documentId — Get document
  app.get<{ Params: { documentId: string } }>(
    '/api/v1/integrations/gdocs/documents/:documentId',
    async (req, reply) => {
      const creds = await resolveGoogleAccess(oauthTokenService);
      if (!creds) {
        return sendError(
          reply,
          404,
          'No Google account connected. Connect via Settings > Connections > OAuth.'
        );
      }

      const resp = await fetchGoogle(
        `${DOCS_API}/${encodeURIComponent(req.params.documentId)}`,
        {},
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );
      return handleGoogleResponse(resp, reply);
    }
  );

  // POST /api/v1/integrations/gdocs/documents — Create document
  app.post<{
    Body: { title: string; content?: string };
  }>('/api/v1/integrations/gdocs/documents', async (req, reply) => {
    const creds = await resolveGoogleAccess(oauthTokenService);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect via Settings > Connections > OAuth.'
      );
    }

    if (!req.body.title) {
      return sendError(reply, 400, 'Missing required field: title');
    }

    // Step 1: Create the document
    const createResp = await fetchGoogle(
      DOCS_API,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: req.body.title }),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );

    if (!createResp.ok) {
      const body = await createResp.text();
      return sendError(reply, createResp.status, googleErrorMessage(createResp.status, body));
    }

    const doc = (await createResp.json()) as { documentId: string };

    // Step 2: If content is provided, insert text via batchUpdate
    if (req.body.content) {
      const batchResp = await fetchGoogle(
        `${DOCS_API}/${doc.documentId}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: req.body.content,
                },
              },
            ],
          }),
        },
        creds.tokenId,
        creds.accessToken,
        oauthTokenService
      );

      if (!batchResp.ok) {
        const body = await batchResp.text();
        return sendError(reply, batchResp.status, googleErrorMessage(batchResp.status, body));
      }
    }

    return reply.code(201).send(doc);
  });
}
