# Security Policy

VRSecLabs takes the security of Echo seriously. Thank you for helping keep its users safe.

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Email **[security@vrseclabs.in](mailto:security@vrseclabs.in)**. You can also report privately through GitHub: the repository's **Security** tab → **Report a vulnerability**.

The same address works for ordinary bug reports and feedback.

Please include:
- the affected version and operating system
- steps to reproduce, or a proof of concept
- the impact you believe it has

We aim to acknowledge reports within 3 working days and to keep you updated until a fix ships. We're happy to credit researchers in the release notes unless you'd rather stay anonymous.

## Scope

Of particular interest:
- reading Echo's encrypted data without the user's OS keychain
- making Echo contact a host the user didn't configure, or bypassing local-only mode
- prompt-injection paths that trigger approval-gated actions (writes, calls, smart-home control) without approval
- escaping the renderer sandbox or abusing IPC
- leaking API tokens

## Security design (summary)

- Renderers are sandboxed with context isolation, no Node integration, a strict Content-Security-Policy, and no remote content.
- Each window can only reach its own IPC channels, and the main process verifies the sender.
- Data at rest uses AES-256-GCM with a key wrapped by the OS keychain.
- API calls are restricted to the configured origin. Redirects are blocked, path traversal is rejected, and every non-GET request needs explicit approval.
- Smart-home actions and phone calls always require approval.
