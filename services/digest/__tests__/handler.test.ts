import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { PermanentError } from '@aklab/sqlite-queue';

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const mockSendMail = vi.fn();
  const mockCreateTransport = vi.fn();
  return { mockSendMail, mockCreateTransport };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

vi.mock('@aklab/service-shared', () => ({
  logCron: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../src/utils/logger', () => ({ logger }));

vi.mock('../src/config', () => ({
  config: {
    app: { url: 'https://aklab.test' },
    strapi: { url: 'http://localhost:1338', apiToken: 'service-secret' },
    smtp: {
      host: 'smtp.test.com',
      port: 465,
      user: 'smtp-user@test.com',
      pass: 'smtp-pass',
      from: 'noreply@test.com',
    },
  },
}));

import { handleDigestJob } from '../src/handler';
import { logCron } from '@aklab/service-shared';

const mockedLogCron = logCron as Mock;
const mockFetch = vi.fn();

const SNAPSHOT_HASH = 'a'.repeat(64);
const WINDOW_END = '2026-08-07T12:00:00.000Z';
const JOB_DATA = {
  runId: 'run-1',
  userId: 7,
  snapshotHash: SNAPSHOT_HASH,
  correlationId: 'corr-1',
};

function makeJob(...args: [] | [unknown]) {
  const data = args.length === 0 ? JOB_DATA : args[0];
  return { data, correlation_id: 'legacy-correlation-must-not-be-used' } as any;
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function delivery(
  state: { enabled: true; email: string } | { enabled: false; reason: 'inactive' | 'disabled' | 'missing_email' },
) {
  return response({ data: state });
}

function recipientListDelivery(emails: string[]) {
  return response({ data: { enabled: true, emails } });
}

function property(documentId: string, overrides: Record<string, unknown> = {}) {
  return {
    documentId,
    title: `Property ${documentId}`,
    city: 'moscow',
    focus_score: 60,
    tags: [],
    url: 'https://example.com/property',
    area_sqm: 100,
    price: 1_000_000,
    price_per_sqm: 10_000,
    ...overrides,
  };
}

function propertiesPage(
  data: unknown[],
  options: Partial<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    threshold: number;
    windowEndAt: string;
  }> = {},
) {
  const total = options.total ?? data.length;
  return response({
    data,
    meta: {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 100,
      total,
      totalPages: options.totalPages ?? Math.ceil(total / 100),
      threshold: options.threshold ?? 25,
      windowEndAt: options.windowEndAt ?? WINDOW_END,
    },
  });
}

function requestData(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string).data;
}

function requestHeaders(call: unknown[]) {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

function makeContext(overrides: Partial<{
  isCancellationRequested: Mock;
  isLeaseValid: Mock;
}> = {}) {
  return {
    isCancellationRequested: overrides.isCancellationRequested || vi.fn().mockReturnValue(false),
    isLeaseValid: overrides.isLeaseValid || vi.fn().mockReturnValue(true),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockSendMail.mockReset().mockResolvedValue({});
  mockCreateTransport.mockReset().mockReturnValue({ sendMail: mockSendMail });
  mockedLogCron.mockReset().mockResolvedValue(undefined);
  global.fetch = mockFetch as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleDigestJob immutable internal projection contract', () => {
  it.each([
    undefined,
    null,
    { date: '2026-08-07', smtpTo: 'user@example.com' },
    { ...JOB_DATA, smtpTo: 'user@example.com' },
    { ...JOB_DATA, extra: true },
    { ...JOB_DATA, runId: '' },
    { ...JOB_DATA, runId: ' run-1' },
    { ...JOB_DATA, runId: 'run-1\u0000' },
    { ...JOB_DATA, runId: 'x'.repeat(129) },
    { ...JOB_DATA, userId: 0 },
    { ...JOB_DATA, userId: 1.5 },
    { ...JOB_DATA, userId: Number.MAX_SAFE_INTEGER + 1 },
    { ...JOB_DATA, snapshotHash: SNAPSHOT_HASH.toUpperCase() },
    { ...JOB_DATA, snapshotHash: 'not-a-hash' },
    { ...JOB_DATA, correlationId: 'bad\ncorrelation' },
  ])('rejects invalid or legacy job data before all side effects: %o', async (data) => {
    await expect(handleDigestJob(makeJob(data))).rejects.toBeInstanceOf(PermanentError);
    await expect(handleDigestJob(makeJob(data))).rejects.toThrow('Invalid digest job data');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockedLogCron).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the first delivery response as a preflight and skips without reading properties', async () => {
    mockFetch.mockResolvedValueOnce(delivery({ enabled: false, reason: 'inactive' }));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({
      sent: false,
      count: 0,
      reason: 'inactive',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).toBe('http://localhost:1338/api/internal/digest/delivery');
    expect(requestData(mockFetch.mock.calls[0])).toEqual({
      runId: JOB_DATA.runId,
      userId: JOB_DATA.userId,
      snapshotHash: JOB_DATA.snapshotHash,
    });
    expect(requestHeaders(mockFetch.mock.calls[0])).toEqual({
      'Content-Type': 'application/json',
      'x-aklab-service-token': 'service-secret',
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('reads every immutable projection page and uses the second current email only', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => property(`property-${index + 1}`));
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'old@example.com' }))
      .mockResolvedValueOnce(propertiesPage(firstPage, { page: 1, total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(propertiesPage([property('property-101')], { page: 2, total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'new@example.com' }));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({ sent: true, count: 101 });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(String(mockFetch.mock.calls[1][0])).toBe('http://localhost:1338/api/internal/digest/properties');
    expect(String(mockFetch.mock.calls[2][0])).toBe('http://localhost:1338/api/internal/digest/properties');
    expect(requestData(mockFetch.mock.calls[1])).toEqual({
      runId: JOB_DATA.runId,
      userId: JOB_DATA.userId,
      snapshotHash: JOB_DATA.snapshotHash,
      page: 1,
      pageSize: 100,
    });
    expect(requestData(mockFetch.mock.calls[2])).toEqual({
      runId: JOB_DATA.runId,
      userId: JOB_DATA.userId,
      snapshotHash: JOB_DATA.snapshotHash,
      page: 2,
      pageSize: 100,
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('new@example.com');
    expect(mockSendMail.mock.calls[0][0].subject).toContain('2026-08-07');
    expect(mockSendMail.mock.calls[0][0].html).toContain('Обычное (скор &lt; 50)');
    expect(mockSendMail.mock.calls[0][0].text).toContain('Обычное (< 50)');
    expect(mockSendMail.mock.calls[0][0].text).not.toContain('20-49');
    expect(mockedLogCron).toHaveBeenCalledTimes(1);
  });

  it('sends a private copy to every current digest recipient', async () => {
    mockFetch
      .mockResolvedValueOnce(recipientListDelivery(['first@example.com', 'second@example.com']))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(recipientListDelivery(['first@example.com', 'second@example.com']));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({ sent: true, count: 1 });
    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(mockSendMail.mock.calls.map(call => call[0].to)).toEqual(['first@example.com', 'second@example.com']);
  });

  it('uses only the two internal digest endpoints and never public focus or setting routes', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));

    await handleDigestJob(makeJob());

    const urls = mockFetch.mock.calls.map(call => String(call[0]));
    expect(urls).toEqual([
      'http://localhost:1338/api/internal/digest/delivery',
      'http://localhost:1338/api/internal/digest/properties',
      'http://localhost:1338/api/internal/digest/delivery',
    ]);
    expect(urls.join(' ')).not.toContain('/api/properties/focus');
    expect(urls.join(' ')).not.toContain('/api/setting');
  });

  it('derives subject and logging timestamps from the immutable window, never from Date.now', async () => {
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now is forbidden in digest worker');
    });
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({ sent: true, count: 1 });
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toContain('2026-08-07');
    expect(mail.html).toContain('2026-08-07');
    expect(mockedLogCron.mock.calls[0][0]).toMatchObject({
      started_at: WINDOW_END,
      finished_at: WINDOW_END,
      items_processed: 1,
    });
    expect(now).toHaveBeenCalledTimes(0);
  });

  it.each([
    ['disabled', { enabled: false, reason: 'disabled' as const }],
    ['blocked', { enabled: false, reason: 'inactive' as const }],
    ['missing email', { enabled: false, reason: 'missing_email' as const }],
  ] as const)('skips without SMTP when the second delivery check becomes %s', async (_name, secondDelivery) => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'first@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery(secondDelivery));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({
      sent: false,
      count: 0,
      reason: secondDelivery.reason,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockedLogCron).not.toHaveBeenCalled();
  });

  it('does not perform the second delivery read for an empty projection', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([], { total: 0, totalPages: 0 }));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({
      sent: false,
      count: 0,
      reason: 'empty',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('rejects duplicate documentId pagination fail-closed before SMTP', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage(
        Array.from({ length: 100 }, (_, index) => property(`property-${index}`)),
        { total: 101, totalPages: 2 },
      ))
      .mockResolvedValueOnce(propertiesPage([property('property-0')], { page: 2, total: 101, totalPages: 2 }));

    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest projection response is invalid');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('duplicate');
  });

  it.each([
    propertiesPage([property('property-1')], { total: 2, totalPages: 1 }),
    propertiesPage([property('property-1')], { page: 2, total: 1, totalPages: 1 }),
    propertiesPage([property('property-1')], { pageSize: 20, total: 1, totalPages: 1 }),
    propertiesPage([{ ...property('property-1'), unexpected: 'secret' }], { total: 1, totalPages: 1 }),
    propertiesPage([property('property-1')], { total: 1, totalPages: 1, threshold: Number.NaN }),
    propertiesPage([property('property-1')], { total: 1, totalPages: 1, windowEndAt: 'not-a-date' }),
  ])('rejects malformed projection metadata safely: %o', async (page) => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(page);

    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest projection response is invalid');
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('not-a-date');
  });

  it('rejects changed threshold or window metadata across pages', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')], { total: 101, totalPages: 2 }))
      .mockResolvedValueOnce(propertiesPage(Array.from({ length: 100 }, (_, index) => property(`property-${index + 2}`)), {
        page: 2,
        total: 101,
        totalPages: 2,
        threshold: 26,
      }));

    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest projection response is invalid');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('fails safely on HTTP, JSON, and malformed delivery responses without reading response bodies into errors', async () => {
    mockFetch.mockResolvedValueOnce(response({ secret: 'response-body' }, 503));
    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest projection request failed');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('response-body');

    mockFetch.mockReset().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('response body contains secret@example.com')),
    });
    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest projection request failed');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret@example.com');

    mockFetch.mockReset().mockResolvedValueOnce(response({ data: { enabled: true, email: 'not-an-email' } }));
    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest delivery response is invalid');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('not-an-email');
  });

  it('links HTML and text digests to internal property pages instead of source URLs', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([
        property('property-1', {
          title: '<img src=x onerror=alert(1)>',
          tags: ['</span><script>alert(1)</script>'],
          url: 'javascript:alert(1)',
        }),
        property('property-2', { title: 'Safe link', url: 'https://example.com/safe' }),
      ]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));

    await handleDigestJob(makeJob());

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).toContain('&lt;/span&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('href="https://aklab.test/properties/property-1"');
    expect(mail.html).toContain('href="https://aklab.test/properties/property-2"');
    expect(mail.html).not.toContain('href="javascript:');
    expect(mail.html).not.toContain('href="https://example.com/safe"');
    expect(mail.text).toContain('<img src=x onerror=alert(1)>');
    expect(mail.text).toContain('https://aklab.test/properties/property-1');
    expect(mail.text).toContain('https://aklab.test/properties/property-2');
    expect(mail.text).not.toContain('javascript:alert(1)');
    expect(mail.text).not.toContain('https://example.com/safe');
  });

  it('never logs email, service token, user, profile, or snapshot data', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'recipient@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'recipient@example.com' }));

    await handleDigestJob(makeJob());

    const logs = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
      mockedLogCron.mock.calls,
    ]);
    expect(logs).not.toContain('recipient@example.com');
    expect(logs).not.toContain('service-secret');
    expect(logs).not.toContain('"userId"');
    expect(logs).not.toContain(SNAPSHOT_HASH);
    expect(logs).toContain('corr-1');
  });

  it('wraps SMTP failures in a safe generic error and never logs the raw failure', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'recipient@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'recipient@example.com' }));
    mockSendMail.mockRejectedValueOnce(new Error('SMTP response for recipient@example.com includes service-secret'));

    await expect(handleDigestJob(makeJob())).rejects.toThrow('Digest email send failed');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('recipient@example.com');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('service-secret');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('SMTP response');
  });

  it('does not turn cancellation after an already sent email into a retry or rejection', async () => {
    const cancelled = { value: false };
    const context = makeContext({
      isCancellationRequested: vi.fn(() => cancelled.value),
    });
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));
    mockSendMail.mockImplementationOnce(async () => {
      cancelled.value = true;
    });

    await expect(handleDigestJob(makeJob(), context)).resolves.toEqual({ sent: true, count: 1 });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('ignores logCron failure after the email has been sent', async () => {
    mockFetch
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }))
      .mockResolvedValueOnce(propertiesPage([property('property-1')]))
      .mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));
    mockedLogCron.mockRejectedValueOnce(new Error('cron log body contains recipient@example.com'));

    await expect(handleDigestJob(makeJob())).resolves.toEqual({ sent: true, count: 1 });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('checks cancellation before the first fetch and after a response read', async () => {
    const cancelled = vi.fn().mockReturnValue(true);
    await expect(handleDigestJob(makeJob(), makeContext({ isCancellationRequested: cancelled })))
      .rejects.toBeInstanceOf(PermanentError);
    expect(mockFetch).not.toHaveBeenCalled();

    cancelled.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce(delivery({ enabled: true, email: 'user@example.com' }));
    await expect(handleDigestJob(makeJob(), makeContext({ isCancellationRequested: cancelled })))
      .rejects.toBeInstanceOf(PermanentError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
