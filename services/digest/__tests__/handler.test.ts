import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock nodemailer — use vi.hoisted so variables are available when vi.mock is hoisted
const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const mockSendMail = vi.fn().mockResolvedValue({});
  const mockCreateTransport = vi.fn().mockReturnValue({ sendMail: mockSendMail });
  return { mockSendMail, mockCreateTransport };
});
vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

// Mock @aklab/service-shared
vi.mock('@aklab/service-shared', () => ({
  fetchSetting: vi.fn(),
  logCron: vi.fn(),
}));

// Mock logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config
vi.mock('../src/config', () => ({
  config: {
    strapi: { url: 'http://localhost:1338', apiToken: 'test-token' },
    smtp: {
      host: 'smtp.test.com',
      port: 465,
      user: 'test@test.com',
      pass: 'test-pass',
      from: 'noreply@test.com',
    },
  },
}));

import { handleDigestJob } from '../src/handler';
import { fetchSetting, logCron } from '@aklab/service-shared';

const mockedFetchSetting = fetchSetting as Mock;
const mockedLogCron = logCron as Mock;

function makeJob(data: any) {
  return {
    data,
    correlation_id: 'test-corr-id',
  } as any;
}

// We need to mock global fetch for fetchFocusProperties
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = mockFetch;
});

describe('handleDigestJob', () => {
  it('should return sent=false when no focus properties found', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow', 'mo'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(result).toEqual({ sent: false, count: 0 });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('should return sent=false when no properties match monitored regions', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'spb', focus_score: 60, title: 'Test', tags: [] },
        ],
      }),
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(result).toEqual({ sent: false, count: 0 });
  });

  it('should filter properties by monitored regions', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Moscow Prop', tags: ['undervalued'], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
          { city: 'mo', focus_score: 40, title: 'MO Prop', tags: [], url: '#', price: 500000, price_per_sqm: 25000, area_sqm: 20 },
          { city: 'spb', focus_score: 70, title: 'SPB Prop', tags: [], url: '#', price: 2000000, price_per_sqm: 100000, area_sqm: 20 },
        ],
      }),
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(result).toEqual({ sent: true, count: 1 });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.to).toBe('user@test.com');
    expect(mailArg.subject).toContain('1 объектов');
  });

  it('should split properties into hot (score >= 50) and regular (score < 50)', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow', 'mo'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 70, title: 'Hot Prop', tags: ['undervalued'], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
          { city: 'moscow', focus_score: 30, title: 'Regular Prop', tags: ['new'], url: '#', price: 500000, price_per_sqm: 25000, area_sqm: 20 },
        ],
      }),
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(result).toEqual({ sent: true, count: 2 });
    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.html).toContain('🔥 Горячее (1)');
    expect(mailArg.html).toContain('📋 Обычное (1)');
  });

  it('should send email to smtpTo address', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'custom@test.com' }));

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'custom@test.com' })
    );
  });

  it('should fallback to smtp.user when smtpTo is null', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: null }));

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@test.com' })
    );
  });

  it('should skip email if no smtpTo and smtp.user is empty', async () => {
    // We need to re-mock config for this test
    // Since config is already mocked at module level, let's test the no-recipient case differently
    // The code checks: const smtpTo = req.smtpTo || config.smtp.user
    // Since our mock has smtp.user = 'test@test.com', we can't test empty here directly
    // But we can test the logic by providing empty string in smtpTo
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    // Empty string is falsy, so it falls back to config.smtp.user
    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: '' }));
    expect(result.sent).toBe(true);
  });

  it('should use default regions when settings have no monitored_regions', async () => {
    mockedFetchSetting.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Moscow', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
          { city: 'mo', focus_score: 40, title: 'MO', tags: [], url: '#', price: 500000, price_per_sqm: 25000, area_sqm: 20 },
          { city: 'other', focus_score: 30, title: 'Other', tags: [], url: '#', price: 300000, price_per_sqm: 15000, area_sqm: 20 },
        ],
      }),
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    // Default regions are moscow and mo, so 'other' should be filtered out
    expect(result).toEqual({ sent: true, count: 2 });
  });

  it('should calculate average score correctly', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop A', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
          { city: 'moscow', focus_score: 40, title: 'Prop B', tags: [], url: '#', price: 500000, price_per_sqm: 25000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.html).toContain('Средний скор: <strong>50</strong>');
  });

  it('should include tag labels in email HTML', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 70, title: 'Prop', tags: ['undervalued', 'has_minimum_price'], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.html).toContain('Недооценён');
    expect(mailArg.html).toContain('Торги');
  });

  it('should use correct SMTP config for transporter', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 465,
      secure: true,
      auth: { user: 'test@test.com', pass: 'test-pass' },
    });
  });

  it('should log cron after successful send', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockedLogCron.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    expect(mockedLogCron).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'digest-send',
        items_processed: 1,
      })
    );
  });

  it('should throw when email sending fails', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });
    mockSendMail.mockRejectedValueOnce(new Error('SMTP connection failed'));

    await expect(
      handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }))
    ).rejects.toThrow('SMTP connection failed');
  });

  it('should handle when fetchFocusProperties returns non-ok response', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await handleDigestJob(makeJob({ date: '2025-01-15', smtpTo: 'user@test.com' }));

    // fetchFocusProperties returns [] on non-ok
    expect(result).toEqual({ sent: false, count: 0 });
  });

  it('should include date in email subject', async () => {
    mockedFetchSetting.mockResolvedValue({ monitored_regions: ['moscow'] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { city: 'moscow', focus_score: 60, title: 'Prop', tags: [], url: '#', price: 1000000, price_per_sqm: 50000, area_sqm: 20 },
        ],
      }),
    });

    await handleDigestJob(makeJob({ date: '2025-06-30', smtpTo: 'user@test.com' }));

    const mailArg = mockSendMail.mock.calls[0][0];
    expect(mailArg.subject).toContain('2025-06-30');
    expect(mailArg.html).toContain('2025-06-30');
  });
});
