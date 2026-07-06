import React, { useState } from 'react';
import { Upload, X, Check, Loader2, Zap } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface P2PFileTransferProps {
    socket: Socket | null;
    activeChat: string | null;
    onClose: () => void;
    peers?: any[];
    assignments?: any[];
}

export const P2PFileTransfer: React.FC<P2PFileTransferProps> = ({ socket, activeChat, onClose, peers = [], assignments = [] }) => {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<'idle' | 'transferring' | 'complete' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [selectedIp, setSelectedIp] = useState<string>('');
    const [progress, setProgress] = useState<number>(0);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const startTransfer = async () => {
        if (!file || !activeChat || !socket) return;
        
        let targetIp = activeChat;
        if (activeChat.startsWith('prof_')) {
            if (!selectedIp) {
                setErrorMsg('Please select a device');
                setStatus('error');
                return;
            }
            targetIp = selectedIp;
        }

        setStatus('transferring');
        setProgress(0);
        
        try {
            socket.emit('p2p_file_start', {
                recipientId: targetIp,
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type || 'application/octet-stream'
            });

            const CHUNK_SIZE = 512 * 1024; // 512KB chunks
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(file.size, start + CHUNK_SIZE);
                const chunk = file.slice(start, end);
                const buffer = await chunk.arrayBuffer();

                socket.emit('p2p_file_chunk', {
                    recipientId: targetIp,
                    fileName: file.name,
                    chunk: buffer,
                    index: i,
                    totalChunks: totalChunks
                });

                setProgress(Math.round(((i + 1) / totalChunks) * 100));
            }

            socket.emit('p2p_file_complete', {
                recipientId: targetIp,
                fileName: file.name
            });

            setStatus('complete');
            setTimeout(() => {
                onClose();
            }, 2000);
        } catch (e: any) {
            console.error('Error sending file via WebSockets:', e);
            setStatus('error');
            setErrorMsg(e.message || 'Connection error');
        }
    };
    
    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Zap className="text-emerald-400" size={24} /> File Transfer
                    </h3>
                    <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                        <X size={20} />
                    </button>
                </div>
                
                {status === 'idle' && (
                    <div className="space-y-4">
                        <p className="text-sm text-white/70">
                            Securely transfer a file directly to the other user via P2P WebSockets. They will receive a prompt to download it.
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
                            {activeChat && activeChat.startsWith('prof_') && (
                                <div className="flex-1">
                                    <select
                                        value={selectedIp}
                                        onChange={(e) => setSelectedIp(e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="" disabled>Select target device...</option>
                                        {peers.filter(p => assignments.find(a => a.ip === p.ip && a.profileId === activeChat)).map(p => (
                                            <option key={p.ip} value={p.ip}>{p.name} ({p.ip})</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors font-medium">
                                Cancel
                            </button>
                            <button 
                                onClick={startTransfer}
                                disabled={!file || !activeChat || (activeChat.startsWith('prof_') && !selectedIp) || !socket}
                                className="px-6 py-2 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:grayscale shadow-[0_0_15px_var(--color-theme-glow-alt)] hover:shadow-[0_0_20px_var(--color-theme-glow-alt)] flex items-center gap-2"
                            >
                                <Zap size={18} /> Send File
                            </button>
                        </div>
                    </div>
                )}
                
                {status === 'transferring' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <Loader2 className="animate-spin text-emerald-400 mb-4" size={40} />
                        <p className="text-white font-medium mb-4">Transferring via WebSockets...</p>
                        <div className="w-full max-w-[80%] h-2 bg-white/10 rounded-full overflow-hidden mb-2">
                            <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-white/60 text-xs font-mono">{progress}% Complete</p>
                    </div>
                )}
                
                {status === 'complete' && (
                    <div className="flex flex-col items-center justify-center py-8">
                        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                            <Check size={32} />
                        </div>
                        <p className="text-white font-bold text-lg">Transfer Complete!</p>
                        <p className="text-emerald-400/80 text-sm mt-2">File sent successfully.</p>
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
