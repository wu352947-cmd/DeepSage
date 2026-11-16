# Security

## What not to commit

Never add any of the following to git:

- API keys, `.env`, or `.env.local`
- `android/keystore.properties`
- `*.jks` / `*.keystore` files, or signing passwords

If a secret is committed by mistake, rotate it immediately (revoke the API key, generate a new keystore) and treat the old value as public.

## Reporting a vulnerability

Please open a private GitHub security advisory on this repository if you can, or open an issue without including secrets. Do not attach keystores, `.env` files, or API keys.
