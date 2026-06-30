import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock config (must be before handler import since logger imports config)
vi.mock('../src/config', () => ({
  config: {
    port: 1341,
    strapi: { url: 'http://localhost:1338', apiToken: 'test-token' },
    queue: { dbPath: ':memory:' },
    logging: { level: 'error' },
  },
}));

// Mock @aklab/service-shared
vi.mock('@aklab/service-shared', () => ({
  fetchProperty: vi.fn(),
  findActiveMarketReference: vi.fn(),
  fetchSetting: vi.fn(),
  updateProperty: vi.fn(),
  logCron: vi.fn(),
}));

// Mock @aklab/sqlite-queue
vi.mock('@aklab/sqlite-queue', () => ({
  SqliteQueue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
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

import { handleAnalyzeJob } from '../src/handler';
import {
  fetchProperty,
  findActiveMarketReference,
  fetchSetting,
  updateProperty,
  logCron,
} from '@aklab/service-shared';

const mockedFetchProperty = fetchProperty as Mock;
const mockedFindRef = findActiveMarketReference as Mock;
const mockedFetchSetting = fetchSetting as Mock;
const mockedUpdateProperty = updateProperty as Mock;
const mockedLogCron = logCron as Mock;
mockedLogCron.mockResolvedValue(undefined);

function makeJob(data: any) {
  return {
    data,
    correlation_id: 'test-corr-id',
  } as any;
}

describe('handleAnalyzeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return analyzed=false if property not found', async () => {
    mockedFetchProperty.mockResolvedValue(null);

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: false, undervalued: false });
    expect(mockedFetchProperty).toHaveBeenCalledWith('prop-1');
    expect(mockedFindRef).not.toHaveBeenCalled();
  });

  it('should return analyzed=false if no market reference found', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
    });
    mockedFindRef.mockResolvedValue(null);

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: false, undervalued: false });
    expect(mockedFindRef).toHaveBeenCalledWith('moscow', 'office');
    expect(mockedUpdateProperty).not.toHaveBeenCalled();
  });

  it('should return analyzed=false if actual price is zero', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 0,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: false, undervalued: false });
    expect(mockedUpdateProperty).not.toHaveBeenCalled();
  });

  it('should return analyzed=false if ref price is zero', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 50000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 0 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: false, undervalued: false });
    expect(mockedUpdateProperty).not.toHaveBeenCalled();
  });

  it('should mark property as undervalued when deviation >= threshold', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 50000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = (100000 - 50000) / 100000 * 100 = 50%
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: true });
    expect(mockedUpdateProperty).toHaveBeenCalledWith('prop-1', {
      is_undervalued: true,
      deviation_percent: 50,
      manual_price_per_sqm: 100000,
    });
  });

  it('should not mark as undervalued when deviation < threshold', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 90000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = (100000 - 90000) / 100000 * 100 = 10%
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: false });
    expect(mockedUpdateProperty).toHaveBeenCalledWith('prop-1', {
      is_undervalued: false,
      deviation_percent: 0,
      manual_price_per_sqm: null,
    });
  });

  it('should use threshold from job data over settings', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 85000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = 15%, threshold from job = 10
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 50 });

    const result = await handleAnalyzeJob(
      makeJob({ documentId: 'prop-1', threshold: 10 })
    );

    expect(result).toEqual({ analyzed: true, undervalued: true });
    // Should NOT call fetchSetting because threshold was provided in job data
    expect(mockedFetchSetting).not.toHaveBeenCalled();
  });

  it('should use default threshold of 20 when settings return null', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 85000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = 15%, threshold default = 20
    mockedFetchSetting.mockResolvedValue(null);

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: false });
  });

  it('should calculate deviation correctly with rounding', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 66666,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = (100000 - 66666) / 100000 * 100 = 33.334%
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: true });
    expect(mockedUpdateProperty).toHaveBeenCalledWith('prop-1', {
      is_undervalued: true,
      deviation_percent: 33.3,
      manual_price_per_sqm: 100000,
    });
  });

  it('should log cron after successful analysis', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 50000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });
    mockedLogCron.mockResolvedValue(undefined);

    await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(mockedLogCron).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'analyze-property',
        items_processed: 1,
      })
    );
  });

  it('should throw on fetchProperty error', async () => {
    mockedFetchProperty.mockRejectedValue(new Error('Network error'));

    await expect(
      handleAnalyzeJob(makeJob({ documentId: 'prop-1' }))
    ).rejects.toThrow('Network error');
  });

  it('should handle when deviation equals threshold exactly', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 80000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = 20%, threshold = 20
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: true });
    expect(mockedUpdateProperty).toHaveBeenCalledWith('prop-1', {
      is_undervalued: true,
      deviation_percent: 20,
      manual_price_per_sqm: 100000,
    });
  });

  it('should handle negative deviation (property more expensive than reference)', async () => {
    mockedFetchProperty.mockResolvedValue({
      documentId: 'prop-1',
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 150000,
    });
    mockedFindRef.mockResolvedValue({ price_per_sqm: 100000 });
    // deviation = (100000 - 150000) / 100000 * 100 = -50%
    mockedFetchSetting.mockResolvedValue({ threshold_percent: 20 });

    const result = await handleAnalyzeJob(makeJob({ documentId: 'prop-1' }));

    expect(result).toEqual({ analyzed: true, undervalued: false });
  });
});
