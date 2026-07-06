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
export declare function buildParseRules(setting: any): ParseRules;
