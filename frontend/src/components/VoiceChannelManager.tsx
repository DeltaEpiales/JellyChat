import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Volume2, Mic, ChevronDown, ChevronUp, MicOff, Headphones, PhoneOff, MonitorUp, Video, VideoOff, Keyboard, RotateCw } from 'lucide-react';

export interface VoiceUser {
    socketId: string;
    ip: string;
    name: string;
    profileId: string | null;
}

interface Props {
    socket: Socket | null;
    channelId: string | null;
    channelName: string;
    profiles: any[];
    onDisconnect: () => void;
}

export function VoiceChannelManager({ socket, channelId, channelName, profiles, onDisconnect }: Props) {
    const [connectedUsers, setConnectedUsers] = useState<VoiceUser[]>([]);
    const [isMuted, setIsMuted] = useState(false);
    const [isDeafened, setIsDeafened] = useState(false);
    const [isDocked, setIsDocked] = useState(false);
    const [pillRotation, setPillRotation] = useState(0);
    const pillRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, currentX: 0, currentY: 0, hasMoved: false });

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDocked || !pillRef.current) return;
        dragRef.current = {
            ...dragRef.current,
            isDragging: true,
            hasMoved: false,
            startX: e.clientX,
            startY: e.clientY,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current.isDragging || !pillRef.current) return;
        
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            dragRef.current.hasMoved = true;
        }
        
        dragRef.current.currentX += dx;
        dragRef.current.currentY += dy;
        
        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
        
        pillRef.current.style.transform = `translate(${dragRef.current.currentX}px, ${dragRef.current.currentY}px) rotate(${pillRotation}deg)`;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current.isDragging) return;
        dragRef.current.isDragging = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        
        // If they barely moved it, we treat it as a click to expand
        if (!dragRef.current.hasMoved) {
            setIsDocked(false);
        }
    };
    const [isStreaming, setIsStreaming] = useState(false);
    const [isWebcamOn, setIsWebcamOn] = useState(false);
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

    // Audio Visualizer & PTT State
    const [audioLevel, setAudioLevel] = useState(0);
    const [isPttEnabled, setIsPttEnabled] = useState(false);
    const [pttActive, setPttActive] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const handleStreamClick = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
        const videoEl = e.currentTarget.querySelector('video');
        if (videoEl) {
            if (videoEl.requestFullscreen) {
                videoEl.requestFullscreen().catch(() => setFocusedStreamId(focusedStreamId === id ? null : id));
            } else if ((videoEl as any).webkitEnterFullscreen) {
                (videoEl as any).webkitEnterFullscreen();
            } else {
                setFocusedStreamId(focusedStreamId === id ? null : id);
            }
        } else {
            setFocusedStreamId(focusedStreamId === id ? null : id);
        }
    };
    const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

    const localStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const webcamStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    useEffect(() => {
        if (!socket || !channelId) return;

        startLocalStream().then(() => {
            socket.emit('join_voice_channel', { channelId });
        });

        const handleUsersUpdated = ({ channelId: cid, users }: { channelId: string, users: VoiceUser[] }) => {
            if (cid === channelId) {
                setConnectedUsers(users);
                const currentSocketIds = users.map(u => u.socketId);
                for (const [peerSocketId, pc] of peerConnectionsRef.current.entries()) {
                    if (!currentSocketIds.includes(peerSocketId)) {
                        pc.close();
                        peerConnectionsRef.current.delete(peerSocketId);
                        const audio = audioElementsRef.current.get(peerSocketId);
                        if (audio) {
                            audio.pause();
                            audio.srcObject = null;
                            audioElementsRef.current.delete(peerSocketId);
                        }
                    }
                }

                users.forEach(async (user) => {
                    if (socket.id && user.socketId !== socket.id && !peerConnectionsRef.current.has(user.socketId)) {
                        if (socket.id > user.socketId) {
                            createPeerConnection(user.socketId);
                            // Initial offer will be created by onnegotiationneeded
                        }
                    }
                });
            }
        };

        const handleVoiceSignal = async (data: any) => {
            const { fromId, type, payload } = data;
            
            if (type === 'offer') {
                const pc = createPeerConnection(fromId);
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('voice_signal', {
                    toId: fromId,
                    type: 'answer',
                    payload: answer
                });
            } else if (type === 'answer') {
                const pc = peerConnectionsRef.current.get(fromId);
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                }
            } else if (type === 'ice_candidate') {
                const pc = peerConnectionsRef.current.get(fromId);
                if (pc) {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                }
            }
        };

        socket.on('voice_users_updated', handleUsersUpdated);
        socket.on('voice_signal', handleVoiceSignal);

        return () => {
            socket.off('voice_users_updated', handleUsersUpdated);
            socket.off('voice_signal', handleVoiceSignal);
            socket.emit('leave_voice_channel', { channelId });
            cleanup();
        };
    }, [socket, channelId]);

    const startLocalStream = async () => {
        try {
            if (!localStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStreamRef.current = stream;

                // Setup Audio Visualizer
                if (!audioContextRef.current) {
                    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                    if (AudioContextClass) {
                        audioContextRef.current = new AudioContextClass();
                        analyserRef.current = audioContextRef.current.createAnalyser();
                        analyserRef.current.fftSize = 256;
                        const source = audioContextRef.current.createMediaStreamSource(stream);
                        source.connect(analyserRef.current);

                        const updateVolume = () => {
                            if (analyserRef.current) {
                                const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                                analyserRef.current.getByteFrequencyData(dataArray);
                                let sum = 0;
                                for (let i = 0; i < dataArray.length; i++) {
                                    sum += dataArray[i];
                                }
                                const avg = sum / dataArray.length;
                                // Smooth out the audio level
                                setAudioLevel(prev => (prev * 0.7) + (avg * 0.3));
                            }
                            animationFrameRef.current = requestAnimationFrame(updateVolume);
                        };
                        updateVolume();
                    }
                }
            }
        } catch (e) {
            console.error("Failed to get local audio", e);
        }
    };

    const cleanup = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }
        if (webcamStreamRef.current) {
            webcamStreamRef.current.getTracks().forEach(t => t.stop());
            webcamStreamRef.current = null;
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        for (const pc of peerConnectionsRef.current.values()) {
            pc.close();
        }
        peerConnectionsRef.current.clear();
        
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
        
        for (const audio of audioElementsRef.current.values()) {
            audio.pause();
            audio.srcObject = null;
        }
        audioElementsRef.current.clear();
        setConnectedUsers([]);
        setIsStreaming(false);
        setIsWebcamOn(false);
    };

    const createPeerConnection = (targetSocketId: string) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        peerConnectionsRef.current.set(targetSocketId, pc);

        pc.onnegotiationneeded = async () => {
            try {
                if (pc.signalingState !== 'stable') return;
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (socket) {
                    socket.emit('voice_signal', {
                        toId: targetSocketId,
                        type: 'offer',
                        payload: pc.localDescription
                    });
                }
            } catch (e) {
                console.error('Error during negotiation:', e);
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate && socket) {
                socket.emit('voice_signal', {
                    toId: targetSocketId,
                    type: 'ice_candidate',
                    payload: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            if (event.streams[0]) {
                const stream = event.streams[0];
                
                if (event.track.kind === 'audio') {
                    let audio = audioElementsRef.current.get(targetSocketId);
                    if (!audio) {
                        audio = new Audio();
                        audio.autoplay = true;
                        audioElementsRef.current.set(targetSocketId, audio);
                    }
                    audio.srcObject = stream;
                }
                
                // Add stream to state to render in UI
                setRemoteStreams(prev => {
                    const newMap = new Map(prev);
                    newMap.set(targetSocketId, stream);
                    return newMap;
                });
                
                stream.onremovetrack = () => {
                    if (stream.getTracks().length === 0) {
                        setRemoteStreams(prev => {
                            const newMap = new Map(prev);
                            newMap.delete(targetSocketId);
                            return newMap;
                        });
                    } else {
                        // force update
                        setRemoteStreams(prev => new Map(prev));
                    }
                };
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                if (localStreamRef.current) pc.addTrack(track, localStreamRef.current);
            });
        }
        
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
                if (screenStreamRef.current) pc.addTrack(track, screenStreamRef.current);
            });
        }

        if (webcamStreamRef.current) {
            webcamStreamRef.current.getTracks().forEach(track => {
                if (webcamStreamRef.current) pc.addTrack(track, webcamStreamRef.current);
            });
        }

        return pc;
    };

    const toggleMute = () => {
        setIsMuted(!isMuted);
    };

    const togglePtt = () => {
        setIsPttEnabled(!isPttEnabled);
    };

    // Track state controller (Mute/PTT)
    useEffect(() => {
        if (localStreamRef.current) {
            const shouldBeEnabled = !isMuted && (!isPttEnabled || pttActive);
            localStreamRef.current.getAudioTracks().forEach(t => {
                t.enabled = shouldBeEnabled;
            });
        }
    }, [isMuted, isPttEnabled, pttActive, localStreamRef.current]);

    // Global Key Listener for PTT (V key)
    useEffect(() => {
        if (!isPttEnabled) return;
        
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'v' && !e.repeat) {
                setPttActive(true);
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'v') {
                setPttActive(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isPttEnabled]);

    const toggleDeafen = () => {
        setIsDeafened(!isDeafened);
        for (const audio of audioElementsRef.current.values()) {
            audio.muted = !isDeafened;
        }
    };

    const startScreenShare = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            screenStreamRef.current = stream;
            
            for (const pc of peerConnectionsRef.current.values()) {
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
            }
            
            setIsStreaming(true);
            
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
        } catch (e) {
            console.error("Screen share failed", e);
        }
    };

    const toggleScreenShare = () => {
        if (isStreaming) {
            stopScreenShare();
        } else {
            startScreenShare();
        }
    };

    const startWebcamShare = async (mode = facingMode) => {
        try {
            if (webcamStreamRef.current) {
                stopWebcamShare(); // Stop previous stream when flipping
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
            webcamStreamRef.current = stream;
            
            for (const pc of peerConnectionsRef.current.values()) {
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
                
                // Negotiate again if needed, but adding a track might not automatically trigger onnegotiationneeded 
                // in all browsers if we removed one previously. However, for a simple toggle, this works.
                // We will emit renegotiate just in case:
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (socket) {
                    socket.emit('voice_signal', {
                        toId: Array.from(peerConnectionsRef.current.entries()).find(entry => entry[1] === pc)?.[0],
                        type: 'offer',
                        payload: pc.localDescription
                    });
                }
            }
            
            setIsWebcamOn(true);
            setFacingMode(mode);
        } catch (e) {
            console.error("Webcam share failed", e);
        }
    };

    const stopWebcamShare = () => {
        if (webcamStreamRef.current) {
            webcamStreamRef.current.getTracks().forEach(track => {
                track.stop();
                for (const pc of peerConnectionsRef.current.values()) {
                    const sender = pc.getSenders().find(s => s.track === track);
                    if (sender) pc.removeTrack(sender);
                }
            });
            webcamStreamRef.current = null;
        }
        setIsWebcamOn(false);
    };

    const toggleWebcam = () => {
        if (isWebcamOn) {
            stopWebcamShare();
        } else {
            startWebcamShare(facingMode);
        }
    };

    const flipCamera = () => {
        const newMode = facingMode === 'user' ? 'environment' : 'user';
        startWebcamShare(newMode);
    };

    const stopScreenShare = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            
            // Remove tracks from peer connections
            for (const pc of peerConnectionsRef.current.values()) {
                const senders = pc.getSenders();
                screenStreamRef.current.getTracks().forEach(track => {
                    const sender = senders.find(s => s.track === track);
                    if (sender) pc.removeTrack(sender);
                });
            }
            screenStreamRef.current = null;
        }
        setIsStreaming(false);
    };

    if (!channelId) return null;

    return (
        <>
            {!isDocked ? (
                <div key="expanded" className="absolute bottom-24 left-1/2 -translate-x-1/2 w-11/12 max-w-xs md:max-w-sm p-4 glass-card rounded-[2rem] border border-white/10 animate-in slide-in-from-bottom-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)] z-[150] backdrop-blur-3xl bg-[#0a0a0c]/90 flex flex-col gap-4 transition-all duration-300">
                    <div className="flex flex-col items-center gap-3 w-full">
                        <div className="flex items-center w-full justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="relative w-10 h-10 shrink-0 rounded-full bg-theme/20 flex items-center justify-center text-theme-text-alt shadow-[0_0_15px_var(--color-theme)]">
                                    <Volume2 size={18} className="animate-pulse" />
                                    <div className="absolute inset-0 rounded-full border border-theme-text-alt animate-ping opacity-50"></div>
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-theme-text-alt font-bold text-sm tracking-wide">Connected</span>
                                    <span className="text-white/60 text-xs truncate max-w-[150px] font-medium">{channelName}</span>
                                </div>
                            </div>
                            <button onPointerDown={(e) => { e.stopPropagation(); setIsDocked(true); }} className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white shrink-0" title="Dock">
                                <ChevronDown size={18} />
                            </button>
                        </div>
                    </div>
                <div className="grid grid-cols-3 gap-2 bg-white/5 p-2 rounded-2xl border border-white/10 w-full shrink-0">
                    <button onClick={toggleMute} className={`p-2.5 md:p-3 rounded-full transition-all ${isMuted ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'bg-white/10 text-white hover:bg-white/20'}`} title="Mute Microphone">
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    <button onClick={togglePtt} className={`p-2.5 md:p-3 rounded-full transition-all ${isPttEnabled ? 'bg-theme-alt/20 text-theme-text-alt hover:bg-theme-alt/30' : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white'}`} title="Push-to-Talk (Hold 'V')">
                        <Keyboard size={16} />
                    </button>
                    <button onClick={toggleDeafen} className={`p-2.5 md:p-3 rounded-full transition-all ${isDeafened ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'bg-white/10 text-white hover:bg-white/20'}`} title="Deafen">
                        <Headphones size={16} className={isDeafened ? 'opacity-50' : ''} />
                    </button>
                    <button 
                        onClick={toggleScreenShare}
                        className={`p-2.5 md:p-3 rounded-full transition-colors ${isStreaming ? 'bg-theme hover:bg-theme/80 text-white' : 'bg-white/5 hover:bg-white/10 text-white/70'}`}
                    >
                        <MonitorUp size={20} />
                    </button>
                    <button 
                        onClick={toggleWebcam}
                        className={`p-2.5 md:p-3 rounded-full transition-colors ${isWebcamOn ? 'bg-theme hover:bg-theme/80 text-white' : 'bg-white/5 hover:bg-white/10 text-white/70'}`}
                        title="Toggle Webcam"
                    >
                        {isWebcamOn ? <Video size={20} /> : <VideoOff size={20} />}
                    </button>
                    {isWebcamOn && (
                        <button 
                            onClick={flipCamera}
                            className="p-2.5 md:p-3 rounded-full transition-colors bg-white/5 hover:bg-white/10 text-white/70 md:hidden"
                            title="Flip Camera"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        </button>
                    )}
                    <button onClick={onDisconnect} className="p-2.5 md:p-3 rounded-full bg-rose-500 hover:bg-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.5)] text-white ml-auto md:ml-1 shrink-0" title="Disconnect">
                        <PhoneOff size={16} />
                    </button>
                </div>
            
            {(remoteStreams.size > 0 && Array.from(remoteStreams.values()).some(stream => stream.getVideoTracks().length > 0) || isStreaming || isWebcamOn) && (
                <div className="flex gap-2 overflow-x-auto px-2 pb-1 custom-scrollbar w-full">
                    {Array.from(remoteStreams.entries()).map(([socketId, stream]) => {
                        const user = connectedUsers.find(u => u.socketId === socketId);
                        const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
                        
                        if (stream.getVideoTracks().length === 0) return null;
                        
                        return (
                            <div 
                                key={socketId} 
                                onClick={(e) => handleStreamClick(e, socketId)}
                                className={`relative overflow-hidden shrink-0 bg-black cursor-pointer transition-all
                                    ${focusedStreamId === socketId 
                                        ? 'fixed inset-0 z-[100] shadow-2xl rounded-none border-none' 
                                        : 'w-64 h-36 rounded-lg border border-white/10'
                                    }
                                    ${focusedStreamId && focusedStreamId !== socketId ? 'hidden' : ''}
                                `}
                            >
                                <video 
                                    autoPlay 
                                    playsInline 
                                    className="w-full h-full object-contain"
                                    ref={el => {
                                        if (el && el.srcObject !== stream) {
                                            el.srcObject = stream;
                                        }
                                    }}
                                />
                                {focusedStreamId === socketId && (
                                    <button 
                                        className="absolute top-4 right-4 bg-black/60 hover:bg-red-500 text-white p-2 rounded-full backdrop-blur transition-all"
                                        onClick={(e) => { e.stopPropagation(); setFocusedStreamId(null); }}
                                    >
                                        ✕
                                    </button>
                                )}
                                <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-[10px] px-2 py-1 rounded-md font-medium">
                                    {profile ? profile.name : user?.name || 'Unknown'} is streaming
                                </div>
                            </div>
                        );
                    })}
                    
                    {/* Local Previews */}
                    {isStreaming && screenStreamRef.current && (
                        <div 
                            onClick={(e) => handleStreamClick(e, 'local_screen')}
                            className={`relative overflow-hidden shrink-0 bg-black cursor-pointer transition-all
                                ${focusedStreamId === 'local_screen' 
                                    ? 'fixed inset-0 z-[100] shadow-2xl rounded-none border-none' 
                                    : 'w-64 h-36 rounded-lg border border-theme-alt/50'
                                }
                                ${focusedStreamId && focusedStreamId !== 'local_screen' ? 'hidden' : ''}
                            `}
                        >
                            <video 
                                autoPlay 
                                playsInline 
                                muted
                                className="w-full h-full object-contain"
                                ref={el => {
                                    if (el && el.srcObject !== screenStreamRef.current) {
                                        el.srcObject = screenStreamRef.current;
                                    }
                                }}
                            />
                            {focusedStreamId === 'local_screen' && (
                                <button 
                                    className="absolute top-4 right-4 bg-black/60 hover:bg-red-500 text-white p-2 rounded-full backdrop-blur transition-all"
                                    onClick={(e) => { e.stopPropagation(); setFocusedStreamId(null); }}
                                >
                                    ✕
                                </button>
                            )}
                            <div className="absolute bottom-2 left-2 bg-theme-alt/80 backdrop-blur text-white text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                                You (Screen)
                            </div>
                        </div>
                    )}
                    
                    {isWebcamOn && webcamStreamRef.current && (
                        <div 
                            onClick={(e) => handleStreamClick(e, 'local_webcam')}
                            className={`relative overflow-hidden shrink-0 bg-black cursor-pointer transition-all
                                ${focusedStreamId === 'local_webcam' 
                                    ? 'fixed inset-0 z-[100] shadow-2xl rounded-none border-none' 
                                    : 'w-64 h-36 rounded-lg border border-theme/50'
                                }
                                ${focusedStreamId && focusedStreamId !== 'local_webcam' ? 'hidden' : ''}
                            `}
                        >
                            <video 
                                autoPlay 
                                playsInline 
                                muted
                                className={`w-full h-full object-contain ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
                                ref={el => {
                                    if (el && el.srcObject !== webcamStreamRef.current) {
                                        el.srcObject = webcamStreamRef.current;
                                    }
                                }}
                            />
                            {focusedStreamId === 'local_webcam' && (
                                <button 
                                    className="absolute top-4 right-4 bg-black/60 hover:bg-red-500 text-white p-2 rounded-full backdrop-blur transition-all"
                                    onClick={(e) => { e.stopPropagation(); setFocusedStreamId(null); }}
                                >
                                    ✕
                                </button>
                            )}
                            <div className="absolute bottom-2 left-2 bg-theme/80 backdrop-blur text-white text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1">
                                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                                You (Camera)
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            <div className="mt-3 flex flex-wrap gap-2">
                {connectedUsers.map(u => {
                    const profile = profiles.find(p => p.id === u.profileId);
                    const isLocalUser = socket?.id === u.socketId;
                    
                    // Render visualizer glow if local user is talking (or active PTT)
                    const isTalking = isLocalUser && (!isMuted && (!isPttEnabled || pttActive)) && audioLevel > 5;
                    const glowStyle = isTalking 
                        ? { boxShadow: `0 0 ${audioLevel/3}px ${audioLevel/8}px rgba(52, 211, 153, 0.6)`, borderColor: 'rgba(52, 211, 153, 0.8)' } 
                        : {};

                    return (
                        <div key={u.socketId} className="flex items-center gap-2 bg-white/5 pr-3 pl-1 py-1 rounded-full border border-white/5 transition-all">
                            <div 
                                className={`w-6 h-6 shrink-0 rounded-full bg-theme/20 text-theme-text/80 flex items-center justify-center text-[10px] font-bold overflow-hidden transition-all duration-75`} 
                                title={profile ? profile.name : u.name}
                                style={{ ...glowStyle, borderWidth: isTalking ? '2px' : '0px' }}
                            >
                                {profile && profile.avatar ? (
                                    <img src={profile.avatar} alt="avatar" className="w-full h-full object-cover rounded-full" />
                                ) : (
                                    (profile ? profile.name : u.name).charAt(0).toUpperCase()
                                )}
                            </div>
                            <span className="text-xs text-white/80 font-medium truncate max-w-[80px]">{profile ? profile.name : u.name}</span>
                        </div>
                    );
                })}
                                </div>
                </div>
            ) : (
                <div 
                    key="pill"
                    ref={pillRef}
                    className="fixed bottom-6 right-6 p-2 glass-pill rounded-full border border-white/10 shadow-2xl z-[150] backdrop-blur-3xl bg-[#0a0a0c]/90 flex flex-col items-center gap-3 transition-colors duration-300 cursor-grab active:cursor-grabbing hover:bg-black group shrink-0" 
                    style={{ touchAction: 'none', width: 'max-content', height: 'max-content', flexShrink: 0, transform: `translate(${dragRef.current.currentX}px, ${dragRef.current.currentY}px) rotate(${pillRotation}deg)` }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    
                    {/* Rotate Button */}
                    <div 
                        className="w-6 h-6 mt-1 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white cursor-pointer hover:bg-white/20 transition-all shadow-[0_0_10px_rgba(255,255,255,0.1)] active:scale-95"
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            setPillRotation(prev => (prev + 90) % 360);
                        }}
                        style={{ transform: `rotate(${-pillRotation}deg)` }}
                        title="Rotate Pill"
                    >
                        <RotateCw size={12} />
                    </div>

                    {/* Tiny User Stack */}
                    <div className="flex flex-col items-center -space-y-2">
                        {connectedUsers.slice(0, 3).map((u, i) => {
                            const profile = u.profileId ? profiles.find(p => p.id === u.profileId) : null;
                            const isLocalUser = socket?.id === u.socketId;
                              const isTalking = isLocalUser && (!isMuted && (!isPttEnabled || pttActive)) && audioLevel > 5;
                            const glowStyle = isTalking 
                                ? { boxShadow: `0 0 8px 2px rgba(52, 211, 153, 0.6)`, borderColor: 'rgba(52, 211, 153, 0.8)' } 
                                : {};
                            
                            return (
                                <div 
                                    key={u.socketId}
                                    className="w-8 h-8 rounded-full bg-theme/20 border-2 border-[#0a0a0c] flex items-center justify-center text-xs font-bold overflow-hidden transition-all z-10"
                                    style={{ ...glowStyle, zIndex: 10 - i, transform: `rotate(${-pillRotation}deg)` }}
                                >
                                    {profile && profile.avatar ? (
                                        <img src={profile.avatar} className="w-full h-full object-cover" />
                                    ) : (
                                        (profile ? profile.name : u.name).charAt(0).toUpperCase()
                                    )}
                                </div>
                            );
                        })}
                        {connectedUsers.length > 3 && (
                            <div className="w-8 h-8 rounded-full bg-white/10 border-2 border-[#0a0a0c] flex items-center justify-center text-[10px] text-white/70 font-bold z-0" style={{ transform: `rotate(${-pillRotation}deg)` }}>
                                +{connectedUsers.length - 3}
                            </div>
                        )}
                    </div>

                    <div className="w-6 h-px bg-white/10 my-1 mx-0"></div>
                    
                    {/* Quick Mute Toggle */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                        className={`p-2 rounded-full transition-all ${isMuted ? 'bg-rose-500 text-white' : 'hover:bg-white/10 text-white/70 hover:text-white'}`}
                        style={{ transform: `rotate(${-pillRotation}deg)` }}
                    >
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    
                    {/* Undock Button */}
                    <button 
                        className="p-2 rounded-full bg-white/5 text-white/50 group-hover:bg-theme/20 group-hover:text-theme-text-alt transition-all"
                        style={{ transform: `rotate(${-pillRotation}deg)` }}
                    >
                        <ChevronUp size={16} />
                    </button>

                    <div 
                        className="w-8 h-8 rounded-full bg-rose-500/80 flex items-center justify-center text-white cursor-pointer hover:bg-rose-500 transition-all shadow-[0_0_15px_rgba(244,63,94,0.4)] mb-1" 
                        onPointerDown={(e) => { e.stopPropagation(); onDisconnect(); }} 
                        style={{ transform: `rotate(${-pillRotation}deg)` }}
                        title="Disconnect"
                    >
                        <PhoneOff size={14} />
                    </div>
                </div>
            )}
        </>
    );
}


