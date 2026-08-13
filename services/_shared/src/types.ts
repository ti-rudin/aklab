export type PropertyLocationStatus =
  | 'confirmed_address'
  | 'confirmed_region_only'
  | 'missing'
  | 'legacy_unverified';

export type StructuredSourceKind =
  | 'dom_field'
  | 'api_field'
  | 'xml_field'
  | 'ssr_field';

export interface PropertyLocation {
  address?: string;
  region?: string;
  region_code?: string;
  latitude?: number;
  longitude?: number;
  status: PropertyLocationStatus;
  source_kind: StructuredSourceKind;
  source_path: string;
}

export type PropertyPartyRole =
  | 'pledgee'
  | 'secured_creditor'
  | 'debtor'
  | 'organizer'
  | 'seller'
  | 'customer';

export interface PartyAddress {
  kind: 'legal' | 'postal' | 'actual' | 'unknown';
  value: string;
}

export interface PropertyParty {
  roles: PropertyPartyRole[];
  name: string;
  inn?: string;
  ogrn?: string;
  kpp?: string;
  addresses?: PartyAddress[];
  phone?: string;
  email?: string;
  source_path: string;
  source_kind: StructuredSourceKind | 'bounded_text';
  confidence: 'structured' | 'explicit_text';
}

/** Интерфейс для парсеров источников. */

export interface ParsedProperty {
  external_id: string;
  url: string;
  title: string;
  address: string;
  city: string; // moscow | mo | other
  /** Canonical structured location; optional during the compatibility wave. */
  property_location?: PropertyLocation;
  /** Structured participants, kept separate from property geography. */
  parties?: PropertyParty[];
  area_sqm?: number;
  price?: number;
  minimum_price?: number;
  /** Deadline for applications/trading, normalized to UTC. */
  auction_end_at?: string;
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
  /**
   * Загрузить детальную страницу объекта и извлечь расширенные данные.
   * Вызывается для каждого НОВОГО объекта (не дубля) после parse().
   * Опционально — парсеры без детальных страниц могут не реализовывать.
   */
  fetchDetails?(url: string, browser?: any): Promise<Partial<ParsedProperty>>;
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
  detailsFetched: number;
  /** Количество объектов, которым текущий run назначил Phase 2. */
  detailsNeeded: number;
}
