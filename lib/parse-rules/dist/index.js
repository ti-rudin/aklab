"use strict";
/**
 * @aklab/parse-rules — единый источник правды для ParseRules интерфейса
 * и buildParseRules() функции. Используется в api/ и services/_shared/.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildParseRules = buildParseRules;
function buildParseRules(setting) {
    return {
        stopWords: setting?.stop_words || undefined,
        priceFrom: setting?.price_from != null ? Number(setting.price_from) : undefined,
        priceTo: setting?.price_to != null ? Number(setting.price_to) : undefined,
        areaFrom: setting?.area_from != null ? Number(setting.area_from) : undefined,
        areaTo: setting?.area_to != null ? Number(setting.area_to) : undefined,
        cities: setting?.monitored_regions?.length ? setting.monitored_regions : undefined,
    };
}
