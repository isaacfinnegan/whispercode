# Push Relay

## Requests

The relay delivers through APNs only. Clients send `apns_token` and may omit `push_provider` or set it to `"apns"`. Any other `push_provider` value, including `"fcm"`, is rejected with `bad_push_provider`.

Devices stored by earlier relay versions with `push_provider = 'fcm'` are kept in the database for compatibility but are never delivered, tested, or reported as active.

## Local mock

```sh
WHISPEROPENCODE_PUSH_APNS_MODE=mock \
rtk bun run --cwd packages/push-relay dev
```

`/health` returns `{ "ok": true }`.

## Verification

```sh
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
```
