# Push Relay

## Provider-neutral requests

Relay routes do not change. Legacy APNs clients omit `push_provider` and use `apns_token`. FCM clients use `push_provider: "fcm"` and `push_token`.

## FCM configuration

Configure FCM with `WHISPEROPENCODE_PUSH_FCM_PROJECT_ID` and `WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON`. The service account needs only Firebase Cloud Messaging send permission for the Android Firebase project.

Never log the service account JSON value or registration tokens. If FCM configuration is absent, only FCM delivery is disabled; APNs remains operational.

## Local mock

```sh
WHISPEROPENCODE_PUSH_APNS_MODE=mock \
WHISPEROPENCODE_PUSH_FCM_MODE=mock \
rtk bun run --cwd packages/push-relay dev
```

`/health` returns `{ "ok": true }`.

## Verification

```sh
rtk bun run --cwd packages/push-relay test
rtk bun run --cwd packages/push-relay typecheck
```
