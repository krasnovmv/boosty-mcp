# boosty-mcp

MCP-сервер для [Boosty](https://boosty.to) поверх неофициального клиента
[`boosty-api`](https://www.npmjs.com/package/boosty-api).

> Внутренний API Boosty не документирован и может измениться без предупреждения.

## Установка

Нужен Node.js 22+ и любой Chromium-браузер (Chrome, Edge, Яндекс Браузер, Brave) — для входа.

```bash
npm install
npm run build
```

## Подключение

Сервер работает по stdio: клиент сам запускает `node <путь к проекту>/dist/index.js`.
Ниже `<PATH>` — абсолютный путь к `dist/index.js`, например
`D:\Projects\ai\mcp\boosty-mcp\boosty-mcp\dist\index.js`.

### Claude Code

```bash
claude mcp add -s user boosty -- node "<PATH>"
```

`-s user` делает сервер доступным во всех проектах; без флага он добавится только для текущей папки.
Проверить: `claude mcp get boosty` (должно быть `✔ Connected`) или `/mcp` внутри сессии.
Удалить: `claude mcp remove boosty -s user`.

Уже открытые сессии сервер не увидят — нужна новая.

### Claude Desktop

Откройте конфиг: Settings → Developer → Edit Config, либо файл напрямую:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Добавьте сервер в `mcpServers` (в JSON обратные слэши удваиваются):

```json
{
  "mcpServers": {
    "boosty": {
      "command": "node",
      "args": ["D:\\Projects\\ai\\mcp\\boosty-mcp\\boosty-mcp\\dist\\index.js"]
    }
  }
}
```

Затем полностью перезапустите Claude Desktop: выход через значок в трее, а не закрытие окна.

### Другие MCP-клиенты

Подойдёт любой клиент с поддержкой stdio: команда `node`, аргумент `<PATH>`. Переменные окружения
не обязательны.

### Если не подключается

- Нет `dist/index.js` — не выполнен `npm run build`.
- `node` не найден — клиент не видит его в `PATH`; укажите полный путь, например
  `C:\Program Files\nodejs\node.exe`.
- Логи Claude Desktop: `%APPDATA%\Claude\logs\mcp-server-boosty.log`.

## Вход

Публичные блоги читаются без входа. Для всего остального — инструмент `login` (или `npm run login`
из терминала): открывается окно браузера, вы входите в Boosty и закрываете окно.

Токены берутся из cookies `auth` и `_clientId` сайта boosty.to и сохраняются в
`~/.config/boosty-mcp/auth.json`. Дальше `boosty-api` сам обновляет access-токен по refresh-токену,
так что повторный вход нужен редко.

Профиль браузера сохраняется в `~/.config/boosty-mcp/chrome-profile`: вход в Google (VK и т. п.)
запоминается, и следующий вход в Boosty — один щелчок. Сессия самого Boosty в профиле не остаётся,
она живёт только в `auth.json`. Окно открывается без отладочного порта (с ним Google не пускает),
поэтому сервер ждёт, пока вы закроете окно, и только потом читает cookies.

Если браузер не найден, укажите путь в переменной `BOOSTY_CHROME_PATH`.

## Инструменты

| Группа | Инструменты |
|---|---|
| Аккаунт | `login`, `get_current_user`, `list_subscriptions`, `list_sessions`, `end_sessions`, `get_notification_settings`, `update_notification_setting`, `update_profile`, `update_dialog_settings`, `set_locale`, `list_payment_cards`, `list_blog_currencies` |
| Блог | `get_blog`, `list_subscription_levels`, `get_subscription_level`, `list_subscribers`, `list_blacklist`, `list_unsubscribe_reasons` |
| Цели | `list_targets`, `get_target`, `create_target`, `update_target`, `delete_target` |
| Доход | `list_donations`, `list_post_sales`, `list_bundle_sales`, `list_holds`, `list_broadcast_sales`, `get_paid_sales_by_date`, `get_paid_sales_days`, `list_payout_methods`, `list_payouts`, `list_payout_history`, `get_default_currency` |
| Статистика | `get_stats_summary`, `get_stats_metrics`, `get_stats_charts`, `list_stats_events`, `list_visit_sources`, `list_payment_sources`, `get_referral_stats`, `list_referral_users`, `search_subscribers`, `get_post_stats`, `build_report`, `get_report_info` |
| Посты | `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`, `get_post_deferred_access`, `update_post_deferred_access`, `list_media`, `get_feed`, `like_post`, `unlike_post`, `react_to_post`, `remove_post_reaction` |
| Поиск | `search_blogs`, `suggest_blogs`, `search_feed_posts`, `search_blog_posts`, `search_feed_tags` |
| Опросы | `get_poll`, `list_poll_voters`, `vote_poll`, `unvote_poll` |
| Комментарии | `list_comments`, `list_comment_replies`, `create_comment`, `like_comment`, `unlike_comment`, `react_to_comment`, `remove_comment_reaction` |
| Сообщения | `list_dialogs`, `get_dialog_with_user`, `create_dialog`, `list_messages`, `send_message` |
| Уведомления | `list_notifications`, `mark_notifications_read`, `delete_notification`, `delete_notifications` |

Доход и статистика доступны только владельцу блога; в донатах, событиях и выплатах есть e-mail и
платёжные реквизиты.

Списки листаются курсором: передайте `offset` из `extra.offset` предыдущей страницы.

В ответах текстовые блоки Boosty (Draft.js в JSON-строках) свёрнуты в одно поле `text`;
картинки, видео и файлы остаются в `data`.

## Разработка

```bash
npm test    # сборка + проверки
```
