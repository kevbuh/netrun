# Privacy Features

Netrun is a privacy-first browser. This document covers the built-in privacy protections.

## DNS-over-HTTPS (DoH)

DNS queries are encrypted by default so your ISP and network operators cannot see the domains you visit.

### How it works

- Uses Chromium's native `app.configureHostResolver()` API
- Mode: **secure** -- all DNS queries go over HTTPS. If DoH causes issues on a restrictive network (corporate, hotel, airplane WiFi), users can toggle it off in Settings
- Active from the very first network request (configured in `app.whenReady()` before the renderer loads)

### Providers

| Provider   | URL                                    | Notes                       |
|------------|----------------------------------------|-----------------------------|
| Cloudflare | `https://1.1.1.1/dns-query`           | Default. Fast, no-log policy |
| Quad9      | `https://9.9.9.9/dns-query`           | Blocks known malicious domains |
| Mullvad    | `https://194.242.2.4/dns-query`       | Privacy-focused, no logging  |

IP-based URLs are used instead of hostnames (e.g. `1.1.1.1` instead of `cloudflare-dns.com`) to avoid a bootstrapping problem where the DoH server's hostname itself would need a plain DNS lookup to resolve.

Google DNS is intentionally omitted since the goal is privacy.

### Settings

| Key           | Default      | Scope  |
|---------------|-------------|--------|
| `dohEnabled`  | `'true'`    | Local  |
| `dohProvider` | `'cloudflare'` | Local |

Both are device-local (not synced) because DNS configuration depends on the local network.

Location: **Settings > Browser > Privacy > Encrypted DNS**

### Startup flow

1. `app.whenReady()` calls `applyDoH(true, 'cloudflare')` -- encrypted DNS is active before any page loads
2. Renderer boots, `browse-state.js` syncs the user's saved provider/enabled state to the main process
3. Toggling in Settings calls `electronAPI.dohSetConfig()` for immediate effect

## Ad Blocker

Built-in ad and tracker blocking powered by adblock-rs (Brave's adblock engine).

- **Filter lists**: EasyList, EasyPrivacy, HideYTShorts
- **Network-level**: Blocks requests before they reach the page
- **Cosmetic filtering**: Hides ad elements via CSS selectors
- **Always on** by default; filter lists can be updated from Settings > Browser > Privacy
