/**
 * Инвестиционный портал МО (invest.mosreg.ru) — парсер коммерческой недвижимости.
 *
 * Публичный JSON API (карта инвестиционного портала):
 *   GET /aapi/map/places/?menu_id=X
 *
 * Меню:
 *   245 — Покупка
 *   287 — Аренда
 *   1008 — Коммерческие объекты (ЦИАН)
 */
import { classifyPropertyType, derivePropertyRegion, normalizeStructuredLocation, projectLegacyAddress } from '@aklab/service-shared';
import type { PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay } from '@aklab/service-shared';
import { resolveInvestMosregSourceUrl } from './source-url';

const BASE_URL = 'https://invest.mosreg.ru';
const API_PLACES = `${BASE_URL}/aapi/map/places/`;

/** ID разделов меню с коммерческой недвижимостью. */
const MENU_IDS = [245, 287, 1008];

const HEADERS: Record<string, string> = {
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

/* ─── Разбор полей объекта ─── */

interface MapField {
  id: number;
  name: string;
  value?: string;
  type?: number;
}

interface MapPlace {
  id: string;
  uid: string;
  name: string;
  cadastralNumber?: string;
  center?: [number, number]; // [lat, lon]
  fields: MapField[];
}

function getField(place: MapPlace, fieldName: string): string {
  const f = place.fields.find(
    (x) => x.name?.toLowerCase().includes(fieldName.toLowerCase()),
  );
  return (f?.value ?? '').toString().trim();
}

function normalizeFieldName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function findExactField(place: MapPlace, names: readonly string[]): MapField | undefined {
  const allowedNames = new Set(names.map(normalizeFieldName));
  return place.fields.find((field) => allowedNames.has(normalizeFieldName(field.name))
    && Boolean(field.value?.trim()));
}

function extractStructuredCoordinates(place: MapPlace): Pick<PropertyLocation, 'latitude' | 'longitude'> {
  const [latitude, longitude] = place.center ?? [];
  return typeof latitude === 'number' && Number.isFinite(latitude)
    && typeof longitude === 'number' && Number.isFinite(longitude)
    ? { latitude, longitude }
    : {};
}

function formatFieldPath(field: MapField): string {
  return `place.fields[name="${field.name.trim().replace(/\s+/g, ' ')}"]`;
}

function extractPropertyLocation(place: MapPlace): PropertyLocation {
  const addressField = findExactField(place, ['адрес', 'адресс']);
  const regionField = findExactField(place, ['муниципальное образование']);
  const coordinates = extractStructuredCoordinates(place);
  const address = addressField?.value?.trim();
  const region = regionField?.value?.trim();
  const hasAddress = Boolean(address);
  const hasRegion = Boolean(region);
  const hasCoordinates = coordinates.latitude !== undefined && coordinates.longitude !== undefined;

  return normalizeStructuredLocation({
    ...(hasAddress ? { address } : {}),
    ...(hasRegion ? { region } : {}),
    ...(hasCoordinates ? coordinates : {}),
    status: hasAddress ? 'confirmed_address' : hasRegion || hasCoordinates ? 'confirmed_region_only' : 'missing',
    source_kind: 'api_field',
    source_path: addressField
      ? formatFieldPath(addressField)
      : regionField
        ? formatFieldPath(regionField)
        : hasCoordinates
          ? 'place.center'
          : 'place.fields',
  });
}

function extractArea(place: MapPlace): number | undefined {
  // Пробуем поля «Площадь» — API может возвращать в гектарах
  for (const f of place.fields) {
    if (/площадь/i.test(f.name) && f.value) {
      const num = parseFloat(String(f.value).replace(',', '.'));
      if (!isNaN(num) && num > 0) {
        // Если значение < 100 и поле содержит "участка" — скорее всего гектары, конвертируем в м²
        if (num < 100 && /земельн|участк/i.test(f.name)) {
          return Math.round(num * 10_000);
        }
        return num;
      }
    }
  }
  // Из текста названия
  const match = place.name.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const num = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function extractPrice(place: MapPlace): number | undefined {
  // Кадастровая стоимость — API возвращает в млн. руб.
  for (const f of place.fields) {
    if (/кадастровая стоимость/i.test(f.name) && f.value) {
      const raw = String(f.value);
      const num = parseFloat(raw.replace(',', '.'));
      if (!isNaN(num) && num > 0) {
        // Если значение < 1000 — скорее всего млн. руб., конвертируем
        return num < 1000 ? Math.round(num * 1_000_000) : num;
      }
    }
  }
  return undefined;
}

export function toProperty(place: MapPlace, menuName: string): ParsedProperty {
  const propertyLocation = extractPropertyLocation(place);
  const address = projectLegacyAddress(propertyLocation);
  const city = derivePropertyRegion(propertyLocation);
  const status = getField(place, 'статус');
  const objectName = getField(place, 'объект');
  const municipality = getField(place, 'муниципальное образование');
  const useType = getField(place, 'ври') || getField(place, 'вид разрешенного');
  const condition = getField(place, 'условия предоставления');
  const contact = getField(place, 'фио') || getField(place, 'телефон') || getField(place, 'e-mail');
  const area = extractArea(place);
  const price = extractPrice(place);

  const titleText = [place.name, objectName, useType].filter(Boolean).join(' ');
  const description = [
    status && `Статус: ${status}`,
    municipality && `МО: ${municipality}`,
    useType && `ВРИ: ${useType}`,
    condition && `Условия: ${condition}`,
    menuName && `Раздел: ${menuName}`,
  ].filter(Boolean).join('. ');

  return {
    external_id: `invest-mosreg-${place.uid || place.id}`,
    url: resolveInvestMosregSourceUrl(place),
    title: place.name.slice(0, 300),
    address,
    city,
    property_location: propertyLocation,
    area_sqm: area,
    price,
    price_per_sqm: price && area ? Math.round(price / area) : undefined,
    property_type: classifyPropertyType(titleText),
    auction_type: 'marketplace',
    description: description || undefined,
    contacts: contact || undefined,
    latitude: propertyLocation.latitude,
    longitude: propertyLocation.longitude,
  };
}

/* ─── Основной парсер ─── */

export class InvestMosregParser implements SourceParser {
  name = 'invest-mosreg';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    logger.info('[invest-mosreg] Запуск парсинга через API...');
    const allProperties: ParsedProperty[] = [];
    const seen = new Set<string>();

    for (const menuId of MENU_IDS) {
      if (depth && allProperties.length >= depth) break;

      try {
        const url = `${API_PLACES}?menu_id=${menuId}`;
        logger.info(`[invest-mosreg] Запрос menu_id=${menuId}: ${url}`);

        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) {
          logger.warn(`[invest-mosreg] HTTP ${resp.status} для menu_id=${menuId}`);
          continue;
        }

        const json = await resp.json() as { data: MapPlace[] };
        const places = json.data ?? [];
        logger.info(`[invest-mosreg] menu_id=${menuId}: получено ${places.length} объектов`);

        // Получаем имя меню из layers/menus API (или используем ID)
        const menuName = this.getMenuName(menuId);

        for (const place of places) {
          if (depth && allProperties.length >= depth) break;
          const key = place.uid || place.id;
          if (seen.has(key)) continue;
          seen.add(key);

          allProperties.push(toProperty(place, menuName));
        }

        await randomDelay(500, 1500);
      } catch (err: any) {
        logger.error(`[invest-mosreg] Ошибка menu_id=${menuId}: ${err.message}`);
      }
    }

    logger.info(`[invest-mosreg] Итого: ${allProperties.length} объектов`);
    return allProperties;
  }

  private getMenuName(menuId: number): string {
    const names: Record<number, string> = {
      245: 'Покупка',
      287: 'Аренда',
      1008: 'Коммерческие объекты (ЦИАН)',
    };
    return names[menuId] ?? `menu_${menuId}`;
  }
}
