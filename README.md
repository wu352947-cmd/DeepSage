# DeepSage

English | [简体中文](README.zh-CN.md)

DeepSage is an unofficial Android (and web) client for the [DeepSeek](https://www.deepseek.com/) API. The interface is modeled on the official app, and chats run on-device against the API — there is no application backend.

**This project is not affiliated with, endorsed by, or official to DeepSeek.** DeepSeek and its logos are trademarks of their owners. Please do not treat this app as an official product.

Current version: **0.2.3** (`versionCode` 5).

## Features

- Multi-conversation chat with automatic titles, renaming, deletion, prompt editing, regeneration, and branch switching
- Streaming replies, deep thinking, web search, link reading, and source citations
- Voice input and read-aloud, with four official-style voices (贝壳 / 白浪 / 海星 / 暗潮)
- Message-level conversation search (for example, searching `小鱼` also matches `小肥鱼`), with persistent results
- History import and export, including official-app history shapes
- Markdown, syntax highlighting, KaTeX, and Mermaid
- Simplified Chinese and English, light theme by default, plus a dark theme

## Requirements

- [Node.js](https://nodejs.org/) 22 or later, and [pnpm](https://pnpm.io/)
- For Android builds: JDK 21 and Android SDK (minSdk 24, targetSdk 36)

## Web development

```sh
git clone https://github.com/wu352947-cmd/DeepSage.git
cd DeepSage
pnpm install
pnpm dev
```

Open http://localhost:8090 and enter your DeepSeek API key in Settings before the first chat. The key is stored only in the browser's localStorage on your device.

```sh
pnpm build
```

The static site is written to `dist/`.

## Android build

```sh
pnpm install
pnpm build
pnpm exec cap copy android
```

Then build with Gradle from `android/`:

```sh
# Debug APK (debug keystore)
./gradlew :app:assembleDebug

# Release APK (requires your own keystore; see below)
./gradlew :app:assembleRelease
```

The signed release output is typically `android/app/build/outputs/apk/release/`.

### Release signing

Do **not** commit a keystore, passwords, or API keys.

1. Generate a keystore, for example:

   ```sh
   keytool -genkeypair -v -keystore android/app/release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias deepsage
   ```

2. Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. `storeFile` is relative to the `android/` directory (for example `app/release.jks`).

If `keystore.properties` is missing, a release build will still compile but will not be signed with a release certificate.

## Development commands

| Command        | Description                  |
| -------------- | ---------------------------- |
| `pnpm dev`     | Start the development server |
| `pnpm build`   | Build into `dist/`           |
| `pnpm type`    | TypeScript type checks       |
| `pnpm lint`    | Lint with oxlint             |
| `pnpm format`  | Format with oxfmt            |

## Data and privacy

Your API key and settings are stored in the app/browser localStorage. Conversations and original attachments are stored in IndexedDB (or the WebView's local storage on Android). Data stays on the device; sending messages, uploading attachments, or using speech features submits the relevant content to the configured API service.

## Security

Never commit `.env` files, `android/keystore.properties`, `*.jks`, or `*.keystore`. See [SECURITY.md](SECURITY.md).

## Credits

The web chat core is based on [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) (MIT). DeepSage adds a Capacitor Android shell, official-app-style mobile UI, conversation search, keyboard/layout fixes, and voice-picker work.

## License

[MIT](LICENSE).
