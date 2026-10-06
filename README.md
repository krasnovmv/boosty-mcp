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
| Аккаунт | `login`, `get_current_user` |
| Блог | `get_blog`, `list_subscription_levels`, `list_subscribers`, `list_blacklist`, `get_sales` |
| Посты | `list_posts`, `get_post`, `delete_post`, `list_media`, `get_feed`, `search_blogs`, `like_post`, `unlike_post` |
| Комментарии | `list_comments`, `list_comment_replies`, `create_comment` |
| Сообщения | `list_dialogs`, `get_dialog_with_user`, `create_dialog`, `list_messages`, `send_message` |

Списки листаются курсором: передайте `offset` из `extra.offset` предыдущей страницы.

В ответах текстовые блоки Boosty (Draft.js в JSON-строках) свёрнуты в одно поле `text`;
картинки, видео и файлы остаются в `data`.

## Разработка

```bash
npm test    # сборка + проверки
```
