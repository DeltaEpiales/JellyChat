import { useEffect, useState, useRef } from 'react';
import type { ClipboardEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';
import { Send, Sparkles, Terminal, Activity, Wifi, Paperclip, Loader2, Download, Upload, X, MessageCircle, Menu, Trash2, Monitor, Smartphone, BellRing, FileText, Mic, Square, Play, Pause, Headphones, Reply, Check, CheckCheck, Edit2, Link, Sticker, Search, Video, Phone, MoreVertical, UserPlus, Gamepad2, Users, Copy, Wand2, Plus, Image as ImageIcon, PanelLeft, PenTool, MonitorUp, Settings, Hash, Volume2, Shield } from 'lucide-react';
import { format } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QRCodeSVG } from 'qrcode.react';
import WaveSurfer from 'wavesurfer.js';
import { CollaborativeWorkspace } from './components/CollaborativeWorkspace';
import { VideoCallModal } from './components/VideoCallModal';
import { UserSettingsModal } from './components/UserSettingsModal';
import { ChannelSettingsModal } from './components/ChannelSettingsModal';
import { AdminManagementModal } from './components/AdminManagementModal';
import { GlobalSettingsModal } from './components/GlobalSettingsModal';
import { VoiceChannelManager } from './components/VoiceChannelManager';
import type { CallState } from './components/VideoCallModal';
import { generateKeyPair, exportPublicKey, importPrivateKey, importPublicKey, deriveSharedSecret, encryptText, decryptText } from './crypto';


interface Message {
  id: number;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  channel_id?: string;
  content: string;
  type?: string;
  attachmentUrl?: string;
  fileName?: string;
  timestamp: string;
  reactions?: string;
  stickers?: string;
  replyToId?: number;
  status?: string;
  isEdited?: number;
}

export interface Me {
  id: string;
  ip: string;
  deviceName: string;
  isAdmin: boolean;
  statusData?: {
    status: string;
    text: string;
  };
}

export interface Peer {
  ip: string;
  name: string;
  os: string;
  isJellychatOnline: boolean;
  latency?: number;
  activity?: { type: string, details: string, url?: string, core?: string };
  statusData?: { status: string, text: string };
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  type: 'text' | 'voice';
}

const getAttachmentSrc = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('blob:')) return url;
    // URL is already a relative path like /api/files/...
    return url;
};

const forceDownload = (attachmentUrl: string, filename: string) => {
    if (!attachmentUrl) return;
    
    // External URLs open in new tab
    if (!attachmentUrl.startsWith('/uploads/')) {
        window.open(getAttachmentSrc(attachmentUrl), '_blank');
        return;
    }
    
    const fileUrl = encodeURIComponent(attachmentUrl);
    const downloadName = encodeURIComponent(filename || 'download');
    const downloadUrl = `/api/download?url=${fileUrl}&filename=${downloadName}`;

    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // iOS PWA Trap Fix: Use a hidden iframe to trigger the download prompt silently
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = downloadUrl;
        document.body.appendChild(iframe);
        setTimeout(() => document.body.removeChild(iframe), 5000);
    } else if (/Android/i.test(navigator.userAgent)) {
        window.location.href = downloadUrl;
    } else {
        // Desktop
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename || 'download';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

const playNudgeSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
        console.error('Audio error', e);
    }
};

const AudioPlayer = ({ url, isMe }: { url: string, isMe: boolean }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const waveformRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);

    useEffect(() => {
        if (!waveformRef.current) return;

        const ws = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: isMe ? 'rgba(255,255,255,0.4)' : 'rgba(244,63,94,0.4)',
            progressColor: isMe ? 'rgba(255,255,255,0.9)' : 'rgba(244,63,94,0.9)',
            barWidth: 2,
            barGap: 2,
            barRadius: 2,
            height: 24,
            url: url
        });

        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));
        ws.on('finish', () => setIsPlaying(false));

        wavesurferRef.current = ws;

        return () => {
            ws.destroy();
        };
    }, [url, isMe]);

    const togglePlay = () => {
        if (wavesurferRef.current) {
            wavesurferRef.current.playPause();
        }
    };

    return (
        <div className={`p-3 rounded-2xl flex items-center gap-3 min-w-[200px] md:min-w-[240px] backdrop-blur-md border border-white/5
            ${isMe ? 'bg-white/10 shadow-[0_4px_15px_-6px_rgba(244,63,94,0.3)]' : 'glass-card'}
        `}>
            <button onClick={togglePlay} className={`p-2.5 rounded-full flex-shrink-0 transition-transform hover:scale-105 ${isMe ? 'jelly-gradient text-white shadow-md' : 'bg-white/10 text-white/90 shadow-sm'}`}>
                {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>
            <div className="flex flex-col flex-1 gap-1">
                <div ref={waveformRef} className="w-full h-[24px]"></div>
                <div className={`text-[10px] font-bold tracking-wide uppercase ${isMe ? 'text-white/70' : 'text-white/50'} flex items-center gap-1.5`}>
                    <Headphones size={10} /> Voice Memo
                </div>
            </div>
        </div>
    );
};

const EMOJIS = ['❤️', '😂', '🔥', '👍', '😮', '😢'];

