# Privacy at Echo

Echo is built on one rule: **your data belongs on your device.** This document explains exactly what Echo stores, where, and when it ever talks to the outside world.

## What Echo stores

All data lives in one folder in your home directory, `~/.echo-vrseclabs` (`%USERPROFILE%\.echo-vrseclabs` on Windows):

| File | Contents |
|---|---|
| `config.json` | Your settings (model, shortcut, currency, privacy toggles, Home Assistant URL/token) |
| `reminders.json` | Pending reminders |
| `expenses.json` | Logged expenses |
| `cards.json` | Credit cards and due days (names only, never card numbers) |
| `memories.json` | Facts you asked Echo to remember |
| `history.json` | Recent conversation (optional, can be turned off) |
| `integrations.json` | Imported API schemas and their tokens |
| `netlog.json` | The network activity log |
| `vault.key` | The data encryption key, itself sealed by your OS keychain |

- **Encryption:** every file is encrypted with AES-256-GCM. The random 256-bit key is wrapped by macOS Keychain, Windows DPAPI, or the Linux Secret Service (GNOME Keyring / KWallet). Tampered files fail authentication and are never silently overwritten.
- **Permissions:** the folder is created with owner-only permissions (`0700`, files `0600`).

## What Echo sends, and to whom

| Connection | When | Destination |
|---|---|---|
| Local AI engine | Every message | `127.0.0.1:11434` (Ollama on your machine, never leaves it) |
| Model download | Only during setup, when you choose a model | Ollama's model registry, through Ollama |
| Links you click | Only when you click them | `vrseclabs.in` and `ollama.com/download` |
| Home Assistant | Only when you ask | Your Home Assistant, which must be on your local network |
| API integrations | Only APIs you add, only when you ask | The exact host you configured. Internet hosts are blocked while **local-only mode** is on (the default). |
| Phone calls | Only after you approve | Your phone, via the OS (Continuity / Phone Link / `tel:` handler) |

Every connection in this table except the local AI engine is recorded in **Settings → Privacy → Network activity log**.

Echo has **no** telemetry, analytics, crash reporting, auto-update pings, accounts or ads. Chromium's background networking, component updater, domain reliability and hyperlink pings are disabled, and Echo's windows are blocked from loading any non-local resource.

## Your controls

- **Local-only mode:** on by default.
- **Keep chat history:** turn it off and the conversation is forgotten when Echo quits.
- **Forget:** say "forget that my doctor is Dr. Mehta", or remove reminders and cards by asking.
- **Erase all Echo data:** Settings → Privacy. This deletes every file above, including the encryption key. It can't be undone.

## Models

The AI models (Llama 3.2, Qwen 2.5) run inside Ollama on your computer. Echo never sends your prompts to the model authors or anyone else.

## Questions

Email [security@vrseclabs.in](mailto:security@vrseclabs.in), or visit [vrseclabs.in](https://vrseclabs.in).
