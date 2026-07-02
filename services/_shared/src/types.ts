/**
 * Интерфейс для парсеров источников.
 */

export interface ParsedProperty {
  external_id: string;
  url: string;
  title: string;
  address: string;
  city: string; // moscow | mo | other
  area_sqm?: number;
  price?: number;
  minimum_price?: number;
  price_per_sqm?: number;
  property_type: string; // office | warehouse | retail | production | free_purpose | other
  auction_type: string; // bankruptcy | privatization | marketplace
  published_at?: string;
  description?: string;
  contacts?: string;
  photo_urls?: string[];
  latitude?: number;
  longitude?: number;
}

export interface SourceParser {
  name: string;
  parse(depth?: number): Promise<ParsedProperty[]>;
}

/** Опции для запуска парсинга. */
export interface ParseOptions {
  /** Максимум объектов для создания за один запуск. */
  depth?: number;
}

/** Результат работы parse-handler. */
export interface ParseResult {
  created: number;
  filtered: number;
  total: number;
}
