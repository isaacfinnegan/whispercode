# @whisperopencode/push

Push notification plugin for [opencode](https://github.com/nicholasgrass/opencode). Sends mobile alerts when long-running sessions complete.

## Install

```sh
npm install @whisperopencode/push
```

## CLI usage

```
opencode-push <install|pair|status|test|unpair|devices|remove-device> [--pair <token>] [--relay <url>] [--server <label>] [--plugin <spec>] [--device <id>] [--json]
```

Pair with a mobile device:

```sh
npx --yes --prefix . --package=@whisperopencode/push opencode-push pair --pair <token>
```

`opencode-push pair` only claims the relay pair token and writes the local push state used by the host plugin.

`opencode-push install` is the manual all-in-one command. It writes an unpinned `@whisperopencode/push` entry to your OpenCode config so the host can track the latest plugin release, and it also accepts `--pair <token>` for backward compatibility. Pass `--plugin <spec>` if you want to pin a version instead.

## Plugin usage

Add to your opencode config:

```jsonc
{
  "plugin": ["@whisperopencode/push"],
}
```

With an active device registration, the plugin sends notification-worthy events directly from the OpenCode backend. Existing installations explicitly configured with `mode: "relay"` continue to check in and publish through the legacy relay instead.

## Backend FCM configuration

Each controlled OpenCode backend that sends notifications directly needs the Firebase credential in its private environment:

```sh
export WHISPEROPENCODE_PUSH_FCM_PROJECT_ID="whispercode-pushes"
export WHISPEROPENCODE_PUSH_FCM_SERVICE_ACCOUNT_JSON="$(< /secure/path/firebase-service-account.json)"
```

The service-account JSON must not be committed or logged. Third-party backends need their own Firebase project or must use an explicitly trusted broker; do not give an untrusted backend this credential.

## License

MIT
