# DeepSage

[English](README.md) | 简体中文

DeepSage 是一个非官方的 DeepSeek API 安卓（及网页）客户端。界面接近官方 App，对话在本地直接请求 API，没有自建应用后端。

**本项目与 DeepSeek 官方无关，也未获得官方授权或背书。** DeepSeek 及其标识归各自权利人所有，请不要把本应用当成官方产品。

当前版本：**0.2.3**（`versionCode` 5）。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支
- 流式回答、深度思考、智能搜索、链接阅读与来源引用
- 语音输入和回复朗读，四种官方风格音色（贝壳 / 白浪 / 海星 / 暗潮）
- 消息级对话搜索（例如搜「小鱼」也能命中「小肥鱼」），结果会保留
- 历史导入导出，兼容官方应用的历史格式
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表
- 简体中文与英文，默认浅色主题，也支持深色主题

## 环境

- [Node.js](https://nodejs.org/) 22 及以上，以及 [pnpm](https://pnpm.io/)
- 打安卓包还需要 JDK 21 和 Android SDK（minSdk 24，targetSdk 36）

## 网页开发

```sh
git clone https://github.com/wu352947-cmd/DeepSage.git
cd DeepSage
pnpm install
pnpm dev
```

打开 http://localhost:8090 ，首次聊天前请在设置里填写 DeepSeek API Key。密钥只保存在本机的 localStorage。

```sh
pnpm build
```

静态产物在 `dist/`。

## 安卓构建

```sh
pnpm install
pnpm build
pnpm exec cap copy android
```

然后在 `android/` 目录用 Gradle 打包：

```sh
# 调试包（调试证书）
./gradlew :app:assembleDebug

# 正式包（需要你自己的签名证书，见下文）
./gradlew :app:assembleRelease
```

正式包一般在 `android/app/build/outputs/apk/release/`。

### 正式包签名

**不要**把密钥库、密码或 API Key 提交进仓库。

1. 生成密钥库，例如：

   ```sh
   keytool -genkeypair -v -keystore android/app/release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias deepsage
   ```

2. 将 `android/keystore.properties.example` 复制为 `android/keystore.properties`，填写 `storeFile`、`storePassword`、`keyAlias` 和 `keyPassword`。其中 `storeFile` 相对于 `android/` 目录（例如 `app/release.jks`）。

如果没有 `keystore.properties`，正式构建仍可编译，但不会用正式证书签名。

## 常用命令

| 命令           | 用途                |
| -------------- | ------------------- |
| `pnpm dev`     | 启动开发服务器      |
| `pnpm build`   | 构建到 `dist/`      |
| `pnpm type`    | TypeScript 类型检查 |
| `pnpm lint`    | oxlint 检查         |
| `pnpm format`  | oxfmt 格式化        |

## 数据与隐私

API Key 和设置保存在应用/浏览器的 localStorage，会话和附件原件保存在 IndexedDB（安卓上是 WebView 本地存储）。数据留在本机；发送对话、上传附件或使用语音功能时，相应内容会提交给所配置的 API 服务。

## 安全

不要提交 `.env` 文件、`android/keystore.properties`、`*.jks` 或 `*.keystore`。详见 [SECURITY.md](SECURITY.md)。

## 致谢

网页对话核心基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）。DeepSage 在此之上增加了 Capacitor 安卓壳、接近官方应用的移动端界面、对话搜索、键盘与排版修复，以及音色选择等能力。

## 许可证

[MIT](LICENSE)。
