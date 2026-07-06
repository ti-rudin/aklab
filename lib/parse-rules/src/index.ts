/**
 * @aklab/parse-rules — единый источник правды для ParseRules интерфейса
 * и buildParseRules() функции. Используется в api/ и services/_shared/.
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