const LinkPreview = ({ url, previewData }: { url: string, previewData: any }) => {
    if (!previewData) return null;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 flex flex-col sm:flex-row bg-black/20 hover:bg-black/30 border border-white/10 rounded-xl overflow-hidden transition-all text-left max-w-sm">
            {previewData.images && previewData.images[0] && (
                <div className="w-full sm:w-24 h-24 shrink-0 bg-black/40">
                    <img src={previewData.images[0]} alt="Preview" className="w-full h-full object-cover" />
                </div>
            )}
            <div className="p-3 flex flex-col justify-center overflow-hidden">
                <h4 className="font-bold text-[13px] text-white/90 truncate">{previewData.title || url}</h4>
                <p className="text-[11px] text-white/60 line-clamp-2 mt-1 leading-snug">{previewData.description}</p>
                <span className="text-[10px] text-white/40 mt-1.5 flex items-center gap-1 font-medium">
                    <Link size={10} />
                    {new URL(url).hostname}
                </span>
            </div>
        </a>
    );
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function App() {
  const [preserves, setPreserves] = useState<{id: string, name: string, url: string}[]>(() => {
      const saved = localStorage.getItem('tailchat_preserves');
      if (saved) return JSON.parse(saved);
      return [{ id: 'local', name: 'Home Server', url: window.location.origin }];
  });
  const [activePreserveId, setActivePreserveId] = useState('local');
  const activePreserve = preserves.find(p => p.id === activePreserveId) || preserves[0];
  const apiBaseUrlRef = useRef(activePreserve.url);

  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<string>('general');
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  
  const [showChannelSettingsModal, setShowChannelSettingsModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [showAdminManagement, setShowAdminManagement] = useState(false);

  const [authStatus, setAuthStatus] = useState({ isAdmin: false, isHost: false });

  useEffect(() => {
      fetch('/api/auth/status')
          .then(r => r.json())
          .then(setAuthStatus)
          .catch(console.error);
  }, []);

  useEffect(() => {
      apiBaseUrlRef.current = activePreserve.url;
      localStorage.setItem('tailchat_preserves', JSON.stringify(preserves));
  }, [activePreserve.url, preserves]);

  // Global override for fetch to dynamically route /api, /uploads, and /roms to the active preserve
  useEffect(() => {
      const originalFetch = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          if (typeof input === 'string') {
              if (input.startsWith('/api') || input.startsWith('/uploads') || input.startsWith('/roms')) {
                  return originalFetch(`${apiBaseUrlRef.current}${input}`, init);
              }
          }
          return originalFetch(input, init);
      };
      return () => {
          window.fetch = originalFetch;
      };
  }, []);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const activeChatRef = useRef(activeChat);
  const activeChannelRef = useRef(activeChannel);

  useEffect(() => {
    activeChatRef.current = activeChat;
    activeChannelRef.current = activeChannel;
  }, [activeChat, activeChannel]);
  
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [callState, setCallState] = useState<CallState | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // showPreservesMenu removed in favor of sidebar
  const [selectedProfilePeer, setSelectedProfilePeer] = useState<Peer | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
      typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false
  );
  
  const [themeAccent, setThemeAccent] = useState<'jelly' | 'ocean' | 'forest' | 'sunset'>(() => {
      const saved = localStorage.getItem('themeAccent');
      return (saved as any) || 'jelly';
  });

  useEffect(() => {
      localStorage.setItem('themeAccent', themeAccent);
  }, [themeAccent]);
  
  const [profiles, setProfiles] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isUserScrolledRef = useRef(false);
  
  const [typingPeers, setTypingPeers] = useState<Record<string, boolean>>({});
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMeTyping, setIsMeTyping] = useState(false);

  const [showGiphy, setShowGiphy] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [showPreservesSidebar, setShowPreservesSidebar] = useState(false);
  const [activeVoiceChannels, setActiveVoiceChannels] = useState<Record<string, any[]>>({});
  const [showAddPreserveModal, setShowAddPreserveModal] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const fileStickerInputRef = useRef<HTMLInputElement>(null);
  const [showFullEmojiPicker, setShowFullEmojiPicker] = useState<number | null>(null);
  const [giphySearch, setGiphySearch] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingSticker, setIsGeneratingSticker] = useState(false);
  const [gifs, setGifs] = useState<any[]>([]);
  const [generatedStickers, setGeneratedStickers] = useState<string[]>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const [guestInviteModal, setGuestInviteModal] = useState<{key: string, text: string} | null>(null);
  
  // New feature state
  const [channelSummary, setChannelSummary] = useState<{lastMessages: any[], counts: any[]}>({ lastMessages: [], counts: [] });
  const [ephemeralTtl, setEphemeralTtl] = useState<number | null>(null);
  const [showPlusTray, setShowPlusTray] = useState(false);
  const [showTtlPicker, setShowTtlPicker] = useState(false);
  const [p2pFileOffer, setP2pFileOffer] = useState<any>(null);
  const [p2pTransferProgress, setP2pTransferProgress] = useState<number | null>(null);
  const [myPrivateKey, setMyPrivateKey] = useState<CryptoKey | null>(null);
  const myPrivateKeyRef = useRef<CryptoKey | null>(null);
  useEffect(() => {
      myPrivateKeyRef.current = myPrivateKey;
  }, [myPrivateKey]);
  const peerKeysRef = useRef<Record<string, CryptoKey>>({});

  const getPeerSharedSecret = async (ip: string, force: boolean = false) => {
      if (!myPrivateKeyRef.current) return null;
      if (!force && peerKeysRef.current[ip]) return peerKeysRef.current[ip];

      try {
          const res = await fetch(`/api/keys/${ip}`);
          if (!res.ok) return null;
          const publicJwk = await res.json();
          const publicKey = await importPublicKey(publicJwk);
          const sharedSecret = await deriveSharedSecret(myPrivateKeyRef.current, publicKey);
          peerKeysRef.current[ip] = sharedSecret;
          return sharedSecret;
      } catch (e) {
          console.error("Failed to get peer shared secret", e);
          return null;
      }
  };

  const processMessage = async (m: Message) => {
      const msgCopy = { ...m };
      if (msgCopy.content && msgCopy.content.startsWith('E2EE:')) {
          const parts = msgCopy.content.split(':');
          if (parts.length === 3) {
              const [_, ciphertext, iv] = parts;
              const myIp = meRef.current?.ip;
              const peerIp = msgCopy.senderId === myIp ? msgCopy.recipientId : msgCopy.senderId;
              if (peerIp) {
                  let sharedSecret = await getPeerSharedSecret(peerIp);
                  if (sharedSecret) {
                      try {
                          msgCopy.content = await decryptText(ciphertext, iv, sharedSecret);
                      } catch (e) {
                          console.warn("Decryption failed, forcing key refresh for", peerIp);
                          sharedSecret = await getPeerSharedSecret(peerIp, true);
                          if (sharedSecret) {
                              try {
                                  msgCopy.content = await decryptText(ciphertext, iv, sharedSecret);
                              } catch (e2) {
                                  msgCopy.content = "[Encrypted Message - Decryption Failed]";
                              }
                          } else {
                              msgCopy.content = "[Encrypted Message - Key Missing after refresh]";
                          }
                      }
                  } else {
                      msgCopy.content = "[Encrypted Message - Key Missing]";
                  }
              }
          }
      }
      return msgCopy;
  };
  useEffect(() => {
      async function initCrypto() {
          let privateJwkStr = localStorage.getItem('tailchat_private_key');
          if (!privateJwkStr) {
              const { privateKey, publicKey } = await generateKeyPair();
              const privateJwk = await window.crypto.subtle.exportKey("jwk", privateKey);
              const publicJwk = await exportPublicKey(publicKey);
              localStorage.setItem('tailchat_private_key', JSON.stringify(privateJwk));
              setMyPrivateKey(privateKey);
              fetch('/api/keys', { 
                  method: 'POST', 
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(publicJwk) 
              });
          } else {
              try {
                  const privateJwk = JSON.parse(privateJwkStr);
                  const privateKey = await importPrivateKey(privateJwk);
                  setMyPrivateKey(privateKey);
                  
                  // Extract public coordinates to sync with server
                  const publicJwk = {
                      kty: privateJwk.kty,
                      crv: privateJwk.crv,
                      x: privateJwk.x,
                      y: privateJwk.y,
                      ext: true
                  };
                  fetch('/api/keys', { 
                      method: 'POST', 
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(publicJwk) 
                  });
              } catch (e) {
                  console.error("Failed to restore private key", e);
              }
          }
      }
      initCrypto();
  }, []);

  const exportIdentity = () => {
      const privateKeyStr = localStorage.getItem('tailchat_private_key');
      if (!privateKeyStr) return alert("No identity found");
      const blob = new Blob([privateKeyStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jellychat_identity_${me?.deviceName || 'export'}.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const importIdentity = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const content = ev.target?.result as string;
              JSON.parse(content); // validate JSON
              localStorage.setItem('tailchat_private_key', content);
              alert('Identity imported successfully! The app will now reload to apply the new keys.');
              window.location.reload();
          } catch (err) {
              alert("Invalid identity file format.");
          }
      };
      reader.readAsText(file);
  };

  useEffect(() => {
      if (showGiphy) {
          const delayDebounceFn = setTimeout(() => {
              fetchCustomGifs();
          }, 300);
          return () => clearTimeout(delayDebounceFn);
      }
  }, [showGiphy, giphySearch]);

  const fetchCustomGifs = async () => {
      setIsLoadingGifs(true);
      try {
          const endpoint = giphySearch.trim() === '' 
              ? `/api/gifs`
              : `/api/gifs?q=${encodeURIComponent(giphySearch)}`;
          
          const res = await fetch(endpoint);
          const data = await res.json();
          if (data.results) {
              setGifs(data.results.map((g: any) => ({
                  id: g.id,
                  images: {
                      fixed_width: { url: g.media[0].tinygif.url },
                      original: { url: g.media[0].gif.url }
                  },
                  title: g.content_description
              })));
          }
      } catch (err) {
          console.error("Failed to fetch GIFs", err);
      } finally {
          setIsLoadingGifs(false);
      }
  };

  const handleSendGif = (url: string) => {
      if (socket) {
          socket.emit('send_message', {
              content: '',
              recipientId: activeChat,
              replyToId: replyingTo?.id || null,
              type: 'image',
              attachmentUrl: url
          });
          setShowGiphy(false);
          setReplyingTo(null);
          setTimeout(scrollToBottom, 50);
      }
  };

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [activeContextMenu, setActiveContextMenu] = useState<number | null>(null);

  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [customStatusText, setCustomStatusText] = useState('');
  const [availableRoms, setAvailableRoms] = useState<{name: string, url: string, core: string, size: number}[]>([]);
  const [activeEmulatorUrl, setActiveEmulatorUrl] = useState<string | null>(null);

  useEffect(() => {
      if (gamesModalOpen) {
          fetch('/api/roms').then(r => r.json()).then(setAvailableRoms).catch(console.error);
      }
  }, [gamesModalOpen]);

  // Cache for link previews
  const [linkPreviews, setLinkPreviews] = useState<Record<string, any>>({});
  
  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) {
          setSearchResults([]);
          return;
      }
      setIsSearching(true);
      try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
          const data = await res.json();
          setSearchResults(data);
      } catch (err) {
          console.error("Failed to search", err);
      } finally {
          setIsSearching(false);
      }
  };

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const meRef = useRef<Me | null>(null);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  const subscribeToWebPush = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          console.warn('Push not supported');
          return;
      }
      try {
          if (!('Notification' in window)) {
              throw new Error('Notifications not supported');
          }

          const reg = await navigator.serviceWorker.register('/sw.js');
          
          const res = await fetch(`/api/vapidPublicKey`);
          if (!res.ok) throw new Error('Failed to fetch VAPID key');
          const { publicKey } = await res.json();
          
          const subscription = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
          
          await fetch(`/api/subscribe`, {
              method: 'POST',
              body: JSON.stringify(subscription),
              headers: { 'Content-Type': 'application/json' }
          });
          setNotificationsEnabled(true);
          console.log('Push subscription successful!');
      } catch (e: any) {
          console.error('Push registration failed:', e);
          if (e.message === 'Permission denied' || e.name === 'NotAllowedError') {
              alert('Notification permission was denied. Please check your browser settings. If you already allowed them, you might need to try again or toggle it in Settings.');
          } else {
              alert('Failed to enable notifications. On iPhone/iOS, you MUST add this website to your Home Screen first (Share -> Add to Home Screen), and then open it from there.');
          }
      }
  };

  useEffect(() => {
    // Connect to the active preserve
    const newSocket = io(activePreserve.url);
    setSocket(newSocket);

    newSocket.on('connect', () => {
        // Fetch channels on connect
        fetch('/api/channels').then(r => r.json()).then(setChannels).catch(console.error);

        const fetchTarget = activeChatRef.current !== null ? { recipientId: activeChatRef.current } : { channelId: activeChannelRef.current };
        newSocket.emit('fetch_messages', fetchTarget, async (fetchedMessages: Message[]) => {
            const processed = await Promise.all(fetchedMessages.map(processMessage));
            setMessages(processed);
            const unreadIds = processed
                .filter(m => m.senderId === activeChatRef.current && m.status !== 'read')
                .map(m => m.id);
            if (unreadIds.length > 0) {
                newSocket.emit('mark_read', unreadIds);
            }
        });
        
        if (activeChatRef.current === null) {
            newSocket.emit('join_channel', activeChannelRef.current);
        }
    });

    newSocket.on('initial_messages', (initialMessages: Message[]) => {
      if (activeChatRef.current !== null) return;
      
      setMessages(initialMessages);
    });

    newSocket.on('new_message', (msg: Message) => {
      const currentActive = activeChatRef.current;
      const currentChannel = activeChannelRef.current;
      const myIp = meRef.current?.ip;
      
      const isChannelMsg = msg.recipientId === null;
      const belongsToActiveChat = 
        (isChannelMsg && currentActive === null && msg.channel_id === currentChannel) || 
        (!isChannelMsg && currentActive !== null && (msg.senderId === currentActive || msg.recipientId === currentActive));

      if (belongsToActiveChat) {
        processMessage(msg).then(processed => {
            setMessages((prev) => {
                if (prev.find(m => m.id === processed.id)) return prev;
                return [...prev, processed];
            });
            if (msg.senderId !== myIp) {
                newSocket.emit('mark_delivered', [msg.id]);
                if (document.hasFocus()) {
                    newSocket.emit('mark_read', [msg.id]);
                }
            }
        });
      } else {
        const chatKey = isChannelMsg ? (msg.channel_id || 'general') : (msg.senderId === myIp ? msg.recipientId : msg.senderId);
        if (chatKey) {
            setUnreadCounts(prev => ({
                ...prev,
                [chatKey]: (prev[chatKey] || 0) + 1
            }));
        }
        
        // If it's a direct message to us and we're not in the chat, mark delivered
        if (msg.recipientId === myIp && msg.senderId !== myIp) {
            newSocket.emit('mark_delivered', [msg.id]);
        }
      }
      
      // Clear typing indicator for this user if they just sent a message
      if (msg.senderId) {
          setTypingPeers(prev => ({ ...prev, [msg.senderId]: false }));
      }
    });

    newSocket.on('typing', ({ senderId, isTyping, recipientId }) => {
        const belongsToActiveChat = recipientId === null 
            ? activeChatRef.current === null 
            : activeChatRef.current === senderId;

        if (belongsToActiveChat) {
            setTypingPeers(prev => ({ ...prev, [senderId]: isTyping }));
        }
    });

    newSocket.on('reaction_updated', ({ messageId, reactions }) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: JSON.stringify(reactions) } : m));
    });

    newSocket.on('active_voice_channels', (data) => {
        setActiveVoiceChannels(data);
    });

    newSocket.on('sticker_added', ({ messageId, stickers }) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, stickers: JSON.stringify(stickers) } : m));
    });
    
    newSocket.on('call_offer', (data) => {
        setCallState(prev => {
            if (prev) return prev;
            return {
                status: 'incoming',
                peerId: data.callerId,
                peerName: data.callerName,
                isVideo: data.isVideo,
                isScreenShare: data.isScreenShare,
                offer: data.offer
            };
        });
    });

    newSocket.on('messages_status_updated', ({ messageIds, status }) => {
        setMessages(prev => prev.map(m => messageIds.includes(m.id) ? { ...m, status } : m));
    });

    newSocket.on('message_edited', ({ messageId, newContent }) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent, isEdited: 1 } : m));
    });

    newSocket.on('message_deleted', (messageId) => {
        setMessages(prev => prev.filter(m => m.id !== messageId));
    });

    newSocket.on('latency_update', ({ ip, latency }) => {
        setPeers(prev => prev.map(p => p.ip === ip ? { ...p, latency } : p));
    });

    newSocket.on('chat_cleared', () => {
        if (activeChatRef.current === null) {
            setMessages([]);
        }
    });
    
    newSocket.on('receive_nudge', () => {
        playNudgeSound();
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 600); // Wait for shake animation to finish
    });

    newSocket.on('activity_update', ({ ip, activity }) => {
        setPeers(prev => prev.map(p => p.ip === ip ? { ...p, activity } : p));
        if (meRef.current?.ip === ip) {
            setMe(prev => prev ? { ...prev, activity } : prev);
        }
    });

    newSocket.on('status_update', ({ ip, status, text }) => {
        const statusData = { status, text };
        setPeers(prev => prev.map(p => p.ip === ip ? { ...p, statusData } : p));
        if (meRef.current?.ip === ip) {
            setMe(prev => prev ? { ...prev, statusData } : prev);
        }
    });

    fetch(`/api/me`)
      .then(res => res.json())
      .then(data => setMe(data))
      .catch(err => console.error('Error fetching identity', err));

    const fetchPeers = () => {
      fetch(`/api/peers`)
        .then(res => res.json())
        .then(data => setPeers(data))
        .catch(err => console.error('Error fetching peers', err));
        
      fetch('/api/profiles')
        .then(r => r.json())
        .then(setProfiles)
        .catch(console.error);
        
      fetch('/api/assignments')
        .then(r => r.json())
        .then(setAssignments)
        .catch(console.error);
    };
    
    fetchPeers();
    const interval = setInterval(fetchPeers, 3000);

    return () => {
      newSocket.disconnect();
      clearInterval(interval);
    };
  }, [activePreserve.url]);

  useEffect(() => {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      messages.forEach(msg => {
          if (msg.type && msg.type !== 'text') return;
          const urls = msg.content.match(urlRegex);
          if (urls) {
              urls.forEach(url => {
                  if (!linkPreviews[url] && !linkPreviews[`failed_${url}`]) {
                      setLinkPreviews(prev => ({ ...prev, [`failed_${url}`]: true })); // prevent refetch
                      fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
                          .then(res => res.json())
                          .then(data => {
                              if (data && !data.error) {
                                  setLinkPreviews(prev => ({ ...prev, [url]: data }));
                              }
                          })
                          .catch(() => {});
                  }
              });
          }
      });
  }, [messages, linkPreviews]);

  const scrollToBottom = () => {
      if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
  };

  useEffect(() => {
      const lastMsg = messages[messages.length - 1];
      const isLastMsgFromMe = lastMsg && lastMsg.senderId === meRef.current?.ip;

      if (!isUserScrolledRef.current || isLastMsgFromMe) {
          setTimeout(scrollToBottom, 50);
      }
  }, [messages, typingPeers]);

  const handleScroll = () => {
      if (!messagesContainerRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
      isUserScrolledRef.current = !isNearBottom;
  };

  const changeChannel = (channelId: string) => {
    if (activeChat === null && activeChannel === channelId) return;
    
    if (socket) {
        if (activeChat === null) {
            socket.emit('leave_channel', activeChannel);
        }
        socket.emit('join_channel', channelId);
    }
    
    setActiveChat(null);
    setActiveChannel(channelId);
    setIsSidebarOpen(false);
    setTypingPeers({});
    setReplyingTo(null);
    setShowHeaderMenu(false);
    setUnreadCounts(prev => ({ ...prev, [channelId]: 0 }));
    
    if (socket) {
        socket.emit('fetch_messages', { channelId }, async (fetchedMessages: Message[]) => {
            const processed = await Promise.all(fetchedMessages.map(processMessage));
            setMessages(processed);
        });
    }
  };

  const changeChat = (ip: string | null) => {
    if (ip === null) {
        // Default to active channel if passing null
        changeChannel(activeChannel);
        return;
    }

    if (socket && activeChat === null) {
        socket.emit('leave_channel', activeChannel);
    }

    setActiveChat(ip);
    setIsSidebarOpen(false); // Close mobile sidebar on change
    setTypingPeers({}); // Reset typing peers on chat switch
    setReplyingTo(null);
    setShowHeaderMenu(false);
    setUnreadCounts(prev => ({ ...prev, [ip]: 0 }));
    
    if (socket) {
        socket.emit('fetch_messages', { recipientId: ip }, async (fetchedMessages: Message[]) => {
            const processed = await Promise.all(fetchedMessages.map(processMessage));
            setMessages(processed);

            const unreadIds = processed
                .filter(m => m.senderId === ip && m.status !== 'read')
                .map(m => m.id);
            if (unreadIds.length > 0) {
                socket.emit('mark_read', unreadIds);
            }
        });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      
      // Auto-resize textarea
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;

      if (socket) {
          if (!isMeTyping) {
              setIsMeTyping(true);
              socket.emit('typing', { recipientId: activeChat, isTyping: true });
          }
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
              setIsMeTyping(false);
              socket.emit('typing', { recipientId: activeChat, isTyping: false });
          }, 2000);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(e as unknown as React.FormEvent);
      }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && socket) {
      let finalContent = inputText;
      
      if (activeChat && myPrivateKey) {
          const sharedSecret = await getPeerSharedSecret(activeChat);
          if (sharedSecret) {
              const { ciphertext, iv } = await encryptText(inputText, sharedSecret);
              finalContent = `E2EE:${ciphertext}:${iv}`;
          }
      }

      if (editingMessage) {
          socket.emit('edit_message', {
              messageId: editingMessage.id,
              newContent: finalContent
          });
          setEditingMessage(null);
      } else {
          socket.emit('send_message', {
              content: finalContent,
              recipientId: activeChat,
              channelId: activeChat === null ? activeChannel : undefined,
              replyToId: replyingTo?.id || null
          });
      }
      setInputText('');
      
      // Reset textarea height
      const textarea = document.querySelector('textarea');
      if (textarea) textarea.style.height = 'auto';

      setReplyingTo(null);
      setIsMeTyping(false);
      socket.emit('typing', { recipientId: activeChat, isTyping: false });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  };
  
  const sendNudge = () => {
      if (socket && activeChat) {
          socket.emit('send_nudge', activeChat);
      }
  };

  const resetGlobalChat = () => {
      if (socket && window.confirm("Are you sure you want to clear the global chat for everyone?")) {
          socket.emit('reset_global_chat');
      }
  };

  const generateGuestLink = async () => {
      try {
          const res = await fetch('/api/invite', { method: 'POST' });
          if (res.status === 501) {
              const data = await res.json();
              alert(data.error);
              return;
          }
          if (!res.ok) throw new Error("Failed to generate");
          const data = await res.json();
          const inviteText = `Join my private JellyChat!\n\n1. Install Tailscale: https://tailscale.com/download\n2. Open terminal/cmd and run:\ntailscale up --authkey=${data.key}\n\n3. Open http://${meRef.current?.ip || 'me'}:4000`;
          
          setGuestInviteModal({ key: data.key, text: inviteText });
      } catch (e) {
          console.error(e);
          alert("Failed to generate guest link. See frontend/backend console for details: " + e);
      }
  };

  const addReaction = (e: React.MouseEvent | React.TouchEvent, messageId: number, emoji: string) => {
      e.stopPropagation();
      if (socket) {
          socket.emit('add_reaction', { messageId, emoji });
          setActiveContextMenu(null);
      }
  };

  const deleteMessage = (e: React.MouseEvent | React.TouchEvent, messageId: number) => {
      e.stopPropagation();
      if (socket && window.confirm("Are you sure you want to delete this message?")) {
          socket.emit('delete_message', messageId);
          setActiveContextMenu(null);
      }
  };

  const handleContextMenu = (e: React.MouseEvent | React.TouchEvent, msgId: number) => {
      e.preventDefault();
      // On tap, toggle the menu
      if (activeContextMenu === msgId) {
          setActiveContextMenu(null);
      } else {
          setActiveContextMenu(msgId);
      }
  };

  const startRecording = async () => {
      if (isRecordingRef.current) return;
      isRecordingRef.current = true;
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];
          
          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) audioChunksRef.current.push(event.data);
          };
          
          mediaRecorder.onstop = () => {
              const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
              const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
              const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
              
              // Only upload if it actually recorded something substantial
              if (audioChunksRef.current.length > 0 && audioBlob.size > 1000) {
                  const audioFile = new File([audioBlob], `voice_memo_${Date.now()}.${ext}`, { type: mimeType });
                  uploadFile(audioFile);
              }
              
              stream.getTracks().forEach(track => track.stop());
              isRecordingRef.current = false;
              setIsRecording(false);
              mediaRecorderRef.current = null;
          };
          
          // Request data every 250ms so chunks aren't all buffered to the end, preventing empty blobs if cut short
          mediaRecorder.start(250);
          setIsRecording(true);
      } catch (err) {
          console.error('Error accessing microphone', err);
          alert('Microphone access is required to record voice memos.');
          isRecordingRef.current = false;
          setIsRecording(false);
      }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
      }
  };

  const compressImage = (file: File, quality: number = 0.5): Promise<File> => {
      return new Promise((resolve) => {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 1920;
              const MAX_HEIGHT = 1080;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                  if (width > MAX_WIDTH) {
                      height *= MAX_WIDTH / width;
                      width = MAX_WIDTH;
                  }
              } else {
                  if (height > MAX_HEIGHT) {
                      width *= MAX_HEIGHT / height;
                      height = MAX_HEIGHT;
                  }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(file);
              ctx.drawImage(img, 0, 0, width, height);
              canvas.toBlob(blob => {
                  if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                  else resolve(file);
              }, 'image/jpeg', quality);
          };
          img.onerror = () => resolve(file);
      });
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    let finalFile = file;

    if (activeChat && file.type.startsWith('image/')) {
        const peer = peers.find(p => p.ip === activeChat);
        if (peer && peer.latency !== undefined && peer.latency > 100) {
            finalFile = await compressImage(file, 0.5);
            console.log(`High latency (${peer.latency}ms). Compressed image ${file.size} -> ${finalFile.size} bytes.`);
        }
    }

    const formData = new FormData();
    formData.append('file', finalFile);
    if (activeChat) {
        formData.append('recipientId', activeChat);
    }
    if (replyingTo) {
        formData.append('replyToId', replyingTo.id.toString());
    }

    try {
      await fetch(`/api/upload`, {
        method: 'POST',
        body: formData,
      });
      setReplyingTo(null);
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('application') !== -1 || items[i].type.indexOf('text') !== -1) {
        e.preventDefault();
        const blob = items[i].getAsFile();
        if (blob) uploadFile(blob);
        break;
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const downloadImage = (url: string) => {
      fetch(url)
        .then(response => response.blob())
        .then(blob => {
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = blobUrl;
            a.download = 'jellychat-image.png';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            document.body.removeChild(a);
        })
        .catch(err => console.error('Download failed', err));
  };

  const activePeerName = activeChat ? peers.find(p => p.ip === activeChat)?.name || activeChat : null;
  const chatPeer = activeChat ? peers.find(p => p.ip === activeChat) : null;
  const handleGenerateSticker = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!aiPrompt.trim()) return;
      setIsGeneratingSticker(true);
      try {
          const res = await fetch('/api/ai/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: aiPrompt })
          });
          if (!res.ok) {
              throw new Error('Failed to generate sticker');
          }
          const data = await res.json();
          setGeneratedStickers(prev => [data.url, ...prev]);
          setAiPrompt('');
      } catch (err) {
          console.error(err);
          alert('Failed to generate sticker.');
      } finally {
          setIsGeneratingSticker(false);
      }
  };

  const handleCustomStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('sticker', file);

      try {
          const res = await fetch('/api/stickers/upload', {
              method: 'POST',
              body: formData
          });
          const data = await res.json();
          if (data.url) {
              setGeneratedStickers(prev => [data.url, ...prev]);
          }
      } catch (err) {
          console.error('Error uploading sticker', err);
      }
      if (fileStickerInputRef.current) {
          fileStickerInputRef.current.value = '';
      }
  };
  const updateStatus = (status: string, text: string = customStatusText) => {
      const statusData = { status, text };
      socket?.emit('update_status', statusData);
      if (me) setMe({ ...me, statusData });
      setShowStatusPicker(false);
  };

  return (
    <div className={`flex h-[100dvh] bg-[#09090b] text-slate-200 overflow-hidden font-sans relative selection:bg-rose-500/30 ${isShaking ? 'animate-shake' : ''} ${themeAccent === 'jelly' ? '' : `theme-${themeAccent}`}`}>
      
      {/* Abstract Animated Background */}
      <div className="absolute top-[-20%] left-[-10%] w-[50vw] h-[50vw] rounded-full blur-[120px] pointer-events-none mix-blend-screen animate-pulse" style={{ backgroundColor: 'var(--theme-glow-1)', animationDuration: '8s' }}></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[40vw] h-[40vw] rounded-full blur-[120px] pointer-events-none mix-blend-screen animate-pulse" style={{ backgroundColor: 'var(--theme-glow-2)', animationDuration: '12s', animationDelay: '2s' }}></div>
      <div className="absolute top-[20%] right-[20%] w-[20vw] h-[20vw] rounded-full blur-[100px] pointer-events-none mix-blend-screen" style={{ backgroundColor: 'var(--theme-glow-1)', opacity: 0.5 }}></div>

      {/* Lightbox */}
      {selectedImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all backdrop-blur-md"
              >
                  <X size={24} />
              </button>
              
              <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center">
                  <img src={selectedImage} alt="Zoomed" className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl" />
                  
                  <button 
                    onClick={() => downloadImage(selectedImage)}
                    className="mt-6 px-6 py-3 bg-rose-500 hover:bg-rose-400 text-white rounded-xl font-medium shadow-lg shadow-rose-500/30 flex items-center gap-2 transition-all transform hover:-translate-y-1"
                  >
                      <Download size={18} />
                      Download Full Size
                  </button>
              </div>
          </div>
      )}

      {gamesModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl relative max-h-[80vh] overflow-hidden flex flex-col">
                  <button 
                      onClick={() => setGamesModalOpen(false)}
                      className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                  >
                      <X size={20} />
                  </button>
                  
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2 shrink-0">
                      <Gamepad2 size={24} className="text-indigo-400" />
                      Emulator Arcade
                  </h2>
                  
                  <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                      {availableRoms.length === 0 ? (
                          <div className="text-center py-10 text-white/40">
                              <Gamepad2 size={48} className="mx-auto mb-4 opacity-20" />
                              <p>No games found.</p>
                              <p className="text-sm mt-2">Upload ROMs to the server's /roms directory.</p>
                          </div>
                      ) : (
                          availableRoms.map((rom, idx) => (
                              <button 
                                  key={idx}
                                  onClick={() => {
                                      setActiveEmulatorUrl(`/emulator.html?core=${rom.core}&url=${encodeURIComponent(rom.url)}`);
                                      if (socket) {
                                          socket.emit('update_activity', { type: 'playing', details: rom.name, url: rom.url, core: rom.core });
                                      }
                                      setGamesModalOpen(false);
                                  }}
                                  className="w-full flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-indigo-500/30 transition-all group text-left"
                              >
                                  <div className="flex flex-col">
                                      <span className="text-white font-medium group-hover:text-indigo-400 transition-colors">{rom.name}</span>
                                      <span className="text-xs text-white/40 uppercase tracking-widest mt-1">Core: {rom.core} • {(rom.size / 1024 / 1024).toFixed(1)} MB</span>
                                  </div>
                                  <Play size={20} className="text-white/20 group-hover:text-indigo-400 transition-colors" />
                              </button>
                          ))
                      )}
                  </div>
              </div>
          </div>
      )}

      {activeEmulatorUrl && (
          <div className="fixed inset-0 bg-black z-[100] flex flex-col animate-in slide-in-from-bottom-full duration-300">
              <div className="h-14 bg-[#111] border-b border-white/10 flex items-center justify-between px-4 shrink-0">
                  <div className="flex items-center gap-3">
                      <Gamepad2 size={20} className="text-indigo-400" />
                      <span className="text-white font-bold tracking-wide">JellyChat Emulator</span>
                  </div>
                  <button 
                      onClick={() => {
                          setActiveEmulatorUrl(null);
                          if (socket) socket.emit('update_activity', null);
                      }}
                      className="px-4 py-1.5 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 rounded-full text-sm font-bold transition-colors"
                  >
                      Exit Game
                  </button>
              </div>
              <div className="flex-1 w-full bg-black">
                  <iframe src={activeEmulatorUrl} className="w-full h-full border-0" title="Emulator"></iframe>
              </div>
          </div>
      )}
      
      {/* Sidebar - Overlay for Mobile */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      {/* Sidebar - Peers */}
      {/* Profile Modal */}
      {selectedProfilePeer && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-[#111] border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl flex flex-col items-center relative animate-in zoom-in-95 duration-200">
                  <button 
                      onClick={() => setSelectedProfilePeer(null)}
                      className="absolute right-4 top-4 p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors"
                  >
                      <X size={20} />
                  </button>
                  
                  <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-500 to-rose-500 flex items-center justify-center text-4xl font-bold text-white shadow-lg mb-4">
                      {selectedProfilePeer.name.charAt(0).toUpperCase()}
                  </div>
                  
                  <h3 className="text-2xl font-bold text-white mb-1">{selectedProfilePeer.name}</h3>
                  <div className="flex items-center gap-2 text-white/40 text-sm mb-6">
                      <Monitor size={14} /> {selectedProfilePeer.os} • {selectedProfilePeer.ip}
                  </div>
                  
                  {selectedProfilePeer.activity && selectedProfilePeer.activity.type === 'playing' ? (
                      <div className="w-full bg-white/5 border border-emerald-500/20 rounded-2xl p-4 flex flex-col items-center text-center">
                          <Gamepad2 size={32} className="text-emerald-400 mb-2" />
                          <span className="text-emerald-400 font-bold mb-1">Playing a Game</span>
                          <span className="text-white/70 text-sm mb-4">{selectedProfilePeer.activity.details}</span>
                          <button 
                              onClick={() => {
                                  if (selectedProfilePeer.activity && selectedProfilePeer.activity.url) {
                                      setActiveEmulatorUrl(`/emulator.html?core=${selectedProfilePeer.activity.core}&url=${encodeURIComponent(selectedProfilePeer.activity.url)}`);
                                      if (socket) {
                                          socket.emit('update_activity', { type: 'playing', details: selectedProfilePeer.activity.details, url: selectedProfilePeer.activity.url, core: selectedProfilePeer.activity.core });
                                      }
                                      setSelectedProfilePeer(null);
                                  }
                              }}
                              className="w-full py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold rounded-xl transition-colors"
                          >
                              Join Netplay
                          </button>
                      </div>
                  ) : (
                      <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col items-center text-center">
                          <Activity size={32} className="text-white/20 mb-2" />
                          <span className="text-white/40 text-sm">No active status</span>
                      </div>
                  )}
                  
                  <button 
                      onClick={() => {
                          setActiveChat(selectedProfilePeer.ip);
                          setIsSidebarOpen(false);
                          setSelectedProfilePeer(null);
                      }}
                      className="w-full mt-4 py-3 bg-white/10 hover:bg-white/15 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                      <MessageCircle size={18} /> Message
                  </button>
              </div>
          </div>
      )}

      <nav className={`${showPreservesSidebar ? 'flex absolute left-0 h-full' : 'hidden'} md:${showPreservesSidebar ? 'flex' : 'hidden'} w-16 flex-shrink-0 bg-black/90 md:bg-black/40 backdrop-blur-xl border-r border-white/5 flex-col items-center py-4 gap-3 z-[60] overflow-y-auto transition-all`}>
        {preserves.map(p => (
            <button 
                key={p.id}
                onClick={() => setActivePreserveId(p.id)}
                title={p.name}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold transition-all relative group ${activePreserveId === p.id ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)]' : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white hover:rounded-xl'}`}
            >
                {p.name.charAt(0).toUpperCase()}
                {activePreserveId === p.id && <div className="absolute -left-1 w-1 h-8 bg-white rounded-r-md"></div>}
            </button>
        ))}
        <button 
            onClick={() => setShowAddPreserveModal(true)}
            className="w-12 h-12 rounded-full bg-white/5 hover:bg-emerald-500 hover:text-white text-emerald-400 flex items-center justify-center transition-all mt-2"
            title="Add Preserve"
        >
            <Plus size={24} />
        </button>
      </nav>

      <aside className={`fixed md:relative w-72 glass-panel border-r border-white/5 flex flex-col z-50 h-full shadow-2xl transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between gap-4 relative">
          <div className="flex items-center gap-4 p-2 -ml-2 rounded-xl">
            <div className="jelly-gradient p-2.5 rounded-xl text-white shadow-[0_0_15px_rgba(244,63,94,0.5)] flex-shrink-0">
              <Sparkles size={22} className="drop-shadow-md" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-xl tracking-tight jelly-text truncate max-w-[150px]">{activePreserve.name}</h1>
              </div>
              <p className="text-[11px] text-white/50 uppercase tracking-widest mt-0.5">Tailscale Secured</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowPreservesSidebar(!showPreservesSidebar)} className="p-2 hover:bg-white/5 rounded-lg text-white/50 transition-all" title="Toggle Preserves Sidebar">
              <PanelLeft size={18} />
            </button>
            <button onClick={() => setIsSidebarOpen(false)} className={`${isSidebarOpen ? 'block' : 'hidden'} md:hidden p-2 bg-white/5 rounded-lg text-white/50 hover:text-white flex-shrink-0`}>
               <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-6">
          
          <div>
              <div className="flex items-center justify-between mb-3 group/header">
                <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-widest">
                  <Terminal size={14} />
                  <span>Text Channels</span>
                </div>
                {authStatus.isAdmin && (
                  <button 
                    onClick={() => { setEditingChannel(null); setShowChannelSettingsModal(true); }}
                    className="text-white/40 hover:text-white transition-colors opacity-0 group-hover/header:opacity-100"
                    title="Create Channel"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              
              <div className="space-y-1 mb-6">
                {channels.filter(c => c.type === 'text' || !c.type).map(channel => (
                  <div key={channel.id} className="relative group/channel flex items-center">
                      <button 
                        onClick={() => changeChannel(channel.id)}
                        className={`flex-1 flex items-center justify-between p-2.5 rounded-xl transition-all ${activeChat === null && activeChannel === channel.id ? 'bg-white/10 shadow-inner' : 'hover:bg-white/5'}`}
                      >
                          <div className="flex items-center gap-3">
                              <Hash size={16} className={`${activeChat === null && activeChannel === channel.id ? 'text-white' : 'text-white/40'}`} />
                              <span className={`font-medium ${activeChat === null && activeChannel === channel.id ? 'text-white' : 'text-white/70'}`}>{channel.name}</span>
                          </div>
                          {unreadCounts[channel.id] > 0 && (
                              <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.6)]">
                                  {unreadCounts[channel.id]}
                              </span>
                          )}
                      </button>
                      {authStatus.isAdmin && (
                          <button 
                              onClick={() => { setEditingChannel(channel); setShowChannelSettingsModal(true); }}
                              className="absolute right-2 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover/channel:opacity-100 transition-all"
                          >
                              <Settings size={14} />
                          </button>
                      )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mb-3 group/header">
                <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-widest">
                  <Volume2 size={14} />
                  <span>Voice Channels</span>
                </div>
                {authStatus.isAdmin && (
                  <button 
                    onClick={() => { setEditingChannel(null); setShowChannelSettingsModal(true); }}
                    className="text-white/40 hover:text-white transition-colors opacity-0 group-hover/header:opacity-100"
                    title="Create Voice Channel"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>

              <div className="space-y-1">
                {channels.filter(c => c.type === 'voice').map(channel => {
                  const usersInChannel = activeVoiceChannels[channel.id] || [];
                  return (
                  <div key={channel.id} className="relative group/channel flex items-center">
                      <button 
                        onClick={() => setActiveVoiceChannel(channel.id)}
                        className={`flex-1 flex items-center justify-between p-2.5 rounded-xl transition-all ${activeVoiceChannel === channel.id ? 'bg-emerald-500/10 shadow-inner' : 'hover:bg-white/5'}`}
                      >
                          <div className="flex items-center gap-3">
                              <Volume2 size={16} className={`${activeVoiceChannel === channel.id ? 'text-emerald-400' : 'text-white/40'}`} />
                              <span className={`font-medium ${activeVoiceChannel === channel.id ? 'text-emerald-400 font-bold' : 'text-white/70'}`}>{channel.name}</span>
                          </div>
                      </button>
                      
                      {usersInChannel.length > 0 && activeVoiceChannel !== channel.id && (
                          <div className="absolute right-2 flex items-center -space-x-2 pointer-events-auto">
                              {usersInChannel.slice(0, 3).map((u: any, i: number) => {
                                  const profile = profiles.find(p => p.id === u.profileId);
                                  return (
                                      <div key={u.ip} tabIndex={0} className="w-6 h-6 rounded-full bg-indigo-500 border-2 border-[#09090b] flex items-center justify-center text-[10px] font-bold text-white relative group/face cursor-help outline-none" style={{ zIndex: 10 - i }}>
                                          {profile && profile.avatar ? (
                                              <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover rounded-full pointer-events-none" />
                                          ) : (
                                              (profile ? profile.name : u.name).charAt(0).toUpperCase()
                                          )}
                                          
                                          {/* Tooltip */}
                                          <div className="absolute right-0 bottom-full mb-2 hidden group-hover/face:flex group-focus/face:flex w-max bg-black/80 backdrop-blur-xl border border-white/10 p-2 rounded-xl text-xs z-50">
                                              <span className="font-medium text-white">{profile ? profile.name : u.name}</span>
                                          </div>
                                      </div>
                                  );
                              })}
                              {usersInChannel.length > 3 && (
                                  <div className="w-6 h-6 rounded-full bg-white/20 border-2 border-[#09090b] flex items-center justify-center text-[10px] font-bold text-white z-0">
                                      +{usersInChannel.length - 3}
                                  </div>
                              )}
                          </div>
                      )}

                      {authStatus.isAdmin && (
                          <button 
                              onClick={() => { setEditingChannel(channel); setShowChannelSettingsModal(true); }}
                              className="absolute right-2 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover/channel:opacity-100 transition-all z-10"
                          >
                              <Settings size={14} />
                          </button>
                      )}
                  </div>
                )})}
              </div>
          </div>

          <div>
              <button 
                onClick={() => { setShowSearch(true); setIsSidebarOpen(false); }}
                className="w-full flex items-center p-3 rounded-xl hover:bg-white/5 transition-all"
              >
                  <div className="flex items-center gap-3 text-white/60">
                      <div className="bg-white/5 p-2 rounded-lg"><Search size={16} /></div>
                      <span className="font-medium">Search Chat...</span>
                  </div>
              </button>
          </div>

          <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-widest">
                  <Activity size={14} />
                  <span>Direct Messages</span>
                </div>
                <div className="text-[10px] bg-white/5 px-2 py-1 rounded-full text-white/60">
                  {peers.length} Online
                </div>
              </div>
              
              <ul className="space-y-1.5">
                {peers.map((peer, i) => (
                  <li key={i}>
                      <button 
                        onClick={() => changeChat(peer.ip)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all ${activeChat === peer.ip ? 'bg-white/10 shadow-inner glow-accent border border-white/10' : 'hover:bg-white/5'}`}
                      >
                          <div className="flex items-center gap-3 overflow-hidden">
                              <div className="relative flex h-3 w-3 shrink-0">
                                {(() => {
                                    const isOffline = !peer.isJellychatOnline || peer.statusData?.status === 'offline';
                                    let bg = 'bg-emerald-500', ping = 'bg-emerald-400', shadow = 'shadow-[0_0_8px_rgba(16,185,129,0.8)]';
                                    if (isOffline) { bg = 'bg-zinc-500'; ping = 'bg-zinc-400'; shadow = ''; }
                                    else if (peer.statusData?.status === 'idle') { bg = 'bg-amber-500'; ping = 'bg-amber-400'; shadow = 'shadow-[0_0_8px_rgba(245,158,11,0.8)]'; }
                                    else if (peer.statusData?.status === 'dnd') { bg = 'bg-rose-600'; ping = 'bg-rose-500'; shadow = 'shadow-[0_0_8px_rgba(225,29,72,0.8)]'; }
                                    
                                    return (
                                        <>
                                            {!isOffline && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${ping} opacity-75`}></span>}
                                            <span className={`relative inline-flex rounded-full h-3 w-3 ${bg} ${shadow}`}></span>
                                        </>
                                    );
                                })()}
                              </div>
                              <div className="flex flex-col flex-1 min-w-0">
                                  <span className={`text-sm font-medium truncate ${activeChat === peer.ip ? 'text-white' : 'text-white/70'}`}>
                                      {assignments.find(a => a.ip === peer.ip) 
                                          ? `${profiles.find(p => p.id === assignments.find(a => a.ip === peer.ip)?.profileId)?.name || 'Profile'} (${peer.name})`
                                          : peer.name}
                                  </span>
                                  {peer.statusData?.text && (
                                      <div className="text-[10px] text-white/50 truncate font-medium italic mt-0.5">
                                          {peer.statusData.text}
                                      </div>
                                  )}
                                  {peer.activity && peer.activity.type === 'playing' && (
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                          <Gamepad2 size={10} className="text-emerald-400" />
                                          <span className="text-[10px] text-emerald-400/90 font-semibold truncate flex-1">
                                              [Playing] {peer.activity.details}
                                          </span>
                                      </div>
                                  )}
                              </div>
                              
                              {/* OS Badge & Latency */}
                              <div className="ml-auto opacity-40 shrink-0 flex items-center gap-2">
                                  {typingPeers[peer.ip] && <div className="flex items-center gap-0.5 opacity-60">
                                      <span className="w-1 h-1 bg-white rounded-full animate-bounce"></span>
                                      <span className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                                      <span className="w-1 h-1 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                                  </div>}
                                  
                                  {peer.latency !== undefined && peer.isJellychatOnline && (
                                      <div className="text-[10px] font-mono flex items-center gap-1 bg-black/20 px-1.5 py-0.5 rounded" title="Ping Latency">
                                          <span className={`w-1.5 h-1.5 rounded-full ${peer.latency < 50 ? 'bg-emerald-400' : peer.latency < 150 ? 'bg-amber-400' : 'bg-rose-400'}`}></span>
                                          {peer.latency}ms
                                      </div>
                                  )}

                                  {(peer.os.toLowerCase().includes('win') || peer.os.toLowerCase().includes('mac') || peer.os.toLowerCase().includes('linux')) && <Monitor size={12} />}
                                  {(peer.os.toLowerCase().includes('ios') || peer.os.toLowerCase().includes('android')) && <Smartphone size={12} />}
                                  
                                  <button 
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          const profileName = window.prompt("Assign this device to a Profile Name (e.g., Alice):");
                                          if (profileName) {
                                              const profileId = 'prof_' + Date.now();
                                              fetch('/api/profiles', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ id: profileId, name: profileName })
                                              }).then(() => {
                                                  fetch('/api/assignments', {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify({ ip: peer.ip, profileId })
                                                  }).then(() => {
                                                      fetch('/api/profiles').then(r => r.json()).then(setProfiles);
                                                      fetch('/api/assignments').then(r => r.json()).then(setAssignments);
                                                  });
                                              });
                                          }
                                      }}
                                      className="p-1 hover:bg-white/10 rounded-md transition-colors"
                                      title="Assign to Profile"
                                  >
                                      <UserPlus size={12} />
                                  </button>
                              </div>
                          </div>
                          {unreadCounts[peer.ip] > 0 && (
                              <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.6)] ml-2">
                                  {unreadCounts[peer.ip]}
                              </span>
                          )}
                      </button>
                  </li>
                ))}
                {peers.length === 0 && (
                  <li className="text-sm text-white/40 italic px-2 bg-white/5 py-4 rounded-xl text-center border border-white/5">No other peers online</li>
                )}
              </ul>
          </div>
        </div>

        {/* Current User Identity */}
        <div className="p-5 border-t border-white/5 bg-black/20 backdrop-blur-3xl shrink-0 flex flex-col gap-3">
          
          {!notificationsEnabled && (
              <div className="flex flex-col gap-2">
                  <button 
                    onClick={() => {
                      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
                      
                      if (isIOS && !isStandalone) {
                          alert("Apple requires you to add this app to your Home Screen to enable notifications.\n\nTap the 'Share' icon at the bottom of Safari, and select 'Add to Home Screen'.");
                      } else if (typeof Notification !== 'undefined') {
                          subscribeToWebPush();
                      } else {
                          alert("Push notifications are not supported in your current browser.");
                      }
                    }}
                    className="w-full py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-semibold rounded-lg border border-rose-500/20 transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                      <BellRing size={14} /> Enable Notifications
                  </button>
                  {(() => {
                      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
                      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
                      if (isIOS && !isStandalone) {
                          return (
                              <p className="text-[9px] text-white/50 text-center px-2 leading-tight">
                                  iOS User? Tap <b>Share</b> then <b>Add to Home Screen</b> first!
                              </p>
                          );
                      }
                      return null;
                  })()}
              </div>
          )}

          <div className="flex items-center gap-4 relative">
            <button 
                onClick={() => setShowStatusPicker(!showStatusPicker)}
                className="w-12 h-12 rounded-2xl jelly-gradient flex items-center justify-center font-bold text-lg text-white shadow-lg relative overflow-hidden shrink-0 transition-transform hover:scale-105"
            >
                <div className="absolute inset-0 bg-white/20 blur-sm"></div>
                <span className="relative z-10">{me?.deviceName?.charAt(0).toUpperCase() || '?'}</span>
                
                <div className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full border-2 border-[#09090b] z-20" style={{
                    backgroundColor: me?.statusData?.status === 'offline' ? '#71717a' : 
                                     me?.statusData?.status === 'idle' ? '#f59e0b' : 
                                     me?.statusData?.status === 'dnd' ? '#e11d48' : '#10b981'
                }}></div>
            </button>
            
            {showStatusPicker && (
                <div className="absolute bottom-full left-0 mb-4 w-64 bg-[#09090b] border border-white/10 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-3 z-50 animate-in fade-in zoom-in-95 origin-bottom-left">
                    <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2 px-2">Set Status</h3>
                    <div className="space-y-1">
                        <button onClick={() => updateStatus('online')} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-xl text-sm font-medium transition-colors">
                            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> Online
                        </button>
                        <button onClick={() => updateStatus('idle')} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-xl text-sm font-medium transition-colors">
                            <span className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span> Idle
                        </button>
                        <button onClick={() => updateStatus('dnd')} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-xl text-sm font-medium transition-colors">
                            <span className="w-3 h-3 rounded-full bg-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.8)]"></span> Do Not Disturb
                        </button>
                        <button onClick={() => updateStatus('offline')} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-xl text-sm font-medium transition-colors text-white/50">
                            <span className="w-3 h-3 rounded-full bg-zinc-500"></span> Invisible
                        </button>
                    </div>
                    <div className="mt-3 pt-3 border-t border-white/10">
                        <input 
                            type="text" 
                            placeholder="Custom status..." 
                            value={customStatusText}
                            onChange={(e) => setCustomStatusText(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter') updateStatus(me?.statusData?.status || 'online') }}
                            className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500/50 transition-colors"
                        />
                        <button onClick={() => updateStatus(me?.statusData?.status || 'online')} className="w-full mt-2 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors">
                            Save
                        </button>
                    </div>
                </div>
            )}
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-semibold truncate text-white/90">{me?.deviceName || 'Connecting...'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                  <Wifi size={10} className="text-rose-400 shrink-0" />
                  <p className="text-[11px] text-white/40 truncate font-mono">{me?.ip || 'Waiting for IP'}</p>
              </div>
            </div>
            <button 
                onClick={() => setShowGlobalSettings(true)}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/50 hover:text-white transition-colors"
                title="App Settings"
            >
                <Settings size={18} />
            </button>
            {me && me.isAdmin && (
                <button
                    onClick={() => setShowAdminManagement(true)}
                    className="p-2 hover:bg-white/10 rounded-xl text-white/50 hover:text-indigo-400 transition-colors"
                    title="Admin Management"
                >
                    <Shield size={18} />
                </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
              {authStatus.isAdmin && (
                  <button onClick={() => setShowUserSettings(true)} className="flex-1 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 hover:text-indigo-200 text-xs font-bold rounded-lg border border-indigo-500/20 transition-colors flex items-center justify-center gap-1.5">
                      <Users size={14} /> User Management
                  </button>
              )}
          </div>
          <div className="flex items-center gap-2 mt-1">
              <button onClick={exportIdentity} className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-[10px] font-semibold rounded-md border border-white/5 transition-colors flex items-center justify-center gap-1.5">
                  <Download size={12} /> Export Keys
              </button>
              <label className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 text-[10px] font-semibold rounded-md border border-white/5 transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                  <Upload size={12} /> Import Keys
                  <input type="file" accept=".json" className="hidden" onChange={importIdentity} />
              </label>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-h-0 z-10 w-full max-w-[100vw] overflow-hidden">
        
        {/* Chat Header */}
        <header className="glass-panel shrink-0 px-4 md:px-8 py-5 flex items-center justify-between z-20 border-b border-white/5">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/70 transition-colors">
                <Menu size={20} />
            </button>
            <div className="bg-white/5 p-2 rounded-lg hidden sm:block">
                {activeChat === null ? <Terminal className="text-white/60" size={18} /> : <MessageCircle className="text-white/60" size={18} />}
            </div>
            <div className="flex-1 min-w-0 pr-2">
                <h2 key={activeChat} className="font-semibold text-white/90 text-sm md:text-base truncate animate-in fade-in slide-in-from-bottom-1 duration-300">
                    {activeChat === null ? 'Global Feed' : `Chat with ${activePeerName}`}
                </h2>
                <div key={`${activeChat}-status`} className="flex items-center gap-2 mt-0.5 animate-in fade-in duration-500 delay-100 fill-mode-both">
                    <p className="text-[10px] md:text-[11px] text-white/40 truncate">
                        {activeChat === null ? 'Encrypted via Tailscale' : 'End-to-End Encrypted'}
                    </p>
                    {chatPeer && (
                        <div className="flex items-center gap-1.5 shrink-0">
                            <div className={`w-1.5 h-1.5 rounded-full ${chatPeer.isJellychatOnline ? 'bg-emerald-400' : 'bg-gray-400'} shadow-[0_0_10px_currentColor]`}></div>
                            <span className="text-white/40 text-[10px] uppercase font-bold hidden sm:inline">{chatPeer.isJellychatOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    )}
                </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {chatPeer && (
                <>
                    <button 
                        onClick={async () => {
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                                setCallState({ status: 'outgoing', peerId: chatPeer.ip, peerName: chatPeer.name, isVideo: false, initialStream: stream });
                            } catch (e) {
                                alert("Microphone permission denied.");
                            }
                        }}
                        className="p-2 md:p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-emerald-400 transition-colors shadow-sm"
                    >
                        <Phone size={20} />
                    </button>
                    <button 
                        onClick={async () => {
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                                setCallState({ status: 'outgoing', peerId: chatPeer.ip, peerName: chatPeer.name, isVideo: true, initialStream: stream });
                            } catch (e) {
                                alert("Camera/Microphone permission denied.");
                            }
                        }}
                        className="p-2 md:p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-emerald-400 transition-colors shadow-sm"
                    >
                        <Video size={20} />
                    </button>
                    <button 
                        onClick={async () => {
                            try {
                                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getDisplayMedia({ video: true }));
                                setCallState({ status: 'outgoing', peerId: chatPeer.ip, peerName: chatPeer.name, isVideo: true, isScreenShare: true, initialStream: stream });
                            } catch (e) {
                                alert("Screen share permission denied or cancelled.");
                            }
                        }}
                        className="p-2 md:p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-emerald-400 transition-colors shadow-sm"
                        title="Share Screen"
                    >
                        <MonitorUp size={20} />
                    </button>
                </>
            )}

            <button 
                onClick={() => setGamesModalOpen(true)}
                className="p-2 md:p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-indigo-400 transition-colors shadow-sm"
                title="Games"
            >
                <Gamepad2 size={20} />
            </button>

            <button 
                onClick={() => setShowWorkspace(true)}
                className="p-2 md:p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-emerald-400 transition-colors shadow-sm"
                title="Collaborative Whiteboard"
            >
                <PenTool size={20} />
            </button>

            {/* Nested Header Menu */}
            <div className="relative">
                <button 
                    onClick={() => setShowHeaderMenu(!showHeaderMenu)}
                    className={`p-2 md:p-2.5 rounded-full transition-colors shadow-sm ${showHeaderMenu ? 'bg-white/20 text-white' : 'bg-white/5 hover:bg-white/10 text-white/70'}`}
                >
                    <MoreVertical size={20} />
                </button>
                
                {showHeaderMenu && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowHeaderMenu(false)}></div>
                        <div className="absolute right-0 mt-2 w-48 bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl z-50 flex flex-col py-2 animate-in zoom-in-95 duration-200">
                            <button 
                                onClick={() => { setShowSearch(true); setShowHeaderMenu(false); }}
                                className="flex items-center gap-3 px-4 py-2.5 text-white/90 hover:bg-white/10 transition-colors text-sm w-full text-left"
                            >
                                <Search size={16} className="text-white/70" /> Search Messages
                            </button>
                            {activeChat !== null && (
                                <button 
                                    onClick={() => { sendNudge(); setShowHeaderMenu(false); }}
                                    className="flex items-center gap-3 px-4 py-2.5 text-white/90 hover:bg-white/10 transition-colors text-sm w-full text-left"
                                >
                                    <BellRing size={16} className="text-violet-400" /> Send Nudge
                                </button>
                            )}
                            
                            {activeChat === null && (
                                <button 
                                    onClick={() => { resetGlobalChat(); setShowHeaderMenu(false); }}
                                    className="flex items-center gap-3 px-4 py-2.5 text-rose-400 hover:bg-white/10 transition-colors text-sm w-full text-left font-medium border-t border-white/5 mt-1 pt-3"
                                >
                                    <Trash2 size={16} /> Clear Global Feed
                                </button>
                            )}
                            
                            <button 
                                onClick={() => { generateGuestLink(); setShowHeaderMenu(false); }}
                                className="flex items-center gap-3 px-4 py-2.5 text-emerald-400 hover:bg-white/10 transition-colors text-sm w-full text-left font-medium border-t border-white/5 mt-1 pt-3"
                            >
                                <Link size={16} /> Invite Guest Link
                            </button>
                            
                            {!notificationsEnabled && (
                                <button 
                                    onClick={() => {
                                        if (typeof Notification !== 'undefined') {
                                            Notification.requestPermission().then(permission => {
                                                if (permission === 'granted') subscribeToWebPush();
                                            });
                                        }
                                        setShowHeaderMenu(false);
                                    }}
                                    className="flex items-center gap-3 px-4 py-2.5 text-blue-400 hover:bg-white/10 transition-colors text-sm w-full text-left"
                                >
                                    <BellRing size={16} /> Enable Push
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
          </div>
        </header>

        {/* Messages */}
        <div 
            ref={messagesContainerRef} 
            onScroll={handleScroll}
            className={`flex-1 overflow-y-auto p-4 md:p-8 space-y-6 md:space-y-8 pb-4 ${activeContextMenu !== null ? 'z-50' : 'z-10'}`}
        >
          {/* Context Menu Overlay */}
          {activeContextMenu !== null && (
              <div 
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => setActiveContextMenu(null)}
              ></div>
          )}
          
          {messages.map((msg, idx) => {
            const isMe = msg.senderId === me?.ip;
            const showAvatar = idx === 0 || messages[idx - 1].senderId !== msg.senderId;
            let parsedReactions: Record<string, string[]> = {};
            if (msg.reactions) {
                try { parsedReactions = JSON.parse(msg.reactions); } catch(e){}
            }
            
            const quotedMessage = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
            const isContextMenuOpen = activeContextMenu === msg.id;

            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 fade-in duration-300 relative min-w-0`}>
                <div className={`flex max-w-[90%] md:max-w-[70%] ${isContextMenuOpen ? 'z-50 relative' : ''} min-w-0`}>
                  {/* Message Body */}
                  <div className={`flex flex-col relative ${isMe ? 'items-end' : 'items-start'} min-w-0`}>
                    
                    {/* Context Menu (Triggered by Long-Press / Right-Click) */}
                    {isContextMenuOpen && (
                        <div className={`absolute top-0 flex flex-col gap-2 bg-black/60 backdrop-blur-3xl border border-white/10 p-2 rounded-2xl animate-in zoom-in-95 duration-200 shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-50 -translate-y-[110%] ${isMe ? 'right-0' : 'left-0'}`}>
                            <div className="flex items-center gap-2 px-1 relative">
                                {showFullEmojiPicker === msg.id ? (
                                    <div className="absolute bottom-12 left-0" onClick={e => e.stopPropagation()}>
                                        <EmojiPicker 
                                            theme={Theme.DARK} 
                                            emojiStyle={EmojiStyle.NATIVE}
                                            onEmojiClick={(emojiData, e) => {
                                                addReaction(e as any, msg.id, emojiData.emoji);
                                                setShowFullEmojiPicker(null);
                                            }}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        {EMOJIS.map(emoji => (
                                            <button 
                                                key={emoji} 
                                                onClick={(e) => addReaction(e, msg.id, emoji)}
                                                className="w-10 h-10 text-xl flex items-center justify-center hover:bg-white/20 rounded-xl hover:scale-125 transition-all"
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setShowFullEmojiPicker(msg.id); }}
                                            className="w-10 h-10 text-white/50 flex items-center justify-center hover:bg-white/20 hover:text-white/90 rounded-xl transition-all"
                                        >
                                            <Plus size={20} />
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="h-[1px] bg-white/10 mx-2"></div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setReplyingTo(msg); setActiveContextMenu(null); }}
                                className="flex items-center gap-3 px-3 py-2 text-white/90 hover:bg-white/10 rounded-xl transition-colors font-medium text-sm"
                            >
                                <Reply size={18} className="text-white/70" /> Reply
                            </button>
                            {isMe && msg.type === 'text' && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setEditingMessage(msg); setInputText(msg.content); setActiveContextMenu(null); }}
                                    className="flex items-center gap-3 px-3 py-2 text-white/90 hover:bg-white/10 rounded-xl transition-colors font-medium text-sm"
                                >
                                    <Edit2 size={18} className="text-white/70" /> Edit
                                </button>
                            )}
                            {isMe && (
                                <button 
                                    onClick={(e) => deleteMessage(e, msg.id)}
                                    className="flex items-center gap-3 px-3 py-2 text-rose-400 hover:bg-white/10 rounded-xl transition-colors font-medium text-sm"
                                >
                                    <Trash2 size={18} className="text-rose-400/70" /> Delete
                                </button>
                            )}
                        </div>
                    )}

                    {showAvatar && (
                      <div className="flex items-center gap-2 mb-1.5 px-1">
                        <div 
                            onClick={() => {
                                const peer = peers.find(p => p.ip === msg.senderId);
                                if (peer) setSelectedProfilePeer(peer);
                            }}
                            className="w-6 h-6 shrink-0 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-indigo-500/40 transition-colors overflow-hidden border border-indigo-500/20"
                        >
                            {(() => {
                                const assignment = assignments.find(a => a.ip === msg.senderId);
                                const profile = assignment ? profiles.find(p => p.id === assignment.profileId) : null;
                                if (profile && profile.avatar) {
                                    return <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />;
                                }
                                return (profile ? profile.name : msg.senderName).charAt(0).toUpperCase();
                            })()}
                        </div>
                        <div className="flex items-baseline gap-2.5">
                            <span className="text-[13px] md:text-sm font-semibold text-white/80">
                                {(() => {
                                    const assignment = assignments.find(a => a.ip === msg.senderId);
                                    const profile = assignment ? profiles.find(p => p.id === assignment.profileId) : null;
                                    return profile ? profile.name : msg.senderName;
                                })()}
                            </span>
                            <span className="text-[10px] md:text-[11px] text-white/30 font-medium">{format(new Date(msg.timestamp + 'Z'), 'h:mm a')}</span>
                        </div>
                      </div>
                    )}
                    
                    <div 
                        onClick={(e) => handleContextMenu(e, msg.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            const stickerUrl = e.dataTransfer.getData('text/plain');
                            if (!stickerUrl) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = ((e.clientX - rect.left) / rect.width) * 100;
                            const y = ((e.clientY - rect.top) / rect.height) * 100;
                            if (socket) {
                                socket.emit('add_sticker', {
                                    messageId: msg.id,
                                    sticker: { url: stickerUrl, x, y }
                                });
                            }
                        }}
                        className={`relative flex flex-col ${isMe ? 'items-end' : 'items-start'} select-none md:select-auto cursor-pointer md:cursor-auto`}
                        title="Tap to react"
                    >
                        
                        {(() => {
                            let parsedStickers = [];
                            try { parsedStickers = JSON.parse(msg.stickers || '[]'); } catch(e){}
                            return parsedStickers.map((stk: any, i: number) => (
                                <img 
                                    key={i} 
                                    src={stk.url} 
                                    className="absolute w-16 h-16 object-contain pointer-events-none drop-shadow-lg z-30 animate-in zoom-in spin-in-12 duration-300" 
                                    style={{ left: `${stk.x}%`, top: `${stk.y}%`, transform: 'translate(-50%, -50%)' }} 
                                />
                            ));
                        })()}
                        {/* Quoted Message */}
                        {quotedMessage && (
                            <div className="mb-1.5 opacity-80 scale-95 origin-bottom max-w-full">
                                <div className="flex items-center gap-2 mb-1 px-1">
                                    <Reply size={12} className="text-white/40" />
                                    <span className="text-[11px] font-bold text-white/50">{quotedMessage.senderName}</span>
                                </div>
                                <div className={`px-3 py-2 text-[12px] truncate max-w-xs rounded-xl backdrop-blur-md border border-white/5
                                    ${isMe ? 'bg-white/10 text-white/80' : 'bg-black/30 text-white/60'}
                                `}>
                                    {quotedMessage.type === 'image' ? '📷 Image' : quotedMessage.type === 'file' ? '📎 File' : quotedMessage.type === 'audio' ? '🎙️ Voice Memo' : quotedMessage.content}
                                </div>
                            </div>
                        )}

                        {msg.type === 'image' ? (
                          <div 
                            onClick={() => setSelectedImage(getAttachmentSrc(msg.attachmentUrl))}
                            className={`p-1 rounded-xl md:rounded-2xl backdrop-blur-md overflow-hidden cursor-zoom-in hover:opacity-90 transition-opacity ${isMe ? 'jelly-gradient shadow-[0_8px_20px_-6px_rgba(244,63,94,0.4)]' : 'glass-card'}`}
                          >
                            <img src={getAttachmentSrc(msg.attachmentUrl)} alt="Attachment" className="max-h-52 md:max-h-64 max-w-full rounded-lg md:rounded-xl object-contain bg-black/20" loading="lazy" />
                          </div>
                        ) : msg.type === 'video' ? (
                          <div className={`flex items-center gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`p-1 rounded-xl md:rounded-2xl backdrop-blur-md overflow-hidden ${isMe ? 'jelly-gradient shadow-[0_8px_20px_-6px_rgba(244,63,94,0.4)]' : 'glass-card'}`}>
                              <video src={getAttachmentSrc(msg.attachmentUrl)} controls className="max-h-52 md:max-h-64 max-w-[240px] md:max-w-xs rounded-lg md:rounded-xl bg-black/20" preload="metadata" />
                            </div>
                            <button 
                                onClick={() => forceDownload(msg.attachmentUrl || '', msg.fileName || 'video.mp4')}
                                className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md shadow-sm shrink-0"
                                title="Download Video"
                            >
                                <Download size={20} />
                            </button>
                          </div>
                        ) : msg.type === 'file' ? (
                          <div className={`p-4 rounded-2xl flex items-center gap-4 backdrop-blur-md border border-white/5
                              ${isMe ? 'bg-white/10 shadow-[0_8px_20px_-6px_rgba(244,63,94,0.3)]' : 'glass-card'}
                          `}>
                              <div className={`p-3 rounded-xl ${isMe ? 'jelly-gradient text-white' : 'bg-white/10 text-white/70'}`}>
                                  <FileText size={20} />
                              </div>
                              <div className="flex flex-col max-w-[180px] md:max-w-[240px]">
                                  <span className={`font-semibold text-sm truncate ${isMe ? 'text-white' : 'text-white/90'}`}>{msg.fileName || 'File Attachment'}</span>
                                  <a href={getAttachmentSrc(msg.attachmentUrl)} download className={`text-xs hover:underline mt-1 font-medium ${isMe ? 'text-white/80' : 'text-rose-400'}`}>Download File</a>
                              </div>
                          </div>
                        ) : msg.type === 'audio' ? (
                           <AudioPlayer url={getAttachmentSrc(msg.attachmentUrl)} isMe={isMe} />
                        ) : (
                          <div className={`px-4 py-2.5 md:px-5 md:py-3.5 text-[14px] md:text-[15px] leading-relaxed backdrop-blur-md break-words break-all md:break-words overflow-x-hidden
                            ${isMe 
                              ? 'jelly-gradient text-white rounded-2xl rounded-tr-sm shadow-[0_8px_20px_-6px_rgba(244,63,94,0.4)]' 
                              : 'glass-card text-white/90 rounded-2xl rounded-tl-sm'}
                          `}>
                            <div className="markdown-content">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {msg.content}
                                </ReactMarkdown>
                            </div>
                            {/* Link Previews */}
                            {msg.content.match(/(https?:\/\/[^\s]+)/g)?.map((url, i) => (
                                <LinkPreview key={i} url={url} previewData={linkPreviews[url]} />
                            ))}
                          </div>
                        )}
                        
                        {/* Status & Edited Indicators */}
                        {isMe && (
                            <div className="flex items-center gap-1.5 mt-1 mr-1 text-[10px] text-white/30 font-medium tracking-wide">
                                {msg.isEdited === 1 && <span className="mr-1">Edited</span>}
                                {msg.status === 'read' ? (
                                    <CheckCheck size={12} className="text-blue-400" />
                                ) : msg.status === 'delivered' ? (
                                    <CheckCheck size={12} />
                                ) : (
                                    <Check size={12} />
                                )}
                            </div>
                        )}
                        {!isMe && msg.isEdited === 1 && (
                            <div className="flex items-center gap-1.5 mt-1 ml-1 text-[10px] text-white/30 font-medium tracking-wide">
                                <span>Edited</span>
                            </div>
                        )}
                        
                        {/* Display Reactions */}
                        {Object.keys(parsedReactions).length > 0 && (
                            <div className={`absolute -bottom-4 flex flex-wrap gap-1 z-10 ${isMe ? 'right-2' : 'left-2'}`}>
                                {Object.entries(parsedReactions).map(([emoji, users]) => (
                                    <button 
                                        key={emoji}
                                        onClick={(e) => addReaction(e, msg.id, emoji)}
                                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md border border-white/10 backdrop-blur-xl transition-all hover:scale-105
                                            ${users.includes(me?.ip || '') ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' : 'bg-black/60 text-white'}
                                        `}
                                    >
                                        <span>{emoji}</span>
                                        {users.length > 1 && <span className="opacity-70">{users.length}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                  </div>
                </div>
              </div>
            );
          })}
          
          {/* iMessage-Style Typing Bubble */}
          {Object.entries(typingPeers).filter(([_, isTyping]) => isTyping).map(([peerIp]) => {
              const peerName = peers.find(p => p.ip === peerIp)?.name || peerIp;
              return (
                  <div key={peerIp} className="flex justify-start animate-in slide-in-from-bottom-2 fade-in duration-300 relative mt-2">
                      <div className="flex gap-3 md:gap-4">
                          {/* Avatar */}
                          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl flex-shrink-0 flex items-center justify-center font-bold text-xs md:text-sm mt-1 shadow-sm transition-all duration-300 bg-white/10 text-white/70 border border-white/5">
                              {peerName?.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col items-start mt-1">
                              {activeChat === null && <span className="text-[11px] font-semibold text-white/50 mb-1 px-1">{peerName} is typing...</span>}
                              <div className="px-4 py-3 md:px-5 md:py-4 glass-card rounded-2xl rounded-tl-sm flex items-center justify-center min-w-[70px]">
                                  <div className="flex items-center gap-1.5 opacity-60">
                                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce"></span>
                                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
                                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
              );
          })}
        </div>

        {/* Scroll to Bottom Button */}
        {showScrollButton && (
            <button 
                onClick={() => {
                    scrollToBottom();
                    isUserScrolledRef.current = false;
                    setShowScrollButton(false);
                }}
                className="absolute bottom-24 right-4 md:right-8 z-30 p-3 rounded-full jelly-gradient text-white shadow-[0_8px_30px_rgba(244,63,94,0.4)] hover:-translate-y-1 transition-all animate-in zoom-in-95 duration-200"
            >
                <Download size={20} className="rotate-180" />
            </button>
        )}

        {/* Input Area */}
        <div className="shrink-0 glass-panel border-t border-white/5 relative z-20 p-2 md:p-4 min-w-0 w-full">
          <div className="max-w-5xl mx-auto relative min-w-0 w-full">
              {replyingTo && (
                  <div className="mb-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-3 pr-10 relative shadow-inner animate-in slide-in-from-bottom-2 fade-in">
                      <button onClick={() => setReplyingTo(null)} className="absolute right-2 top-2 p-1.5 hover:bg-white/10 rounded-lg text-white/50 transition-colors">
                          <X size={14} />
                      </button>
                      <div className="flex items-center gap-2 mb-1">
                          <Reply size={12} className="text-violet-400" />
                          <span className="text-[11px] font-bold text-violet-300 uppercase tracking-widest">Replying to {replyingTo.senderName}</span>
                      </div>
                      <p className="text-sm text-white/70 truncate">
                          {replyingTo.type === 'image' ? '📷 Image' : replyingTo.type === 'file' ? '📎 File' : replyingTo.type === 'audio' ? '🎙️ Voice Memo' : replyingTo.content}
                      </p>
                  </div>
              )}
              {editingMessage && (
                  <div className="mb-2 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-3 pr-10 relative shadow-inner animate-in slide-in-from-bottom-2 fade-in">
                      <button onClick={() => { setEditingMessage(null); setInputText(''); }} className="absolute right-2 top-2 p-1.5 hover:bg-white/10 rounded-lg text-white/50 transition-colors">
                          <X size={14} />
                      </button>
                      <div className="flex items-center gap-2 mb-1">
                          <Edit2 size={12} className="text-rose-400" />
                          <span className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Editing Message</span>
                      </div>
                      <p className="text-sm text-white/70 truncate">
                          {editingMessage.content}
                      </p>
                  </div>
              )}
              
              <form onSubmit={sendMessage} className="flex items-center w-full relative min-w-0">
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute left-1 md:left-2 top-1/2 -translate-y-1/2 p-2 md:p-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-all z-10"
                >
                  <Paperclip size={20} />
                </button>
                <button 
                  type="button"
                  onClick={() => setShowGiphy(true)}
                  className="absolute left-10 md:left-12 top-1/2 -translate-y-1/2 p-2 md:p-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-all z-10"
                >
                  <ImageIcon size={20} />
                </button>
                <button 
                  type="button"
                  onClick={() => setShowStickers(true)}
                  className="absolute left-20 md:left-24 top-1/2 -translate-y-1/2 p-2 md:p-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-all z-10"
                >
                  <Sticker size={20} />
                </button>
    
                <textarea
                  value={inputText}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={isRecording}
                  rows={1}
                  placeholder={isRecording ? "Recording voice memo... Release to send!" : (activeChat === null ? "Message Global Feed..." : `Message ${activePeerName}...`)}
                  className={`w-full min-w-0 border border-white/10 rounded-2xl pl-32 md:pl-36 pr-32 md:pr-40 py-3 md:py-4 text-[14px] md:text-[15px] text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 focus:border-rose-500/50 transition-all shadow-inner resize-none overflow-y-auto max-h-[150px]
                      ${isRecording ? 'bg-rose-500/10 placeholder-rose-300 animate-pulse' : 'bg-white/5 placeholder-white/30 focus:bg-white/10'}
                  `}
                />
                
                <div className="absolute right-1 md:right-2 flex items-center gap-1 md:gap-2">
                    <button 
                      type="button"
                      onClick={() => setShowAiDrawer(true)}
                      className="p-2 md:p-2.5 rounded-xl text-white/50 hover:text-white hover:bg-indigo-500/20 hover:text-indigo-400 transition-all z-10 relative group"
                    >
                      {isGeneratingSticker ? (
                        <Loader2 size={20} className="animate-spin text-indigo-400 drop-shadow-[0_0_10px_rgba(129,140,248,0.9)]" />
                      ) : (
                        <Wand2 size={20} />
                      )}
                    </button>
                    {inputText.trim().length === 0 && (
                        <button 
                          type="button"
                          onPointerDown={(e) => { 
                              e.preventDefault(); 
                              e.stopPropagation(); 
                              e.currentTarget.setPointerCapture(e.pointerId);
                              startRecording(); 
                          }}
                          onPointerUp={(e) => { 
                              e.preventDefault(); 
                              e.stopPropagation(); 
                              e.currentTarget.releasePointerCapture(e.pointerId);
                              stopRecording(); 
                          }}
                          onPointerCancel={(e) => { 
                              e.preventDefault(); 
                              e.stopPropagation(); 
                              e.currentTarget.releasePointerCapture(e.pointerId);
                              stopRecording(); 
                          }}
                          onContextMenu={(e) => e.preventDefault()}
                          style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                          className={`p-2 md:p-2.5 rounded-xl transition-all shadow-lg
                              ${isRecording ? 'bg-rose-500 text-white scale-110 shadow-[0_0_20px_rgba(244,63,94,0.6)]' : 'bg-white/10 text-white/80 hover:bg-white/20'}
                          `}
                        >
                          {isRecording ? <Square size={20} fill="currentColor" /> : <Mic size={20} />}
                        </button>
                    )}
    
                    {(inputText.trim().length > 0 || isUploading) && (
                        <button 
                          type="submit" 
                          disabled={(!inputText.trim() && !isUploading)}
                          className="p-2 md:p-2.5 rounded-xl jelly-gradient text-white hover:opacity-90 disabled:opacity-50 disabled:grayscale transition-all shadow-[0_4px_12px_rgba(244,63,94,0.4)] glow-accent"
                        >
                          {isUploading ? (
                            <Loader2 size={20} className="animate-spin" />
                          ) : (
                            <Send size={20} className={`${inputText.trim() ? 'translate-x-0.5 -translate-y-0.5 transition-transform' : ''}`} />
                          )}
                        </button>
                    )}
                </div>
              </form>
          </div>
        </div>
      </main>

      {/* Lightbox for Images */}
      {selectedImage && (
          <div 
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl animate-in fade-in duration-300 flex items-center justify-center p-4 md:p-12 cursor-zoom-out"
            onClick={() => setSelectedImage(null)}
          >
              <div className="absolute top-4 right-4 md:top-8 md:right-8 flex items-center gap-3">
                  <button 
                      onClick={(e) => { e.stopPropagation(); forceDownload(selectedImage, 'image'); }}
                      className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md flex items-center justify-center"
                      title="Download Image"
                  >
                      <Download size={24} />
                  </button>
                  <button 
                      className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md"
                      onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
                  >
                      <X size={24} />
                  </button>
              </div>
              <img 
                  src={selectedImage} 
                  alt="Expanded" 
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-300" 
                  onClick={(e) => e.stopPropagation()}
              />
          </div>
      )}

      {/* Giphy Modal */}
      {showGiphy && (
          <div 
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-center justify-center p-4"
            onClick={() => setShowGiphy(false)}
          >
              <div 
                  className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col" 
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                      <h3 className="font-semibold text-white">Select a GIF</h3>
                      <button onClick={() => setShowGiphy(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/50">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-4 border-b border-white/5">
                      <input 
                          type="text" 
                          placeholder="Search Tenor..." 
                          value={giphySearch}
                          onChange={(e) => setGiphySearch(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                      />
                  </div>
                  <div className="h-[400px] overflow-y-auto p-2 bg-black/20 custom-scrollbar relative">
                      {isLoadingGifs ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                              <Loader2 size={24} className="text-white/50 animate-spin" />
                          </div>
                      ) : (
                          <div className="columns-2 md:columns-3 gap-2 space-y-2 p-1">
                              {gifs.map((gif: any) => (
                                  <img 
                                      key={gif.id} 
                                      src={gif.images.fixed_width.url} 
                                      alt={gif.title}
                                      onClick={() => handleSendGif(gif.images.original.url)}
                                      className="w-full rounded-lg cursor-pointer hover:opacity-80 transition-opacity bg-black/20"
                                      loading="lazy"
                                  />
                              ))}
                          </div>
                      )}
                  </div>
                  <div className="p-3 text-center text-[10px] text-white/30 font-bold uppercase tracking-widest flex items-center justify-center gap-1">
                     Powered By Tenor
                  </div>
              </div>
          </div>
      )}

      {/* WebRTC Video Call Modal */}
      {callState && socket && (
          <VideoCallModal 
              callState={callState} 
              setCallState={setCallState} 
              socket={socket} 
          />
      )}

      {/* Custom Sticker Drawer Floating Panel */}
      {showStickers && (
          <div 
              className="absolute bottom-24 right-4 md:right-8 z-50 w-[320px] max-w-[calc(100vw-32px)] bg-[#18181b] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[500px] animate-in slide-in-from-bottom-5" 
          >
              <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                      <Sticker size={18} className="text-white/50" />
                      Stickers
                  </h3>
                  <button onClick={() => setShowStickers(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/50">
                      <X size={20} />
                  </button>
              </div>
              
              <div className="p-4 border-b border-white/5 bg-black/20 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-white/50 uppercase tracking-widest flex items-center gap-1.5 mb-1"><Upload size={12} /> Upload Custom Sticker</p>
                  <input 
                      type="file" 
                      ref={fileStickerInputRef} 
                      onChange={handleCustomStickerUpload}
                      accept="image/*"
                      className="hidden"
                  />
                      <button 
                        onClick={() => fileStickerInputRef.current?.click()}
                        className="w-full px-4 py-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-white font-medium shadow-sm flex items-center justify-center gap-2 transition-all"
                      >
                          <Upload size={18} /> Choose Image
                      </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                      <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">Your Stickers</p>
                      
                      {generatedStickers.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-40 text-white/30 text-center">
                              <Sticker size={40} className="mb-3 opacity-20" />
                              <p className="text-sm">No stickers yet.</p>
                              <p className="text-xs mt-1">Upload one above, then drag and drop it onto any message!</p>
                          </div>
                      ) : (
                          <div className="grid grid-cols-3 gap-3">
                              {generatedStickers.map((url, idx) => (
                                  <div key={idx} className="aspect-square bg-white/5 rounded-xl border border-white/5 hover:border-white/20 transition-all flex items-center justify-center overflow-hidden p-2">
                                      <img 
                                          src={url} 
                                          alt={`Sticker ${idx}`}
                                          draggable
                                          onDragStart={(e) => {
                                              e.dataTransfer.setData('text/plain', url);
                                          }}
                                          onClick={() => {
                                              if (socket) {
                                                  socket.emit('send_message', {
                                                      content: '',
                                                      recipientId: activeChat,
                                                      channelId: activeChat === null ? activeChannel : undefined,
                                                      type: 'image',
                                                      attachmentUrl: url,
                                                      fileName: 'sticker.png'
                                                  });
                                                  setShowStickers(false);
                                              }
                                          }}
                                          className="w-full h-full object-contain cursor-grab active:cursor-grabbing hover:scale-110 transition-transform drop-shadow-md"
                                      />
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* AI Sticker Generator Modal */}
      {showAiDrawer && (
          <div 
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-center justify-center p-4"
            onClick={() => setShowAiDrawer(false)}
          >
              <div 
                  className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col" 
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                      <h3 className="font-semibold text-white flex items-center gap-2">
                          <Wand2 size={18} className="text-indigo-400" />
                          AI Sticker Generator
                      </h3>
                      <button onClick={() => setShowAiDrawer(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/50">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="p-6">
                      <form onSubmit={(e) => { e.preventDefault(); handleGenerateSticker(e); setShowAiDrawer(false); }} className="flex flex-col gap-4">
                          <p className="text-sm text-white/70 text-center mb-2">Describe what you want to generate. It will be added to your stickers drawer automatically.</p>
                          <input 
                              type="text" 
                              placeholder="E.g., A cute cybernetic cat hacking a mainframe..." 
                              value={aiPrompt}
                              onChange={(e) => setAiPrompt(e.target.value)}
                              className="w-full bg-black/30 border border-indigo-500/30 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner"
                              autoFocus
                          />
                          <button 
                            type="submit" 
                            disabled={isGeneratingSticker || !aiPrompt.trim()}
                            className="w-full px-4 py-3.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:grayscale rounded-xl text-white font-bold shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                          >
                              {isGeneratingSticker ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                              Generate & Add
                          </button>
                      </form>
                  </div>
              </div>
          </div>
      )}

      {/* Global Search Modal */}
      {showSearch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-[#18181b] w-full max-w-2xl rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden max-h-[85vh]">
                  <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                      <h3 className="font-semibold text-white flex items-center gap-2">
                          <Search size={18} className="text-white/50" />
                          Global Search
                      </h3>
                      <button onClick={() => setShowSearch(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/50">
                          <X size={20} />
                      </button>
                  </div>
                  <div className="p-4 border-b border-white/5">
                      <form onSubmit={handleSearch} className="flex gap-2">
                          <input 
                              type="text" 
                              placeholder="Search all messages..." 
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                              autoFocus
                          />
                          <button type="submit" className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 rounded-xl text-white font-medium shadow-lg shadow-rose-500/20">
                              Search
                          </button>
                      </form>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 bg-black/20 custom-scrollbar space-y-4">
                      {isSearching ? (
                          <div className="flex items-center justify-center h-40">
                              <Loader2 size={24} className="text-white/50 animate-spin" />
                          </div>
                      ) : searchResults.length > 0 ? (
                          searchResults.map(msg => (
                              <div key={msg.id} className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors cursor-pointer" onClick={() => {
                                  setShowSearch(false);
                                  changeChat(msg.recipientId || null);
                              }}>
                                  <div className="flex items-center gap-2 mb-2">
                                      <span className="font-bold text-sm text-white">{msg.senderName}</span>
                                      <span className="text-[10px] text-white/40">{format(new Date(msg.timestamp), 'MMM d, h:mm a')}</span>
                                      <span className="ml-auto text-[10px] uppercase tracking-widest text-white/30 font-bold">
                                          {msg.recipientId ? 'Direct Message' : 'Global Feed'}
                                      </span>
                                  </div>
                                  <div className="text-sm text-white/80 line-clamp-3 prose prose-invert max-w-none break-words">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {msg.content}
                                      </ReactMarkdown>
                                  </div>
                              </div>
                          ))
                      ) : searchQuery && (
                          <div className="flex flex-col items-center justify-center h-40 text-white/40">
                              <Search size={32} className="mb-2 opacity-50" />
                              <p>No results found for "{searchQuery}"</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
      
      {guestInviteModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
                  <button 
                      onClick={() => setGuestInviteModal(null)}
                      className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                  >
                      <X size={20} />
                  </button>
                  
                  <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                      <Users size={24} className="text-indigo-400" />
                      Guest Invite Link
                  </h2>
                  
                  <div className="flex flex-col items-center justify-center mb-6 p-4 bg-white rounded-xl">
                      <QRCodeSVG 
                          value={guestInviteModal.text} 
                          size={200}
                          bgColor={"#ffffff"}
                          fgColor={"#000000"}
                          level={"L"}
                      />
                      <p className="mt-3 text-xs text-black/60 font-medium uppercase tracking-widest">Scan to join JellyChat</p>
                  </div>
                  
                  <div className="mb-4">
                      <p className="text-sm text-white/60 mb-2">Or copy the invite instructions manually:</p>
                      <textarea
                          readOnly
                          value={guestInviteModal.text}
                          className="w-full h-32 bg-black border border-white/10 rounded-xl p-3 text-sm text-white/80 font-mono resize-none focus:outline-none focus:border-indigo-500/50"
                          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                      />
                  </div>
                  
                  <button 
                      onClick={() => {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                              navigator.clipboard.writeText(guestInviteModal.text).then(() => {
                                  alert("Copied to clipboard!");
                              }).catch(() => {
                                  alert("Please select the text above and copy it manually.");
                              });
                          } else {
                              alert("Please select the text above and copy it manually.");
                          }
                      }}
                      className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                      <Copy size={18} />
                      Copy Invite Text
                  </button>
              </div>
          </div>
      )}
      {/* Add Preserve Modal */}
      {showAddPreserveModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#18181b] w-full max-w-md rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                        <Plus size={18} className="text-emerald-400" />
                        Add Preserve
                    </h3>
                    <button onClick={() => setShowAddPreserveModal(false)} className="p-1 hover:bg-white/10 rounded-lg text-white/50 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    <p className="text-sm text-white/60 mb-6">
                        Paste an Invite Code to join an existing preserve, or manually enter the details of a JellyChat node on your Tailnet.
                    </p>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">Invite Code (Optional)</label>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    placeholder="JellyInvite-..." 
                                    value={inviteCodeInput}
                                    onChange={(e) => {
                                        setInviteCodeInput(e.target.value);
                                        try {
                                            if (e.target.value.startsWith('JellyInvite-')) {
                                                const decoded = JSON.parse(atob(e.target.value.replace('JellyInvite-', '')));
                                                if (decoded.name && decoded.url) {
                                                    setPreserves(prev => [...prev, { id: 'p_' + Date.now(), name: decoded.name, url: decoded.url }]);
                                                    setShowAddPreserveModal(false);
                                                    setInviteCodeInput('');
                                                }
                                            }
                                        } catch (err) {}
                                    }}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const text = await navigator.clipboard.readText();
                                            if (text.startsWith('JellyInvite-')) {
                                                setInviteCodeInput(text);
                                                const decoded = JSON.parse(atob(text.replace('JellyInvite-', '')));
                                                if (decoded.name && decoded.url) {
                                                    setPreserves(prev => [...prev, { id: 'p_' + Date.now(), name: decoded.name, url: decoded.url }]);
                                                    setShowAddPreserveModal(false);
                                                    setInviteCodeInput('');
                                                }
                                            }
                                        } catch(e) {
                                            alert("Could not read clipboard. Please paste manually.");
                                        }
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-lg text-white/50 transition-colors"
                                    title="Paste from clipboard"
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4 my-2">
                            <div className="h-px bg-white/10 flex-1"></div>
                            <span className="text-xs text-white/40 font-bold uppercase tracking-widest">OR</span>
                            <div className="h-px bg-white/10 flex-1"></div>
                        </div>

                        <form onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            const name = formData.get('name') as string;
                            const url = formData.get('url') as string;
                            if (name && url) {
                                setPreserves(prev => [...prev, { id: 'p_' + Date.now(), name, url }]);
                                setShowAddPreserveModal(false);
                            }
                        }} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">Preserve Name</label>
                                <input name="name" required type="text" placeholder="e.g. Alice's Server" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">Preserve URL</label>
                                <input name="url" required type="url" placeholder="e.g. http://alice-node.ts.net:4000" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                            </div>
                            <button type="submit" className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-white font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-transform hover:-translate-y-0.5">
                                <Plus size={18} />
                                Add Preserve Manually
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
      )}
      {/* Collaborative Workspace */}
      {showWorkspace && socket && (
          <CollaborativeWorkspace
              socket={socket}
              onClose={() => setShowWorkspace(false)}
              roomId={activeChat !== null ? `dm_${[me?.ip || '', activeChat].sort().join('_')}` : `channel_${activeChannel}`}
          />
      )}
      
      {showUserSettings && (
          <UserSettingsModal 
              onClose={() => setShowUserSettings(false)}
              peers={peers}
              profiles={profiles}
              assignments={assignments}
              onProfilesUpdated={() => {
                  fetch('/api/profiles').then(r => r.json()).then(setProfiles);
                  fetch('/api/assignments').then(r => r.json()).then(setAssignments);
              }}
          />
      )}

      {showChannelSettingsModal && (
          <ChannelSettingsModal
              channel={editingChannel}
              onClose={() => {
                  setShowChannelSettingsModal(false);
                  setEditingChannel(null);
              }}
              onSave={(id, name, description, type) => {
                  if (editingChannel) {
                      fetch(`/api/channels/${editingChannel.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name, description, type })
                      }).then(r => r.json()).then(setChannels).catch(console.error);
                  } else {
                      fetch('/api/channels', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id, name, description, type })
                      }).then(r => r.json()).then(setChannels).catch(console.error);
                  }
                  setShowChannelSettingsModal(false);
                  setEditingChannel(null);
              }}
              onDelete={(id) => {
                  fetch(`/api/channels/${id}`, { method: 'DELETE' })
                      .then(r => r.json())
                      .then(setChannels)
                      .catch(console.error);
                  if (activeChannel === id) changeChannel('general');
                  if (activeVoiceChannel === id) setActiveVoiceChannel(null);
                  setShowChannelSettingsModal(false);
                  setEditingChannel(null);
              }}
          />
      )}

      {activeVoiceChannel && (
          <VoiceChannelManager
              socket={socket}
              channelId={activeVoiceChannel}
              channelName={channels.find(c => c.id === activeVoiceChannel)?.name || activeVoiceChannel}
              profiles={profiles}
              onDisconnect={() => setActiveVoiceChannel(null)}
          />
      )}
      {showAdminManagement && (
          <AdminManagementModal
              onClose={() => setShowAdminManagement(false)}
          />
      )}
      {showGlobalSettings && (
          <GlobalSettingsModal
              onClose={() => setShowGlobalSettings(false)}
              notificationsEnabled={notificationsEnabled}
              setNotificationsEnabled={setNotificationsEnabled}
              themeAccent={themeAccent}
              setThemeAccent={setThemeAccent}
              myProfile={
                  me ? (assignments.find(a => a.ip === me.ip) 
                      ? profiles.find(p => p.id === assignments.find(a => a.ip === me.ip)?.profileId) 
                      : null) : null
              }
              onProfileUpdated={(updatedProfile) => {
                  fetchProfiles();
              }}
          />
      )}

    </div>
  );
}

export default App;
