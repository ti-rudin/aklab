"use strict";
/**
 * SQLite Queue — типы и интерфейсы
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermanentError = void 0;
/**
 * PermanentError — ошибка, которую НЕ нужно ретраить.
 * Примеры: невалидные данные, отсутствующий ресурс, бизнес-ошибка.
 * Queue worker сразу помечает job как 'failed' без retry.
 */
class PermanentError extends Error {
    constructor(message) {
        super(message);
        this.permanent = true;
        this.name = 'PermanentError';
    }
}
exports.PermanentError = PermanentError;
//# sourceMappingURL=types.js.map