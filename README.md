<p align="center">
  <img src="jellychat_logo.png" alt="Jellychat Logo" width="200"/>
</p>

<h1 align="center">Jellychat</h1>

<p align="center">
  <strong>A local-first, privacy-focused chat platform built for your home lab and Tailscale network.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Tailscale-FFFFFF?style=flat-square&logo=tailscale&logoColor=black" alt="Tailscale" />
  <img src="https://img.shields.io/badge/SQLite-07405E?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
</p>

## What is Jellychat?
Jellychat is a self-hosted communication hub built to run seamlessly over a private Tailscale network. We wanted to build something that bridges the gap between secure messaging and advanced features like group video calls, shared whiteboards, retro arcade emulation, and direct AI integrations—all running locally on your own hardware without relying on cloud providers.

## Features

### Real-Time Messaging & Media
- **Rich Media:** Drag-and-drop file uploads, inline images, and full Markdown support.
- **Ephemeral Messages:** Set a self-destruct timer (30s to 24h) for messages that automatically vanish from the server and clients once time is up.
- **Organization:** Threaded direct replies and emoji reactions.
- **Direct Messages (E2EE):** Private 1-on-1 DMs are natively encrypted using the browser's Web Crypto API (AES-GCM). The server only holds public keys to persist device identities.
- **P2P Large File Transfer:** Send massive files (movies, ROMs, ISOs) directly between clients using WebRTC Data Channels. Zero server storage footprint.

### Voice, Video & Streaming
- **WebRTC Voice Channels:** Jump into a voice channel and hang out. Features **Push-To-Talk (PTT)** toggles and a dynamic Web Audio API **Audio Visualizer** that makes avatars glow when speaking.
- **Group Video Calls & Screen Share:** Share your webcam (with mobile front/back flip support) or broadcast your desktop directly to the channel.
- **Broadcaster Previews & Native Fullscreen:** See local muted preview tiles before transmitting. On mobile, tap any stream to use the native OS media player for true horizontal fullscreen viewing.
- **Sidebar Facepile:** See who is hanging out in a channel at a glance with overlapping avatars.

### Advanced Integrations
- **Built-in Emulator Arcade:** A retro gaming emulator is embedded directly into the chat. Drop legally sourced ROMs into the `/roms` folder and play together via Netplay. Includes automatic Cloud Save States so you can resume where you left off.
- **Collaborative Whiteboarding:** A high-performance, multiplayer canvas that syncs live mouse pointers and brush strokes instantly. Support for private whiteboards inside 1-on-1 direct messages.
- **Local AI Integrations:** 
  - **Image Generation:** Connects directly to a local ComfyUI instance. Drop a prompt into the chat, and the backend processes it using your `workflow.json` (e.g., Stable Diffusion).
  - **@Jellybot:** Mention `@Jellybot` in chat to trigger your local LLM (via Open WebUI API). Supports streaming responses with a typewriter effect, fully contained within your network.

### Gaming Hub & Integrations
- **Game Server Browser:** Automatically detects and queries active game servers hosted on your local network (supports Source engine, Minecraft, Palworld, and more).
- **Steam Rich Presence:** Opt-in to broadcast your current Steam game directly into the chat.
- **Server Deep-Dive Inspector:** Click on active game servers to view rich metadata, player lists, and current maps, backed by dynamically fetched Steam Workshop/App banners.
- **Modpack & Workshop Sync Hub:** Easily align mods with peers before gaming! Drop a Steam Workshop Collection URL to automatically generate a rich chat embed with a "Subscribe in Steam" direct link (`steam://` protocol) for instant syncing.

### Admin & Network Management
- **Tailscale Guest Invites:** Generate time-limited (or permanent) Tailscale guest invite keys directly from the UI. These automatically tag users as `tag:guest` for ACL management, letting friends connect without exposing open ports.
- **Profile Management:** No passwords required. The Admin Dashboard lets you assign IP addresses to customized profiles. When friends connect, they get their assigned display names, avatars, and admin privileges based on their device.
- **Custom Statuses:** Set Online, Idle, DND, or Offline statuses with custom text.

### Progressive Web App (PWA)
- Fully installable on mobile and desktop devices. 
- Features VAPID web-push subscriptions for background notifications (iOS supported).
- Touch-action CSS optimizations prevent clunky web-zooming for a native-app feel.
- Voice memos support with interactive audio waveforms via WaveSurfer.js.

---

## Setup Instructions

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Tailscale](https://tailscale.com/) account and configured Tailnet
- *(Optional)* [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (for AI images) and [Open WebUI](https://github.com/open-webui/open-webui) (for @Jellybot)

### 1. Configuration
Create a `.env` file in the `backend` directory with the following variables:

```env
# The port the backend server will listen on
PORT=3000

# Database path relative to the backend root directory
DB_PATH=./database.sqlite

# Tailscale settings for managing guest invites
TAILSCALE_API_KEY=your_tailscale_api_key_here
TAILSCALE_TAILNET=your_tailnet_name_here # e.g., yourname@github or tailnet-xyz.ts.net

# Optional AI Endpoints
COMFYUI_URL=http://your_comfyui_ip:8188
OPENWEBUI_URL=http://your_openwebui_ip:3000
OPENWEBUI_API_KEY=your_api_key_here
```

*(Note: If using ComfyUI, place your `workflow.json` in the backend directory.)*

### 2. VAPID Keys for Push Notifications
On first run, the backend will automatically generate `vapidKeys.json` in the `backend` directory. No manual setup is required unless you are migrating servers.

### 3. Installation & Running
You'll need to run both the backend server and the frontend client.

**Start the Backend:**
```bash
cd backend
npm install
npm start
```

**Start the Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open the provided local IP address in your browser on any device on your network. To get the native mobile experience, tap "Add to Home Screen" from your mobile browser (required for iOS push notifications).
