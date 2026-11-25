# Echo by VRSecLabs: product page copy for vrseclabs.in

> Ready-to-use copy, section by section, in page order. Each section has a short **layout note** for the designer.
> Brand colours used in the app: background `#0b0f14`, panels `#121923`, accent green `#00e5a0`, accent cyan `#22d3ee`, text `#e6edf3`.
> Assets: app icon `assets/icon.png` (1024 px). Screenshots of the chat window, setup wizard and privacy settings can be captured from the app.

---

## SEO

- **Page title:** Echo by VRSecLabs: The Private AI Assistant That Runs on Your Computer
- **Meta description:** Echo is a free, open-source AI assistant for macOS, Windows and Linux. Reminders, calendar, expenses, bills and smart home, all on-device and encrypted, with no cloud and no account.
- **Suggested URL:** `vrseclabs.in/echo`
- **Keywords:** private AI assistant, offline AI assistant, local LLM app, on-device AI, open-source AI assistant, privacy-first assistant, Ollama desktop app

---

## 1. Hero

**Layout note:** full-width dark hero with the glowing green "Echo" orb from the setup wizard on the right (or centred on mobile). Two buttons. Small trust line under the buttons.

**Eyebrow:** VRSecLabs · Open source

### Your AI assistant. On your computer. Nobody else's.

Echo handles your reminders, calendar, expenses, card bills and smart home, using an AI that runs entirely on your own device. No cloud. No account. No one listening.

**[ Download Echo, free ]**  **[ View source on GitHub ]**

*macOS · Windows · Linux · GPL-3.0 open source · No sign-up*

---

## 2. The promise (three pillars)

**Layout note:** three equal cards, text only, directly under the hero. Use typography and spacing rather than icons or emoji.

**Stays on your device**
Echo runs the AI model locally. What you type never travels to a server, not ours and not anyone's.

**Encrypted by default**
Every reminder, expense and memory is sealed with AES-256-GCM. The key lives in your system keychain.

**Nothing hidden**
No telemetry, no analytics, no ads. If Echo ever connects outside your computer, it's because you asked, and it's listed in a log you can read.

---

## 3. How it works

**Layout note:** a three-step horizontal timeline (vertical on mobile). Show the hotkey as keycaps.

1. **Install in two minutes.** A guided setup installs the free Ollama engine and picks the right AI model for your hardware.
2. **Press ⌥ Space** (Ctrl+Shift+Space on Windows and Linux) from any app. A sleek chat bar appears.
3. **Just say it.** "Remind me to take my medicine at 9pm." Echo does it and gets out of your way.

---

## 4. Features

**Layout note:** a two-column grid of feature tiles (title, one line, example prompt in a quiet "chat bubble"). Eight tiles. No emoji or clip-art icons.

**Reminders that actually remind you**
One-off or repeating, as native notifications. Missed while you were away? Echo tells you when you're back.
> "Remind me to take my vitamins every day at 9am"

**Calendar in a sentence**
Add meetings and appointments without opening a calendar, with an automatic heads-up before each one.
> "Meeting with Rahul tomorrow at 3pm for 30 minutes"

**Expense tracking**
Log credit and debit spends as you go, then ask for a summary.
> "Spent 450 on lunch with my HDFC credit card"

**Never miss a card bill**
Echo alerts you before the due date, on the day, and if it's overdue, until you mark it paid.
> "My Axis card bill is due on the 5th"

**Remembers what matters**
Tell Echo things once. It remembers them, privately, and forgets on request.
> "Remember that I'm allergic to penicillin"

**Smart home, locally**
Discovers HomeKit, Chromecast, Hue and Matter devices, and controls them through Home Assistant on your own network.
> "Turn off the bedroom light"

**Bring your own APIs**
Import any OpenAPI schema, add a token, and Echo can use that service. Tokens are encrypted, and every change needs your OK.
> "What's on my Notion board today?"

**Calls, hands-free**
Place calls through your iPhone or Windows Phone Link, always with your approval.
> "Call Mom"

---

## 5. Privacy, in detail

**Layout note:** a split section. Left: headline and copy. Right: a mock-up or screenshot of Settings → Privacy (the encryption status card and an empty "Nothing has left this computer" network log).

### Don't trust us. Verify us.

Privacy claims are easy to make. Echo is built so you can check them.

