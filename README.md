# ByteBridge

ByteBridge is a local network file-sharing tool. Start it on one device, open the shown URL (or scan the QR code) from another device on the same Wi-Fi, then send files directly through your local network.

## Features

- Share files between phones, tablets, and laptops on the same LAN/Wi-Fi
- Device-aware send/approve flow for private transfers
- Browser-based UI (no mobile app install required)
- Cross-platform launch scripts for macOS, Linux, and Windows
- Automatic fallback to a free port when the default port is busy

## Quick Start

### macOS

1. Double-click `scripts/unix/start.command`
2. On first run it installs ByteBridge into `~/Library/Application Support/ByteBridge/app`
3. Keep the terminal window open while ByteBridge is running

### Linux

1. Run:
  `chmod +x scripts/unix/start.sh scripts/unix/install.sh`
2. Start:
  `./scripts/unix/start.sh`

### Windows

1. Double-click `scripts/windows/start.bat`
2. Approve PowerShell execution if prompted

## Manual Start (developer mode)

From the project folder:

1. Install dependencies:
   `npm ci --omit=dev`
2. Start server:
   `npm start`

## Installer and Update Behavior

- Script defaults to:
  - Repo: `https://github.com/Amool-kk/ByteBridge.git`
  - Branch: `build`
- Override with:
  - `BYTEBRIDGE_REPO`
  - `BYTEBRIDGE_BRANCH`
- If app files are missing, scripts clone the configured branch.
- If app files already exist, scripts ask before pulling updates.
- If Node.js is missing or older than 18, scripts ask before installing/upgrading.

## Environment Variables

- `PORT`
  - Preferred server port (default `3000`)
  - If that port is busy, ByteBridge automatically retries on a free port
- `LFS_DIR`
  - Optional data root for runtime files
  - Default data root: `~/LocalFileShare`

Examples:

- `PORT=4123 npm start`
- `LFS_DIR=/tmp/bytebridge-data npm start`

## Data Storage

By default ByteBridge stores runtime files in:

- `~/LocalFileShare/uploads`

This is separate from the installed app directory so app updates do not remove shared files.

## Troubleshooting

- Another app already uses your default port:
  - ByteBridge prints a warning and binds to a free port automatically.
- QR code does not open on phone:
  - Ensure both devices are on the same Wi-Fi and VPN is off.
- Windows script cannot run:
  - Right-click `scripts/windows/start.bat` and run as normal user, then allow PowerShell if prompted.
- Node install step fails:
  - Install Node.js 18+ manually from `https://nodejs.org` and rerun script.

## Development Notes

- Server entrypoint: `server.js`
- App modules: `src/`
- Static UI: `public/`
- Upload middleware writes to `UPLOAD_DIR` from `src/config.js`
- Build branch sync workflow: `.github/workflows/build-branch.yml`

