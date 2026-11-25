# Contributing to Echo

Thanks for your interest in improving Echo!

## Reporting bugs

Email **security@vrseclabs.in** with steps to reproduce, your OS and Echo version, or open a GitHub issue. Security issues should always go to the email address, never a public issue.

## Getting started

```bash
git clone https://github.com/VRSECLABS-PVT-LTD/echo.git
cd echo
npm install
npm start
```

You'll need Node.js 22+ and [Ollama](https://ollama.com/download) with a model such as `llama3.2:3b`.

## Before opening a pull request

- Run `npm test`. The unit tests must pass on every platform (CI runs them on macOS, Windows and Linux).
- If you touched the agent, tools or integrations, also run `npm run test:model`.
- Keep the privacy promises intact: no new network destinations, telemetry or remote content. If a feature needs the network, it must be opt-in, visible in the network log, and respect local-only mode.
- Anything that changes the outside world (writes, calls, device control) must ask the user first.
- Match the existing code style. The code is plain CommonJS JavaScript with no build step.

## Ideas welcome

New tools (to-dos, notes, budgets), more platform integrations, translations, accessibility, and better small-model prompting.

By contributing, you agree that your contributions are licensed under the GPL-3.0.
