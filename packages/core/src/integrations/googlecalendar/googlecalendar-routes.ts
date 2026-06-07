/**
 * Google Calendar Routes — Google Calendar API v3 proxy.
 *
 * All routes require a valid Google OAuth token stored via the OAuth flow.
 * Uses fetchWithOAuthRetry for automatic token refresh on 401.
 */

import type { FastifyInstance } from 'fastify';
import type { OAuthTokenService } from '../../gateway/oauth-token-service.js';
import type { SoulManager } from '../../soul/manager.js';
import { sendError } from '../../utils/errors.js';
import { fetchWithOAuthRetry, createApiErrorFormatter } from '../oauth-fetch.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendarRoutesOptions {
  oauthTokenService: OAuthTokenService;
  soulManager?: SoulManager;
}

// ─── Helpers ──────────────────────────────────────────────────

const calendarErrorMessage = createApiErrorFormatter('Google Calendar');

function fetchCalendar(
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
 * Find the first googlecalendar or google OAuth token and return credentials.
 */
async function resolveCalendarAccess(
  oauthTokenService: OAuthTokenService,
  _soulManager?: SoulManager
): Promise<{
  accessToken: string;
  email: string;
  tokenId: string;
} | null> {
  const tokens = await oauthTokenService.listTokens();
  const calToken =
    tokens.find((t) => t.provider === 'googlecalendar') ??
    tokens.find((t) => t.provider === 'google');
  if (!calToken) return null;

  const accessToken = await oauthTokenService.getValidToken(calToken.provider, calToken.email);
  if (!accessToken) return null;

  return {
    accessToken,
    email: calToken.email,
    tokenId: calToken.id,
  };
}

// ─── Route registration ────────────────────────────────────────

export function registerGoogleCalendarRoutes(
  app: FastifyInstance,
  opts: GoogleCalendarRoutesOptions
): void {
  const { oauthTokenService, soulManager } = opts;

  const PREFIX = '/api/v1/integrations/googlecalendar';

  // GET /api/v1/integrations/googlecalendar/events
  app.get<{
    Querystring: {
      calendarId?: string;
      timeMin?: string;
      timeMax?: string;
      maxResults?: string;
      q?: string;
    };
  }>(`${PREFIX}/events`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect a Google account via Settings > Connections > OAuth.'
      );
    }

    const calendarId = encodeURIComponent(req.query.calendarId ?? 'primary');
    const url = new URL(`${CALENDAR_API}/calendars/${calendarId}/events`);
    if (req.query.timeMin) url.searchParams.set('timeMin', req.query.timeMin);
    if (req.query.timeMax) url.searchParams.set('timeMax', req.query.timeMax);
    url.searchParams.set('maxResults', req.query.maxResults ?? '10');
    if (req.query.q) url.searchParams.set('q', req.query.q);

    const resp = await fetchCalendar(
      url.toString(),
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // GET /api/v1/integrations/googlecalendar/events/:eventId
  app.get<{
    Params: { eventId: string };
    Querystring: { calendarId?: string };
  }>(`${PREFIX}/events/:eventId`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Google account connected.');
    }

    const calendarId = encodeURIComponent(req.query.calendarId ?? 'primary');
    const resp = await fetchCalendar(
      `${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(req.params.eventId)}`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // POST /api/v1/integrations/googlecalendar/events
  app.post<{
    Body: {
      summary: string;
      start: string;
      end: string;
      description?: string;
      location?: string;
      calendarId?: string;
    };
  }>(`${PREFIX}/events`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Google account connected.');
    }

    const { summary, start, end, description, location, calendarId } = req.body;
    const calId = encodeURIComponent(calendarId ?? 'primary');

    const eventBody: Record<string, unknown> = {
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    };
    if (description) eventBody.description = description;
    if (location) eventBody.location = location;

    const resp = await fetchCalendar(
      `${CALENDAR_API}/calendars/${calId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // POST /api/v1/integrations/googlecalendar/events/quick
  app.post<{
    Body: { text: string; calendarId?: string };
  }>(`${PREFIX}/events/quick`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Google account connected.');
    }

    const { text, calendarId } = req.body;
    const calId = encodeURIComponent(calendarId ?? 'primary');
    const url = new URL(`${CALENDAR_API}/calendars/${calId}/events/quickAdd`);
    url.searchParams.set('text', text);

    const resp = await fetchCalendar(
      url.toString(),
      { method: 'POST' },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.code(201).send(data);
  });

  // PUT /api/v1/integrations/googlecalendar/events/:eventId
  app.put<{
    Params: { eventId: string };
    Body: {
      summary?: string;
      start?: string;
      end?: string;
      description?: string;
      location?: string;
      calendarId?: string;
    };
  }>(`${PREFIX}/events/:eventId`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Google account connected.');
    }

    const { summary, start, end, description, location, calendarId } = req.body;
    const calId = encodeURIComponent(calendarId ?? 'primary');

    const patchBody: Record<string, unknown> = {};
    if (summary !== undefined) patchBody.summary = summary;
    if (start !== undefined) patchBody.start = { dateTime: start };
    if (end !== undefined) patchBody.end = { dateTime: end };
    if (description !== undefined) patchBody.description = description;
    if (location !== undefined) patchBody.location = location;

    const resp = await fetchCalendar(
      `${CALENDAR_API}/calendars/${calId}/events/${encodeURIComponent(req.params.eventId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, errBody));
    }
    const data = await resp.json();
    return reply.send(data);
  });

  // DELETE /api/v1/integrations/googlecalendar/events/:eventId
  app.delete<{
    Params: { eventId: string };
    Querystring: { calendarId?: string };
  }>(`${PREFIX}/events/:eventId`, async (req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(reply, 404, 'No Google account connected.');
    }

    const calendarId = encodeURIComponent(req.query.calendarId ?? 'primary');
    const resp = await fetchCalendar(
      `${CALENDAR_API}/calendars/${calendarId}/events/${encodeURIComponent(req.params.eventId)}`,
      { method: 'DELETE' },
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const errBody = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, errBody));
    }
    // Google Calendar returns 204 No Content on successful delete
    return reply.code(204).send();
  });

  // GET /api/v1/integrations/googlecalendar/calendars
  app.get(`${PREFIX}/calendars`, async (_req, reply) => {
    const creds = await resolveCalendarAccess(oauthTokenService, soulManager);
    if (!creds) {
      return sendError(
        reply,
        404,
        'No Google account connected. Connect a Google account via Settings > Connections > OAuth.'
      );
    }

    const resp = await fetchCalendar(
      `${CALENDAR_API}/users/me/calendarList`,
      {},
      creds.tokenId,
      creds.accessToken,
      oauthTokenService
    );
    if (!resp.ok) {
      const body = await resp.text();
      return sendError(reply, resp.status, calendarErrorMessage(resp.status, body));
    }
    const data = await resp.json();
    return reply.send(data);
  });
}
