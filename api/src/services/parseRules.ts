/**
 * Построить ParseRules из записи Setting (singleton).
 * Дублирует логику buildParseRules из @aklab/service-shared/strapi-client,
 * т.к. api/ не зависит от service-shared пакета.
 */
export interface ParseRules {
  stopWords?: string[];
  priceFrom?: number;
  priceTo?: number;
  areaFrom?: number;
  areaTo?: number;
  cities?: string[];
}

export function buildParseRules(setting: any): ParseRules {
  return {
    stopWords: setting?.stop_words || undefined,
    priceFrom: setting?.price_from != null ? Number(setting.price_from) : undefined,
    priceTo: setting?.price_to != null ? Number(setting.price_to) : undefined,
    areaFrom: setting?.area_from != null ? Number(setting.area_from) : undefined,
    areaTo: setting?.area_to != null ? Number(setting.area_to) : undefined,
    cities: setting?.monitored_regions?.length ? setting.monitored_regions : undefined,
  };
}
