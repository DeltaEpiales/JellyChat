import React, { useState, useRef, useEffect } from 'react';
import { Download, X, Check, Loader2, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface P2PFileReceiverProps {
    socket: Socket | null;
    offer: any;
    onClose: () => void;
}

export const P2PFileReceiver: React.FC<P2PFileReceiverProps> = ({ socket, offer, onClose }) => {
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<'confirm' | 'connecting' | 'transferring' | 'complete' | 'error'>('confirm');
    const [errorMsg, setErrorMsg] = useState('');
    
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    const receiveBuffer = useRef<ArrayBuffer[]>([]);
    const receivedSize = useRef(0);
    
    useEffect(() => {
        if (!socket) return;
        
        socket.on('file_ice', (data) => {
            if (peerConnection.current && data.senderId === offer.senderId) {
                peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
                    console.error('Error adding ICE candidate:', e);
                });
            }
        });
        
        // Sender tells us progress if they want to
        socket.on('file_progress', (data) => {
            if (data.senderId === offer.senderId) {
                setProgress(data.progress);
            }
        });
        
        return () => {
            socket.off('file_ice');
            socket.off('file_progress');
            if (peerConnection.current) peerConnection.current.close();
        };
    }, [socket, offer]);

    const acceptTransfer = async () => {
        if (!socket || !offer) return;
        
        setStatus('connecting');
        
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peerConnection.current = pc;
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('file_ice', {
                    recipientId: offer.senderId,
                    candidate: event.candidate
                });
            }
        };
        
        pc.ondatachannel = (event) => {
            const dc = event.channel;
            dataChannel.current = dc;
            
            dc.onopen = () => {
                setStatus('transferring');
            };
            
            dc.onmessage = (e) => {
                if (status !== 'transferring') setStatus('transferring');
                
                receiveBuffer.current.push(e.data);
                receivedSize.current += e.data.byteLength;
                
                // We track progress locally too, just in case sender doesn't emit file_progress
                if (offer.fileSize) {
                    const pct = Math.round((receivedSize.current / offer.fileSize) * 100);
                    if (pct > progress) setProgress(pct);
                }
                
                if (receivedSize.current === offer.fileSize) {
                    finishTransfer();
                }
            };
            
            dc.onclose = () => {
                if (receivedSize.current < offer.fileSize) {
                    setStatus('error');
                    setErrorMsg('Connection closed prematurely');
                }
            };
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            socket.emit('file_answer', {
                recipientId: offer.senderId,
                answer: answer
            });
        } catch (e) {
            console.error('Error accepting offer:', e);
            setStatus('error');
            setErrorMsg('Failed to connect to sender');
        }
    };
    
    const finishTransfer = () => {
        setStatus('complete');
        
        const blob = new Blob(receiveBuffer.current, { type: offer.fileType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = offer.fileName;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            onClose();
        }, 3000);
    };

    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-emerald-500/20 rounded-2xl w-full max-w-md p-6 shadow-[0_0_50px_rgba(16,185,129,0.1)] animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Zap className="text-emerald-400" size={24} /> Incoming File
                    </h3>
                    {status === 'confirm' && (
                        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                            <X size={20} />
                        </button>
                    )}
                </div>
                
                {status === 'confirm' && (
                    <div className="space-y-4">
                        <p className="text-sm text-white/70">
                            <strong className="text-white">{offer.senderName}</strong> wants to send you a file directly.
                        </p>
                        
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                            <div className="truncate pr-4">
                                <p className="text-white font-medium truncate">{offer.fileName}</p>
                                <p className="text-white/50 text-xs">{(offer.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                                <Download size={20} />
                            </div>
                        </div>
                        
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors font-medium">
                                Decline
                            </button>
                            <button 
                                onClick={acceptTransfer}
                                className="px-6 py-2 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-400 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] flex items-center gap-2"
                            >
                                <Check size={18} /> Accept
                            </button>
                        </div>
                    </div>
                )}
                
                {status === 'connecting' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="animate-spin text-emerald-400 mb-4" size={40} />
                        <p className="text-white font-medium">Connecting to peer...</p>
                    </div>
                )}
                
                {status === 'transferring' && (
                    <div className="space-y-4 py-4">
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-white/80 font-medium truncate pr-4">Downloading {offer.fileName}...</span>
                            <span className="text-emerald-400 font-bold">{progress}%</span>
                        </div>
                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)] transition-all duration-300" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-center text-xs text-white/50 animate-pulse">Keep this window open</p>
                    </div>
                )}
                
                {status === 'complete' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                            <Check size={32} />
                        </div>
                        <p className="text-white font-bold text-lg mb-1">Download Complete!</p>
                        <p className="text-white/50 text-sm">File saved to your downloads folder.</p>
                    </div>
                )}
                
                {status === 'error' && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="w-16 h-16 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mb-4">
                            <X size={32} />
                        </div>
                        <p className="text-rose-400 font-bold text-lg">Download Failed</p>
                        <p className="text-white/60 text-sm mt-2">{errorMsg}</p>
                        <button onClick={onClose} className="mt-6 px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors">
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