- **Local-only mode, on by default.** Echo blocks any request that would leave your network.
- **A network log you can read.** Every outside connection, with time, purpose and host.
- **Encrypted storage.** AES-256-GCM, with the key protected by macOS Keychain, Windows DPAPI or your Linux keyring.
- **Open source under GPL-3.0.** Every line is public. Audit it, build it yourself, improve it.
- **One click to erase everything,** including the encryption key.

**[ Read the privacy policy ]**  **[ Read the code ]**

---

## 6. Comparison

**Layout note:** a simple two-column table, Echo column highlighted in accent green.

| | **Echo** | Typical cloud assistant |
|---|---|---|
| Where the AI runs | **Your computer** | Remote servers |
| Account required | **No** | Yes |
| Works offline | **Yes** | No |
| Telemetry | **None** | Usually |
| Your data | **Encrypted on your disk** | Stored by the provider |
| Source code | **Open (GPL-3.0)** | Closed |
| Price | **Free** | Often a subscription |

---

## 7. Choose your model

**Layout note:** three small cards, with the middle one ("Echo Fast") highlighted as recommended.

- **Echo Lite.** 1.3 GB. For older or low-memory machines.
- **Echo Fast** *(recommended).* 2.0 GB. Instant replies on most computers with 8 GB+ RAM.
- **Echo Pro.** 4.7 GB. Smarter reasoning for machines with 16 GB+ RAM.

*Models run through Ollama, the open-source local AI engine. You can switch models any time.*

---

## 8. Download

**Layout note:** three platform buttons (official OS logos only if brand guidelines allow; otherwise text), plus small print. Point the buttons at the latest GitHub release assets.

### Get Echo, free

**[ macOS ]**  **[ Windows ]**  **[ Linux ]**

Apple Silicon & Intel · Windows 10/11 · AppImage & .deb
Requires about 2–6 GB of free disk space for the AI model. Checksums are published with every release.

---

## 9. FAQ

**Layout note:** accordion.

**Is Echo really free?**
Yes. Echo is open-source software under the GPL-3.0 license.

**Does Echo need the internet?**
Only once during setup, to download the AI model. After that it works fully offline.

**Can VRSecLabs see my data?**
No. Echo has no servers, no accounts and no telemetry. Your data never leaves your computer, and it's encrypted on disk.

**What computer do I need?**
Any recent Mac, Windows or Linux PC. 8 GB of RAM is recommended. 4 GB works with Echo Lite.

**What is Ollama?**
A free, open-source engine that runs AI models locally. Echo's setup installs and configures it for you.

**Can Echo connect to my apps?**
Yes. Import an OpenAPI schema for any service, or connect Home Assistant for your smart home. Internet services are blocked until you turn off local-only mode, and every connection is logged.

**How do I report a bug or a security issue?**
Email security@vrseclabs.in. Security reports are handled privately.

**How do I delete my data?**
Settings → Privacy → *Erase all Echo data*. Everything, including the encryption key, is permanently removed.

---

## 10. About VRSecLabs (trust block)

**Layout note:** a closing band before the footer, with the VRSecLabs wordmark and a short paragraph.

### Built by VRSecLabs

VRSecLabs is a security lab building privacy-first software. We think the most personal tool you use, the assistant that knows your schedule, your spending and your health reminders, should answer to you alone. That's why Echo is local, encrypted and open source.

**[ Explore VRSecLabs ]**  **[ Star Echo on GitHub ]**

*Bugs, security reports and feedback: security@vrseclabs.in*

---

## Short versions (for cards, app stores, social)

- **One-liner:** Echo is a private AI assistant that runs entirely on your computer.
- **Tagline options:** *Your data, your device.* · *The assistant that keeps your secrets.* · *Private by design. Helpful by default.*
- **50 words:** Echo by VRSecLabs is a free, open-source AI assistant for macOS, Windows and Linux. It manages reminders, calendar, expenses, card bills and smart home with a single shortcut, and it runs entirely on your device. Encrypted, no account, no telemetry, and every outside connection logged.
- **Social post:** Meet Echo: your AI assistant, running 100% on your own computer. Reminders, calendar, expenses, bills, smart home. No cloud. No account. Open source. Free. ⌥ Space and go. → vrseclabs.in/echo
