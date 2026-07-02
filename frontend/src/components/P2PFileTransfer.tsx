import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Check, Loader2, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface P2PFileTransferProps {
    socket: Socket | null;
    activeChat: string | null;
    onClose: () => void;
}

export const P2PFileTransfer: React.FC<P2PFileTransferProps> = ({ socket, activeChat, onClose }) => {
    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<'idle' | 'offering' | 'transferring' | 'complete' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const dataChannel = useRef<RTCDataChannel | null>(null);
    const fileReader = useRef<FileReader>(new FileReader());
    
    useEffect(() => {
        if (!socket) return;
        
        socket.on('file_answer', async (data) => {
            if (peerConnection.current && status === 'offering') {
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
                    setStatus('transferring');
                } catch (e) {
                    console.error('Error setting remote description for answer:', e);
                    setStatus('error');
                    setErrorMsg('Failed to connect to peer');
                }
            }
        });
        
        socket.on('file_ice', (data) => {
            if (peerConnection.current) {
                peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
                    console.error('Error adding ICE candidate:', e);
                });
            }
        });
        
        return () => {
            socket.off('file_answer');
            socket.off('file_ice');
            if (peerConnection.current) peerConnection.current.close();
        };
    }, [socket, status]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const startTransfer = async () => {
        if (!file || !activeChat || !socket) return;
        
        setStatus('offering');
        
        // Setup WebRTC
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        peerConnection.current = pc;
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('file_ice', {
                    recipientId: activeChat,
                    candidate: event.candidate
                });
            }
        };
        
        const dc = pc.createDataChannel('fileTransfer', {
            ordered: true
        });
        dataChannel.current = dc;
        
        dc.onopen = () => {
            sendFileChunks();
        };
        
        dc.onclose = () => {
            if (progress < 100) {
                setStatus('error');
                setErrorMsg('Connection closed unexpectedly');
            }
        };
        
        dc.onerror = (err) => {
            console.error('Data channel error:', err);
            setStatus('error');
            setErrorMsg('Connection error');
        };

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.emit('file_offer', {
                recipientId: activeChat,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                offer: offer
            });
        } catch (e) {
            console.error('Error creating offer:', e);
            setStatus('error');
            setErrorMsg('Failed to create P2P offer');
        }
    };
    
    const sendFileChunks = () => {
        if (!file || !dataChannel.current) return;
        
        const CHUNK_SIZE = 64 * 1024; // 64KB
        let offset = 0;
        
        fileReader.current.onerror = error => {
            console.error('Error reading file:', error);
            setStatus('error');
            setErrorMsg('Error reading file from disk');
        };
        
        fileReader.current.onload = e => {
            if (!dataChannel.current || dataChannel.current.readyState !== 'open') return;
            
            dataChannel.current.send(e.target?.result as ArrayBuffer);
            offset += (e.target?.result as ArrayBuffer).byteLength;
            
            const pct = Math.round((offset / file.size) * 100);
            setProgress(pct);
            
            // Inform the receiver about the progress so they can show a bar too (optional, or let them track locally)
            if (socket) {
                socket.emit('file_progress', { recipientId: activeChat, progress: pct });
            }

            if (offset < file.size) {
                readSlice(offset);
            } else {
                setStatus('complete');
                setTimeout(() => {
                    onClose();
                }, 2000);
            }
        };
        
        const readSlice = (o: number) => {
            const slice = file.slice(offset, o + CHUNK_SIZE);
            fileReader.current.readAsArrayBuffer(slice);
        };
        
        // Handle backpressure
        dataChannel.current.bufferedAmountLowThreshold = CHUNK_SIZE * 2;
        dataChannel.current.onbufferedamountlow = () => {
            if (offset < file.size && dataChannel.current?.readyState === 'open') {
                readSlice(offset);
            }
        };
        
        readSlice(0);
    };

    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Zap className="text-emerald-400" size={24} /> P2P File Transfer
                    </h3>
                    <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                        <X size={20} />
                    </button>
                </div>
                
                {status === 'idle' && (
                    <div className="space-y-4">
                        <p className="text-sm text-white/70">
                            Send files directly to the other user bypassing the server. Ideal for massive files like movies or ROMs.
                        </p>
                        
                        {!file ? (
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-white/20 rounded-xl hover:bg-white/5 transition-colors cursor-pointer group">
                                <Upload className="text-white/50 group-hover:text-emerald-400 transition-colors mb-2" size={32} />
                                <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">Click to select file</span>
                                <input type="file" className="hidden" onChange={handleFileSelect} />
                            </label>
                        ) : (
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                                <div className="truncate pr-4">
                                    <p className="text-white font-medium truncate">{file.name}</p>
                                    <p className="text-white/50 text-xs">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                                <button onClick={() => setFile(null)} className="p-2 bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors flex-shrink-0">
                                    <X size={16} />
                                </button>
                            </div>
                        )}
                        
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors font-medium">
                                Cancel
                            </button>
                            <button 
                                onClick={startTransfer}
                                disabled={!file || !activeChat}
                                className="px-6 py-2 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:grayscale shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] flex items-center gap-2"
                            >
                                <Zap size={18} /> Send Directly
                            </button>
                        </div>
                    </div>
                )}
                
                {status === 'offering' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="animate-spin text-emerald-400 mb-4" size={40} />
                        <p className="text-white font-medium">Waiting for peer to accept...</p>
                        <p className="text-white/50 text-sm mt-2 text-center max-w-[250px]">
                            They must click "Accept" on their screen to begin the transfer.
                        </p>
                    </div>
                )}
                
                {status === 'transferring' && (
                    <div className="space-y-4 py-4">
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-white/80 font-medium truncate pr-4">{file?.name}</span>
                            <span className="text-emerald-400 font-bold">{progress}%</span>
                        </div>
                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)] transition-all duration-300" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-center text-xs text-white/50 animate-pulse">Do not close this window</p>
                    </div>
                )}
                
                {status === 'complete' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                            <Check size={32} />
                        </div>
                        <p className="text-white font-bold text-lg">Transfer Complete!</p>
                    </div>
                )}
                
                {status === 'error' && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="w-16 h-16 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mb-4">
                            <X size={32} />
                        </div>
                        <p className="text-rose-400 font-bold text-lg">Transfer Failed</p>
                        <p className="text-white/60 text-sm mt-2">{errorMsg}</p>
                        <button onClick={() => setStatus('idle')} className="mt-6 px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors">
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
