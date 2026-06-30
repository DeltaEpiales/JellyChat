import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Phone } from 'lucide-react';

export interface CallState {
    status: 'incoming' | 'outgoing' | 'connected';
    peerId: string;
    peerName: string;
    isVideo: boolean;
    isScreenShare?: boolean;
    offer?: any;
    initialStream?: MediaStream | null;
}

interface Props {
    callState: CallState;
    setCallState: React.Dispatch<React.SetStateAction<CallState | null>>;
    socket: Socket;
}

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
    ]
};

export function VideoCallModal({ callState, setCallState, socket }: Props) {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(!callState.isVideo);
    const [callStatusText, setCallStatusText] = useState(
        callState.status === 'incoming' 
            ? (callState.isScreenShare ? 'Incoming screen share...' : 'Incoming call...') 
            : (callState.isScreenShare ? 'Starting screen share...' : 'Calling...')
    );

    useEffect(() => {
        if (callState.status === 'incoming') {
            try {
                if (!audioCtxRef.current) {
                    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                }
                const ctx = audioCtxRef.current;
                
                const playRing = () => {
                    if (ctx.state === 'suspended') ctx.resume();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, ctx.currentTime);
                    osc.frequency.setValueAtTime(480, ctx.currentTime + 0.1);
                    gain.gain.setValueAtTime(0, ctx.currentTime);
                    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
                    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 1.5);
                };
                
                playRing();
                ringTimerRef.current = setInterval(playRing, 2000);
                
            } catch (e) {
                console.error("Auto-play prevented", e);
            }
        }

        // Setup socket listeners for signaling during the call
        const handleAnswer = async ({ answer }: any) => {
            if (peerConnectionRef.current) {
                try {
                    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
                    setCallStatusText('Connected');
                } catch (e) {
                    console.error('Error setting remote description', e);
                }
            }
        };

        const handleIceCandidate = async ({ candidate }: any) => {
            if (peerConnectionRef.current) {
                try {
                    await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate', e);
                }
            }
        };

        const handleEndCall = () => {
            cleanup();
        };

        const handleReject = () => {
            setCallStatusText('Call declined');
            setTimeout(cleanup, 2000);
        };

        socket.on('call_answer', handleAnswer);
        socket.on('ice_candidate', handleIceCandidate);
        socket.on('end_call', handleEndCall);
        socket.on('reject_call', handleReject);

        if (callState.status === 'outgoing') {
            startOutgoingCall();
        }

        return () => {
            socket.off('call_answer', handleAnswer);
            socket.off('ice_candidate', handleIceCandidate);
            socket.off('end_call', handleEndCall);
            socket.off('reject_call', handleReject);
        };
    }, []);

    const stopRingtone = () => {
        if (ringTimerRef.current) {
            clearInterval(ringTimerRef.current);
            ringTimerRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
        }
    };

    const cleanup = () => {
        stopRingtone();
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
        }
        setCallState(null);
    };

    const setupPeerConnection = () => {
        const pc = new RTCPeerConnection(configuration);
        peerConnectionRef.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    toId: callState.peerId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            if (remoteVideoRef.current && event.streams[0]) {
                remoteVideoRef.current.srcObject = event.streams[0];
                setCallStatusText('Connected');
                setCallState(prev => prev ? { ...prev, status: 'connected' } : null);
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                if (localStreamRef.current) {
                    pc.addTrack(track, localStreamRef.current);
                }
            });
        }

        return pc;
    };

    const startOutgoingCall = async () => {
        try {
            const stream = callState.initialStream || await navigator.mediaDevices.getUserMedia({ 
                video: callState.isVideo, 
                audio: true 
            });
            localStreamRef.current = stream;
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            const pc = setupPeerConnection();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit('call_offer', {
                recipientId: callState.peerId,
                offer,
                isVideo: callState.isVideo,
                isScreenShare: callState.isScreenShare
            });
        } catch (e) {
            console.error('Error starting call', e);
            setCallStatusText('Failed to access camera/mic');
            setTimeout(cleanup, 2000);
        }
    };

    const acceptCall = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: callState.isVideo, 
                audio: true 
            });
            localStreamRef.current = stream;
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            const pc = setupPeerConnection();
            
            stopRingtone(); // Stop ringing when accepting

            if (callState.offer) {
                await pc.setRemoteDescription(new RTCSessionDescription(callState.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                socket.emit('call_answer', {
                    callerId: callState.peerId,
                    answer
                });
                
                setCallState(prev => prev ? { ...prev, status: 'connected' } : null);
                setCallStatusText('Connected');
            }
        } catch (e) {
            console.error('Error accepting call', e);
            setCallStatusText('Failed to access camera/mic');
            setTimeout(cleanup, 2000);
        }
    };

    const rejectCall = () => {
        socket.emit('reject_call', { callerId: callState.peerId });
        cleanup();
    };

    const endCall = () => {
        socket.emit('end_call', { toId: callState.peerId });
        cleanup();
    };

    const toggleMute = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(!localStreamRef.current.getAudioTracks()[0]?.enabled);
        }
    };

    const toggleVideo = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsVideoOff(!localStreamRef.current.getVideoTracks()[0]?.enabled);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300">
            
            {/* Header */}
            <div className="absolute top-12 flex flex-col items-center gap-2">
                <div className="w-20 h-20 rounded-full jelly-gradient flex items-center justify-center text-3xl font-bold text-white shadow-[0_0_30px_rgba(244,63,94,0.4)]">
                    {callState.peerName.charAt(0).toUpperCase()}
                </div>
                <h2 className="text-2xl font-bold text-white tracking-tight">{callState.peerName}</h2>
                <p className="text-white/60 text-sm tracking-widest uppercase font-medium">{callStatusText}</p>
            </div>

            {/* Audio/Video Streams */}
            <div className="relative w-full max-w-4xl px-4 mt-20 flex-1 max-h-[60vh] flex items-center justify-center">
                {/* Always render remote video for audio track playback */}
                <video 
                    ref={remoteVideoRef}
                    autoPlay 
                    playsInline 
                    className={`w-full h-full object-contain rounded-3xl bg-black/50 shadow-2xl transition-opacity duration-500 ${(callState.status === 'connected' && callState.isVideo) ? 'opacity-100' : 'opacity-0 absolute pointer-events-none w-1 h-1'}`}
                />
                
                {callState.isVideo && (
                    <div className={`absolute bottom-6 right-8 w-32 h-48 md:w-48 md:h-64 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 bg-black/80 ${callState.status === 'connected' ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500 ${callState.isScreenShare ? 'w-auto h-auto max-w-sm max-h-48' : ''}`}>
                        <video 
                            ref={localVideoRef}
                            autoPlay 
                            playsInline 
                            muted
                            className={`w-full h-full ${callState.isScreenShare ? 'object-contain' : 'object-cover'}`}
                        />
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="absolute bottom-12 flex items-center gap-6">
                {callState.status === 'incoming' ? (
                    <>
                        <button 
                            onClick={rejectCall}
                            className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center text-white shadow-lg transition-transform hover:scale-110"
                        >
                            <PhoneOff size={28} />
                        </button>
                        <button 
                            onClick={acceptCall}
                            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 transition-transform hover:scale-110 animate-bounce"
                        >
                            {callState.isVideo ? <Video size={28} /> : <Phone size={28} />}
                        </button>
                    </>
                ) : (
                    <>
                        <button 
                            onClick={toggleMute}
                            className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md border ${isMuted ? 'bg-white/20 border-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                        >
                            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                        </button>
                        {callState.isVideo && (
                            <button 
                                onClick={toggleVideo}
                                className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md border ${isVideoOff ? 'bg-white/20 border-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                            >
                                {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                            </button>
                        )}
                        <button 
                            onClick={endCall}
                            className="w-16 h-16 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center text-white shadow-lg shadow-rose-500/20 transition-transform hover:scale-110 ml-4"
                        >
                            <PhoneOff size={28} />
                        </button>
                    </>
                )}
            </div>
            
        </div>
    );
}
