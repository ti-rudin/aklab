/**
 * Классификация типа недвижимости по тексту (название + описание).
 * Единая функция для всех парсеров — убирает дублирование.
 */
export function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();

  // Квартиры (приоритет — раньше было в free_purpose)
  if (lower.includes('квартир') || lower.includes('апартамен')) return 'apartment';

  // Земельные участки
  if (lower.includes('земельн') || lower.includes('участок')) return 'land';

  // Офисы
  if (lower.includes('офис') || lower.includes('административн')) return 'office';

  // Склады
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';

  // Торговля
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';

  // Производство
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';

  // Свободного назначения (нежилые, здания, гаражи)
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('бокс') || lower.includes('паркинг') ||
      lower.includes('здани')) return 'free_purpose';

  return 'other';
}
