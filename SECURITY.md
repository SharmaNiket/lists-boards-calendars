# Security

People run this app on their home networks, so security reports are taken seriously.

## Reporting a problem

**Please do not open a public issue for a security problem.** Report it privately instead:

1. Open this repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what an attacker could do with it.

Only the maintainer can see these reports. You will get a reply as soon as practical, usually within a couple of weeks. Once a fix is out, you will be credited in the advisory unless you would rather not be.

## What is supported

Only the latest version on `main` gets fixes. There are no release branches.

## What to keep in mind when running it

- The app has a single optional passphrase (`LB_PASSWORD`) and no user accounts. Treat it as a private tool.
- **Do not expose it directly to the internet.** Reach it from outside your home through a VPN such as WireGuard or Tailscale.
- Over plain `http://` on your local network, traffic is not encrypted. Put it behind a reverse proxy with HTTPS if that matters on your network.
- Your data is in `data/`. Back that folder up, and keep it out of anything you share.
