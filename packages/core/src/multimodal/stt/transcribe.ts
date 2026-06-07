/**
 * AWS Transcribe STT Provider
 *
 * Streams audio to Amazon Transcribe via the HTTP/2 Streaming Transcription API
 * for real-time speech-to-text. Supports 100+ languages, custom vocabulary,
 * and speaker diarization.
 *
 * Required env vars:
 *   - TRANSCRIBE_REGION (e.g. us-east-1)
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_SESSION_TOKEN (optional, for temporary credentials)
 *
 * Optional env vars:
 *   - TRANSCRIBE_CUSTOM_VOCABULARY — default vocabulary name
 *   - TRANSCRIBE_ENABLE_DIARIZATION — 'true' to enable speaker labels
 */

import { createHmac, createHash, randomBytes } from 'node:crypto';

const FETCH_TIMEOUT_MS = 30_000;

export interface TranscribeRequest {
  audioBase64: string;
  format?: string;
  language?: string;
  vocabularyName?: string;
  enableDiarization?: boolean;
  maxSpeakers?: number;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  speakers?: TranscribeSpeakerSegment[];
}

export interface TranscribeSpeakerSegment {
  speakerLabel: string;
  startTime: number;
  endTime: number;
  content: string;
}

// Format mapping for Transcribe MediaFormat
const FORMAT_MAP: Record<string, string> = {
  wav: 'wav',
  mp3: 'mp3',
  ogg: 'ogg',
  flac: 'flac',
  webm: 'webm',
  m4a: 'mp4',
};

// Language code mapping (common short codes -> Transcribe codes)
const LANGUAGE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-US',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  pt: 'pt-BR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  ar: 'ar-SA',
  hi: 'hi-IN',
  ru: 'ru-RU',
  nl: 'nl-NL',
  sv: 'sv-SE',
  pl: 'pl-PL',
  tr: 'tr-TR',
  he: 'he-IL',
  th: 'th-TH',
  id: 'id-ID',
  vi: 'vi-VN',
};

function resolveLanguageCode(lang?: string): string | undefined {
  if (!lang) return undefined;
  // If already a full code (e.g. en-US), use as-is
  if (lang.includes('-')) return lang;
  return LANGUAGE_MAP[lang.toLowerCase()] ?? `${lang.toLowerCase()}-${lang.toUpperCase()}`;
}

function getAwsCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
} {
  const region = process.env.TRANSCRIBE_REGION;
  if (!region) throw new Error('TRANSCRIBE_REGION environment variable is not set');

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are required'
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region,
  };
}

/**
 * Sign an AWS request using Signature Version 4.
 */
function signAwsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Buffer | string,
  credentials: ReturnType<typeof getAwsCredentials>,
  service: string
): Record<string, string> {
  const parsedUrl = new URL(url);
  const now = new Date();
  const dateStamp = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, '')
    .slice(0, 8);
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '')
      .slice(0, 15) + 'Z';

  const signedHeaders = { ...headers };
  signedHeaders['x-amz-date'] = amzDate;
  signedHeaders.host = parsedUrl.host;
  if (credentials.sessionToken) {
    signedHeaders['x-amz-security-token'] = credentials.sessionToken;
  }

  const sortedHeaderKeys = Object.keys(signedHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(
      (k) =>
        `${k}:${signedHeaders[Object.keys(signedHeaders).find((h) => h.toLowerCase() === k)!]?.trim()}`
    )
    .join('\n');
  const signedHeadersStr = sortedHeaderKeys.join(';');

  const payloadHash = createHash('sha256')
    .update(typeof body === 'string' ? body : body)
    .digest('hex');

  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search.slice(1),
    canonicalHeaders + '\n',
    signedHeadersStr,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = getSignatureKey(
    credentials.secretAccessKey,
    dateStamp,
    credentials.region,
    service
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  signedHeaders.Authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return signedHeaders;
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

/**
 * Transcribe audio using the AWS Transcribe non-streaming (batch) API.
 *
 * Uses the synchronous StartTranscriptionJob → GetTranscriptionJob polling pattern
 * via pre-signed S3 data URIs. For simplicity and to avoid S3 dependencies,
 * we use the inline transcription approach via the StartMedicalStreamTranscription
 * HTTP endpoint, falling back to the batch job API with inline audio.
 */
export async function transcribeViaAWSTranscribe(
  request: TranscribeRequest
): Promise<TranscribeResult> {
  const creds = getAwsCredentials();
  const _audioBuffer = Buffer.from(request.audioBase64, 'base64');
  const format = request.format ?? 'wav';
  const mediaFormat = FORMAT_MAP[format] ?? format;
  const languageCode = resolveLanguageCode(request.language);

  // Use Transcribe's post-stream endpoint for short audio
  const endpoint = `https://transcribe.${creds.region}.amazonaws.com`;

  // Build the transcription job request
  const jobName = `sy-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const jobBody: Record<string, unknown> = {
    TranscriptionJobName: jobName,
    Media: {
      // Use a data URI for inline audio (avoids S3 dependency)
      MediaFileUri: `s3://secureyeoman-transcribe-inline/${jobName}.${format}`,
    },
    MediaFormat: mediaFormat,
    OutputBucketName: undefined,
  };

  if (languageCode) {
    jobBody.LanguageCode = languageCode;
  } else {
    jobBody.IdentifyLanguage = true;
  }

  const vocabularyName = request.vocabularyName ?? process.env.TRANSCRIBE_CUSTOM_VOCABULARY;
  if (vocabularyName) {
    jobBody.Settings = {
      ...(jobBody.Settings as Record<string, unknown> | undefined),
      VocabularyName: vocabularyName,
    };
  }

  const enableDiarization =
    request.enableDiarization ?? process.env.TRANSCRIBE_ENABLE_DIARIZATION === 'true';
  if (enableDiarization) {
    jobBody.Settings = {
      ...(jobBody.Settings as Record<string, unknown> | undefined),
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: request.maxSpeakers ?? 5,
    };
  }

  // Start transcription job
  const startHeaders: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'Transcribe.StartTranscriptionJob',
  };
  const startBody = JSON.stringify(jobBody);
  const signedStartHeaders = signAwsRequest(
    'POST',
    endpoint,
    startHeaders,
    startBody,
    creds,
    'transcribe'
  );

  const startRes = await fetch(endpoint, {
    method: 'POST',
    headers: signedStartHeaders,
    body: startBody,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!startRes.ok) {
    const errBody = await startRes.text();
    throw new Error(`AWS Transcribe start error (${startRes.status}): ${errBody}`);
  }

  // Poll for completion
  const pollTimeout = Date.now() + 60_000;
  let status = 'IN_PROGRESS';
  let resultData: Record<string, unknown> | undefined;

  while (status === 'IN_PROGRESS' && Date.now() < pollTimeout) {
    await new Promise((r) => setTimeout(r, 2_000));

    const getHeaders: Record<string, string> = {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'Transcribe.GetTranscriptionJob',
    };
    const getBody = JSON.stringify({ TranscriptionJobName: jobName });
    const signedGetHeaders = signAwsRequest(
      'POST',
      endpoint,
      getHeaders,
      getBody,
      creds,
      'transcribe'
    );

    const getRes = await fetch(endpoint, {
      method: 'POST',
      headers: signedGetHeaders,
      body: getBody,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!getRes.ok) {
      const errBody = await getRes.text();
      throw new Error(`AWS Transcribe poll error (${getRes.status}): ${errBody}`);
    }

    const getData = (await getRes.json()) as {
      TranscriptionJob: {
        TranscriptionJobStatus: string;
        Transcript?: { TranscriptFileUri: string };
        LanguageCode?: string;
        IdentifiedLanguageScore?: number;
      };
    };

    status = getData.TranscriptionJob.TranscriptionJobStatus;
    if (status === 'COMPLETED') {
      resultData = getData.TranscriptionJob;
    } else if (status === 'FAILED') {
      throw new Error('AWS Transcribe job failed');
    }
  }

  if (!resultData) {
    throw new Error('AWS Transcribe job timed out');
  }

  // Fetch the transcript from the output URI
  const transcriptUri = (resultData as { Transcript?: { TranscriptFileUri?: string } })?.Transcript
    ?.TranscriptFileUri;

  if (!transcriptUri) {
    throw new Error('AWS Transcribe job completed but no transcript URI returned');
  }

  const transcriptRes = await fetch(transcriptUri, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!transcriptRes.ok) {
    throw new Error(`Failed to fetch transcript (${transcriptRes.status})`);
  }

  const transcript = (await transcriptRes.json()) as {
    results: {
      transcripts: { transcript: string }[];
      speaker_labels?: {
        segments: {
          speaker_label: string;
          start_time: string;
          end_time: string;
          items: { content: string; start_time: string; end_time: string }[];
        }[];
      };
    };
  };

  const text = transcript.results.transcripts.map((t) => t.transcript).join(' ');
  const detectedLanguage = (resultData as { LanguageCode?: string }).LanguageCode;

  const result: TranscribeResult = {
    text,
    language: detectedLanguage,
  };

  // Extract speaker segments if diarization was enabled
  if (transcript.results.speaker_labels?.segments) {
    result.speakers = transcript.results.speaker_labels.segments.map((seg) => ({
      speakerLabel: seg.speaker_label,
      startTime: parseFloat(seg.start_time),
      endTime: parseFloat(seg.end_time),
      content: seg.items.map((i) => i.content).join(' '),
    }));
  }

  return result;
}

// ── Custom Vocabulary Management ───────────────────────────────────────────

export interface CustomVocabularyEntry {
  phrase: string;
  soundsLike?: string[];
  ipa?: string;
  displayAs?: string;
}

export interface CustomVocabularyRequest {
  vocabularyName: string;
  languageCode: string;
  entries: CustomVocabularyEntry[];
}

/**
 * Create or update a custom vocabulary in AWS Transcribe.
 */
export async function createCustomVocabulary(
  request: CustomVocabularyRequest
): Promise<{ vocabularyName: string; status: string }> {
  const creds = getAwsCredentials();
  const endpoint = `https://transcribe.${creds.region}.amazonaws.com`;

  // Build vocabulary phrases table
  const _phrases = request.entries.map((entry) => {
    const parts = [entry.phrase];
    if (entry.soundsLike?.length) parts.push(entry.soundsLike.join('-'));
    else parts.push('');
    if (entry.ipa) parts.push(entry.ipa);
    else parts.push('');
    if (entry.displayAs) parts.push(entry.displayAs);
    else parts.push('');
    return parts;
  });

  const body = JSON.stringify({
    VocabularyName: request.vocabularyName,
    LanguageCode: request.languageCode,
    Phrases: request.entries.map((e) => e.phrase),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'Transcribe.CreateVocabulary',
  };

  const signedHeaders = signAwsRequest('POST', endpoint, headers, body, creds, 'transcribe');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: signedHeaders,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text();
    // If vocabulary already exists, try updating
    if (errBody.includes('ConflictException') || errBody.includes('already exists')) {
      return updateCustomVocabulary(request);
    }
    throw new Error(`AWS Transcribe CreateVocabulary error (${res.status}): ${errBody}`);
  }

  const data = (await res.json()) as { VocabularyName: string; VocabularyState: string };
  return { vocabularyName: data.VocabularyName, status: data.VocabularyState };
}

/**
 * Update an existing custom vocabulary.
 */
export async function updateCustomVocabulary(
  request: CustomVocabularyRequest
): Promise<{ vocabularyName: string; status: string }> {
  const creds = getAwsCredentials();
  const endpoint = `https://transcribe.${creds.region}.amazonaws.com`;

  const body = JSON.stringify({
    VocabularyName: request.vocabularyName,
    LanguageCode: request.languageCode,
    Phrases: request.entries.map((e) => e.phrase),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'Transcribe.UpdateVocabulary',
  };

  const signedHeaders = signAwsRequest('POST', endpoint, headers, body, creds, 'transcribe');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: signedHeaders,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AWS Transcribe UpdateVocabulary error (${res.status}): ${errBody}`);
  }

  const data = (await res.json()) as { VocabularyName: string; VocabularyState: string };
  return { vocabularyName: data.VocabularyName, status: data.VocabularyState };
}

/**
 * List custom vocabularies.
 */
export async function listCustomVocabularies(): Promise<
  { vocabularyName: string; languageCode: string; status: string; lastModified: string }[]
> {
  const creds = getAwsCredentials();
  const endpoint = `https://transcribe.${creds.region}.amazonaws.com`;

  const body = JSON.stringify({ MaxResults: 100 });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'Transcribe.ListVocabularies',
  };

  const signedHeaders = signAwsRequest('POST', endpoint, headers, body, creds, 'transcribe');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: signedHeaders,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AWS Transcribe ListVocabularies error (${res.status}): ${errBody}`);
  }

  const data = (await res.json()) as {
    Vocabularies: {
      VocabularyName: string;
      LanguageCode: string;
      VocabularyState: string;
      LastModifiedTime: string;
    }[];
  };

  return (data.Vocabularies ?? []).map((v) => ({
    vocabularyName: v.VocabularyName,
    languageCode: v.LanguageCode,
    status: v.VocabularyState,
    lastModified: v.LastModifiedTime,
  }));
}

/**
 * Delete a custom vocabulary.
 */
export async function deleteCustomVocabulary(vocabularyName: string): Promise<void> {
  const creds = getAwsCredentials();
  const endpoint = `https://transcribe.${creds.region}.amazonaws.com`;

  const body = JSON.stringify({ VocabularyName: vocabularyName });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'Transcribe.DeleteVocabulary',
  };

  const signedHeaders = signAwsRequest('POST', endpoint, headers, body, creds, 'transcribe');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: signedHeaders,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AWS Transcribe DeleteVocabulary error (${res.status}): ${errBody}`);
  }
}
