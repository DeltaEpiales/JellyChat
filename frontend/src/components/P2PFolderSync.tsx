import React, { useState, useEffect, useRef } from 'react';
import { X, Check, Loader2, FolderSync } from 'lucide-react';
import { Socket } from 'socket.io-client';
import JSZip from 'jszip';

interface P2PFolderSyncProps {
    socket: Socket | null;
    peerIp: string;
    folderName: string;
    manifest: any;
    handle?: FileSystemDirectoryHandle;
    isSender: boolean;
    onClose: () => void;
}

export const P2PFolderSync: React.FC<P2PFolderSyncProps> = ({ socket, peerIp, folderName, handle, isSender, onClose }) => {
    const [status, setStatus] = useState<'idle' | 'zipping' | 'uploading' | 'complete' | 'error'>('idle');
    const [progress, setProgress] = useState(0);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [currentFile, setCurrentFile] = useState('');
    const [eta, setEta] = useState<number | null>(null);
    const [speed, setSpeed] = useState<number | null>(null);

    const lastEmitRef = useRef(0);
    const receivedChunksRef = useRef<ArrayBuffer[]>([]);

    const emitProgress = (payload: any) => {
        if (!socket) return;
        const now = Date.now();
        if (now - lastEmitRef.current > 250 || payload.status === 'complete' || payload.status === 'error') {
            socket.emit('folder_sync_progress', {
                recipientId: peerIp,
                ...payload
            });
            lastEmitRef.current = now;
        }
    };

    const startWebsocketSync = async () => {
        if (!handle || !socket) {
            setStatus('error');
            setErrorMsg('Folder reference or connection lost. Please re-broadcast the folder.');
            return;
        }

        try {
            setStatus('zipping');
            const zip = new JSZip();

            // Recursively read all files
            const addFilesToZip = async (dirHandle: FileSystemDirectoryHandle, currentPath: string) => {
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file') {
                        const fileHandle = entry as FileSystemFileHandle;
                        const file = await fileHandle.getFile();
                        zip.file(`${currentPath}${file.name}`, file);
                        setCurrentFile(`${currentPath}${file.name}`);
                    } else if (entry.kind === 'directory') {
                        const subDirHandle = entry as FileSystemDirectoryHandle;
                        await addFilesToZip(subDirHandle, `${currentPath}${subDirHandle.name}/`);
                    }
                }
            };

            await addFilesToZip(handle, `${folderName}/`);
            
            // Generate zip
            const zipBlob = await zip.generateAsync({ 
                type: 'blob',
                compression: 'STORE',
            }, (meta) => {
                const p = Math.round(meta.percent);
                setProgress(p);
                if (meta.currentFile) setCurrentFile(meta.currentFile);
                emitProgress({ status: 'zipping', progress: p, currentFile: meta.currentFile });
            });

            setStatus('uploading');
            emitProgress({ status: 'uploading', progress: 0 });

            // Stream chunks via WebSockets
            const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
            const totalChunks = Math.ceil(zipBlob.size / CHUNK_SIZE);
            const startTime = Date.now();
            let lastLoaded = 0;
            let lastTime = startTime;

            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, zipBlob.size);
                const chunk = await zipBlob.slice(start, end).arrayBuffer();

                await new Promise<void>((resolve) => {
                    socket.emit('folder_sync_chunk', {
                        recipientId: peerIp,
                        chunk,
                        index: i,
                        total: totalChunks
                    });
                    
                    // Artificial small delay to prevent overflowing the socket buffer on large files
                    setTimeout(resolve, 50);
                });

                const loaded = end;
                const p = Math.round((loaded / zipBlob.size) * 100);
                setUploadProgress(p);

                const now = Date.now();
                if (now - lastTime > 500 || i === totalChunks - 1) {
                    const bytesSinceLast = loaded - lastLoaded;
                    const timeSinceLast = (now - lastTime) / 1000;
                    const currentSpeed = (bytesSinceLast / timeSinceLast) / (1024 * 1024);
                    
                    const bytesRemaining = zipBlob.size - loaded;
                    const currentEta = currentSpeed > 0 ? (bytesRemaining / (currentSpeed * 1024 * 1024)) : 0;

                    setSpeed(currentSpeed);
                    setEta(currentEta);
                    
                    emitProgress({ 
                        status: 'uploading', 
                        progress: p, 
                        speed: currentSpeed, 
                        eta: currentEta 
                    });

                    lastLoaded = loaded;
                    lastTime = now;
                }
            }

            socket.emit('folder_sync_complete', {
                recipientId: peerIp,
                folderName
            });

            setStatus('complete');
            emitProgress({ status: 'complete' });
            setTimeout(() => {
                onClose();
            }, 3000);
            
        } catch (e: any) {
            console.error('Websocket folder sync error:', e);
            setStatus('error');
            setErrorMsg(e.message || 'Failed to zip and send folder');
            emitProgress({ status: 'error', errorMsg: e.message || 'Failed to send folder' });
        }
    };

    useEffect(() => {
        if (!socket) return;

        const handleProgress = (data: any) => {
            if (isSender) return;
            setStatus(data.status);
            if (data.status === 'zipping') {
                setProgress(data.progress || 0);
                setCurrentFile(data.currentFile || '');
            } else if (data.status === 'uploading') {
                setUploadProgress(data.progress || 0);
                if (data.eta !== undefined) setEta(data.eta);
                if (data.speed !== undefined) setSpeed(data.speed);
            } else if (data.status === 'error') {
                setErrorMsg(data.errorMsg || 'Peer encountered an error');
            }
        };

        const handleChunk = (data: any) => {
            if (isSender) return;
            receivedChunksRef.current.push(data.chunk);
        };

        const handleComplete = (data: any) => {
            if (isSender) return;
            
            try {
                // Stitch chunks together
                const blob = new Blob(receivedChunksRef.current, { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${data.folderName}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                receivedChunksRef.current = []; // Free memory
                setStatus('complete');
                setTimeout(() => {
                    onClose();
                }, 3000);
            } catch (e: any) {
                console.error('Failed to save received folder:', e);
                setStatus('error');
                setErrorMsg('Failed to save the received zip file.');
            }
        };

        socket.on('folder_sync_progress', handleProgress);
        socket.on('folder_sync_chunk', handleChunk);
        socket.on('folder_sync_complete', handleComplete);

        return () => {
            socket.off('folder_sync_progress', handleProgress);
            socket.off('folder_sync_chunk', handleChunk);
            socket.off('folder_sync_complete', handleComplete);
        };
    }, [socket, isSender, onClose]);

    useEffect(() => {
        if (status !== 'idle') return;

        if (isSender) {
            if (handle) {
                startWebsocketSync();
            } else {
                setStatus('error');
                setErrorMsg('Folder reference lost. Please re-broadcast the folder.');
            }
        } else {
            // Receiver requests the folder from the sender
            receivedChunksRef.current = []; // reset
            socket?.emit('request_folder_sync', {
                recipientId: peerIp,
                folderName
            });
        }
    }, [isSender, handle, status, socket, peerIp, folderName]);

    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-theme/20 rounded-2xl w-full max-w-md p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <FolderSync className="text-theme-text" size={24} /> 
                        {isSender ? 'Sending Folder' : 'Receiving Folder'}
                    </h3>
                    <button onClick={onClose} className="text-white/50 hover:text-white p-1 rounded-lg hover:bg-white/10">
                        <X size={20} />
                    </button>
                </div>

                {!isSender && status === 'idle' && (
                    <div className="space-y-4 text-center">
                        <Loader2 className="animate-spin text-theme-text mb-4 mx-auto" size={40} />
                        <p className="text-white font-medium">Requesting {folderName} from peer...</p>
                        <p className="text-white/50 text-sm mt-2">
                            The peer's machine is zipping the folder and will stream it over the encrypted connection.
                            Your browser will download it automatically when finished.
                        </p>
                    </div>
                )}

                {status === 'zipping' && (
                    <div className="space-y-4 py-4 animate-in fade-in">
                        <Loader2 className="animate-spin text-theme-text mx-auto mb-4" size={40} />
                        <p className="text-center text-white font-medium">{isSender ? 'Zipping' : "Peer is zipping"} {folderName}...</p>
                        <div className="flex justify-between text-sm mb-1 mt-4">
                            <span className="text-white/80 font-medium truncate pr-4">
                                {currentFile || 'Processing...'}
                            </span>
                            <span className="text-theme-text font-bold">{progress}%</span>
                        </div>
                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-theme-text shadow-[0_0_10px_rgba(99,102,241,0.8)] transition-all duration-300" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {status === 'uploading' && (
                    <div className="space-y-4 py-4 animate-in fade-in">
                        <Loader2 className="animate-spin text-theme-text mx-auto mb-4" size={40} />
                        <p className="text-center text-white font-medium">{isSender ? 'Sending' : 'Receiving'} secure stream...</p>
                        <div className="flex justify-between text-sm mb-1 mt-4">
                            <div className="flex flex-col gap-1">
                                <span className="text-white/80 font-medium">
                                    {speed !== null && speed > 0 ? `${speed.toFixed(2)} MB/s` : 'Calculating...'}
                                </span>
                                <span className="text-white/50 text-xs">
                                    {eta !== null && eta > 0 ? `~${Math.ceil(eta)}s remaining` : ''}
                                </span>
                            </div>
                            <span className="text-theme-text font-bold self-start">{uploadProgress}%</span>
                        </div>
                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-theme-text shadow-[0_0_10px_rgba(99,102,241,0.8)] transition-all duration-300" 
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                    </div>
                )}

                {status === 'complete' && (
                    <div className="flex flex-col items-center justify-center py-8 animate-in zoom-in">
                        <div className="w-16 h-16 bg-theme/20 text-theme-text rounded-full flex items-center justify-center mb-4">
                            <Check size={32} />
                        </div>
                        <p className="text-white font-bold text-lg">Sync Successfully {isSender ? 'Sent' : 'Received'}!</p>
                        <p className="text-theme-text/80 text-sm mt-2 text-center">
                            {isSender ? 'The peer has received the folder.' : 'The folder has been downloaded by your browser!'}
                        </p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="flex flex-col items-center justify-center py-8 text-center animate-in zoom-in">
                        <div className="w-16 h-16 bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mb-4">
                            <X size={32} />
                        </div>
                        <p className="text-rose-400 font-bold text-lg">Sync Failed</p>
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
