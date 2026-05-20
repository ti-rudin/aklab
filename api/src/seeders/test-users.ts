/**
 * Создание тестового пользователя при старте
 * Env: TEST_USER_EMAIL, TEST_USER_PASSWORD (обязательные)
 * 
 * КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: После создания пользователя необходимо явно
 * связать его с ролью в таблице up_users_role_lnk
 */
const bcrypt = require('bcryptjs');

module.exports = async function seedTestUsers(strapi: any): Promise<void> {
  try {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;

    if (!email || !password) {
      strapi.log.warn('[TEST-USER] TEST_USER_EMAIL или TEST_USER_PASSWORD не установлены');
      return;
    }

    const username = email.split('@')[0];

    // Получаем прямое соединение с БД
    const db = strapi.db?.connection?.fn;
    if (!db || !db.prepare) {
      strapi.log.error('[TEST-USER] Не могу получить соединение с БД');
      return;
    }

    // Проверяем существование
    const existing = db.prepare('SELECT * FROM up_users WHERE email = ?').get(email);
    if (existing) {
      strapi.log.info(`[TEST-USER] Пользователь ${email} уже существует (id: ${(existing as any).id})`);
      return;
    }

    // Получаем роль
    const role = db.prepare('SELECT * FROM up_roles WHERE type = ?').get('authenticated') as any;
    if (!role?.id) {
      strapi.log.warn('[TEST-USER] Роль authenticated не найдена');
      return;
    }

    // Хешируем пароль
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Создаём пользователя
    const result = db.prepare(`
      INSERT INTO up_users (username, email, password, provider, confirmed, blocked, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(username, email, hashedPassword, 'local', 1, 0) as any;

    // КЛЮЧЕВОЕ: Связываем пользователя с ролью
    db.prepare('INSERT INTO up_users_role_lnk (user_id, role_id) VALUES (?, ?)').run(result.lastInsertRowid, role.id);

    strapi.log.info(`[TEST-USER] Пользователь ${email} создан (id: ${result.lastInsertRowid})`);

  } catch (error: any) {
    strapi.log.error('[TEST-USER] Ошибка:', error?.message || String(error));
  }
};