<p align="center">
  <img src="favicon.jpg" alt="Jellychat Logo" width="200"/>
</p>

<h1 align="center">Jellychat</h1>

<p align="center">
  <strong>The ultimate local-first, privacy-focused chat platform. Built for your home lab, your friends, and your devices.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Tailscale-FFFFFF?style=flat-square&logo=tailscale&logoColor=black" alt="Tailscale" />
  <img src="https://img.shields.io/badge/SQLite-07405E?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
</p>

## 📖 What is Jellychat?
Jellychat is a powerful, self-hosted communication hub built to run seamlessly over a private Tailscale network. We wanted to build something that bridges the gap between ultra-secure messaging and all the fun, advanced features you'd expect from a modern platform—like group video calls, shared whiteboards, retro arcade emulation, and even direct AI image generation—all running securely on your own hardware without relying on third-party cloud providers.

## 🚀 The Feature Breakdown

### 🎨 Stunning Glassmorphism UI
We ditched the boring flat designs for a premium, translucent aesthetic. Complete with frosted glass effects, buttery smooth micro-animations, and dynamic background glow themes (like Cyberpunk, Ocean, and Sunset) that you can swap out on the fly. 

### 💬 Real-Time Messaging Done Right
- **Rich Media:** Drag-and-drop file uploads, inline images, and full Markdown support.
- **Organization:** Threaded direct replies and emoji reactions.
- **Direct Messages:** Keep things private with 1-on-1 DMs that live entirely outside the global channels.

### 🎥 Voice, Video, & Streaming (WebRTC)
Jump into a voice channel and hang out! 
- **Group Video Calls:** Seamlessly share your webcam (with front/back camera flipping on mobile devices).
- **Screen Sharing:** Broadcast your desktop or apps directly to the channel.
- **Broadcaster Previews:** See exactly what you're transmitting via local, muted preview tiles.
- **Native Fullscreen:** Tap any stream on your phone to throw it into the native OS media player for true horizontal fullscreen viewing.
- **Sidebar Facepile:** See who is already hanging out in a channel before you even join via a sleek, overlapping avatar display.

### 🖌️ Collaborative Whiteboarding
Doodle with your friends in real time! We built a high-performance, multiplayer canvas that syncs live mouse pointers and brush strokes instantly. Includes an advanced toolset (varying brush sizes, color pickers, and a localized Undo/Redo stack). You can even launch private whiteboards inside your 1-on-1 direct messages!

### 🔒 True Privacy (End-to-End Encryption)
Your DMs are natively encrypted using the browser's Web Crypto API (AES-GCM). The server only holds public keys to persist device identities, meaning it literally cannot read your private messages even if it wanted to.

### 🌐 Tailscale Integration & Guest Access
Jellychat is built to thrive on a Tailnet. It automatically interfaces with the Tailscale API to spin up temporary auth keys, turning them into copyable guest invite links and QR codes so you can securely onboard friends without exposing open ports to the wild internet.

### 🕹️ Built-in Emulator Arcade
Yeah, you read that right. There's a retro gaming emulator embedded directly into the chat interface for multiplayer netplay and solo gaming. Just drop your legally sourced ROMs into the `/roms` folder and start playing together directly inside the app.

### 🤖 Local AI Image Generation
Hook Jellychat directly into your local ComfyUI instance. Drop a prompt into the chat, and the backend handles passing it through your local `workflow.json` (like Stable Diffusion), polling the history, and spitting the fully generated image directly back into the chat. Zero dependencies on paid APIs.

### 👑 Admin & Profile Management
No passwords required. A secure Admin Dashboard allows network administrators to assign specific IP addresses to customized profiles. When your friends connect, they automatically get their specific display names, avatars, and admin privileges assigned based on their device. Also features custom statuses (Online, Idle, DND, Offline) with completely custom text!

### 🎙️ Voice Memos & Audio Playback
Native support for recording and sharing voice messages, complete with an interactive audio waveform rendered directly inside the chat bubble via WaveSurfer.js.

### 📱 Progressive Web App (PWA)
Jellychat is fully installable on mobile and desktop devices. It features VAPID push subscriptions for background notifications and touch-action CSS optimizations that prevent clunky web-zooming, giving you a true, native-app feel on your phone.

---

## 🛠️ Getting Started (Setup Instructions)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A [Tailscale](https://tailscale.com/) account and configured Tailnet
- *(Optional)* A local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) instance for AI generation

### 1. Configuration
Create a `.env` file in the `backend` directory of your project and configure the following environment variables:

```env
# The port the backend server will listen on
PORT=3000

# Database path relative to the backend root directory
DB_PATH=./database.sqlite

# Tailscale API Key for managing network nodes and guest access
TAILSCALE_API_KEY=your_tailscale_api_key_here

# Your specific Tailnet Name (e.g., tailnet-xyz.ts.net)
TAILNET_NAME=your_tailnet_name_here

# ComfyUI Endpoint for the local AI Image Generation feature
COMFYUI_URL=http://your_comfyui_ip:8188
```

*(Note: If you have a custom ComfyUI workflow, just drop your `workflow.json` into the backend directory!)*

### 2. Installation & Running

Fire up your terminal and clone the repository. You'll need to run both the backend server and the frontend client.

**Start the Backend:**
```bash
cd backend
npm install
npm run start
```

**Start the Frontend:**
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

That's it! Open the provided local IP address in your browser on any device on your network and start chatting. If you want the full native experience on your phone, just tap "Add to Home Screen" from your mobile browser!