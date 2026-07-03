import { useState } from 'react';
import { Package, X, FolderSync, Link as LinkIcon, Loader2 } from 'lucide-react';

interface ModSyncHubProps {
    onClose: () => void;
    onSendInvite: (type: 'folder' | 'workshop', payload: any) => void;
}

export function ModSyncHub({ onClose, onSendInvite }: ModSyncHubProps) {
    const [mode, setMode] = useState<'select' | 'folder' | 'workshop'>('select');
    const [workshopUrl, setWorkshopUrl] = useState('');
    const [isFetching, setIsFetching] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleFetchWorkshop = async () => {
        try {
            setErrorMsg('');
            // Extract ID from URL
            const urlObj = new URL(workshopUrl);
            const id = urlObj.searchParams.get('id') || workshopUrl.match(/\/?(\d+)$/)?.[1];
            
            if (!id) {
                setErrorMsg('Invalid Steam Workshop URL');
                return;
            }

            setIsFetching(true);
            const res = await fetch(`/api/steam/collection/${id}`);
            const data = await res.json();
            
            if (res.ok) {
                onSendInvite('workshop', data);
                onClose();
            } else {
                setErrorMsg(data.error || 'Failed to fetch collection');
            }
        } catch (e) {
            setErrorMsg('Invalid URL or network error');
        } finally {
            setIsFetching(false);
        }
    };

    const handleFolderSelect = async () => {
        try {
            if (!('showDirectoryPicker' in window)) {
                setErrorMsg('Your browser does not support folder selection (try Chrome/Edge).');
                return;
            }
            
            // Note: Typescript might complain about showDirectoryPicker if lib.dom doesn't have it
            // We cast window to any
            const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
            
            // Build manifest
            const files: any[] = [];
            let totalSize = 0;
            
            async function scanDir(handle: any, path: string = '') {
                for await (const entry of handle.values()) {
                    if (entry.kind === 'file') {
                        const file = await entry.getFile();
                        files.push({ path: path + entry.name, size: file.size });
                        totalSize += file.size;
                    } else if (entry.kind === 'directory') {
                        await scanDir(entry, path + entry.name + '/');
                    }
                }
            }
            
            await scanDir(dirHandle);
            
            if (files.length === 0) {
                setErrorMsg('Selected folder is empty.');
                return;
            }

            onSendInvite('folder', {
                name: dirHandle.name,
                fileCount: files.length,
                totalSize: totalSize,
                manifest: files
            });
            onClose();
            
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setErrorMsg('Failed to read folder: ' + e.message);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-[#13131f] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Package size={20} className="text-indigo-400" />
                        Modpack Sync
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    {errorMsg && (
                        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm font-medium">
                            {errorMsg}
                        </div>
                    )}

                    {mode === 'select' && (
                        <div className="grid grid-cols-1 gap-4">
                            <button 
                                onClick={() => setMode('folder')}
                                className="flex flex-col items-start gap-2 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/50 transition-all group text-left"
                            >
                                <div className="flex items-center gap-3 w-full">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                        <FolderSync size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white group-hover:text-indigo-300 transition-colors">Local Folder Sync (P2P)</h3>
                                        <p className="text-xs text-white/50">Mirror a local folder (like .minecraft/mods) directly to peers.</p>
                                    </div>
                                </div>
                            </button>

                            <button 
                                onClick={() => setMode('workshop')}
                                className="flex flex-col items-start gap-2 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-[#1b2838] hover:border-[#66c0f4]/50 transition-all group text-left"
                            >
                                <div className="flex items-center gap-3 w-full">
                                    <div className="w-10 h-10 rounded-lg bg-[#2a475e] text-[#66c0f4] flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white group-hover:text-[#66c0f4] transition-colors">Steam Workshop Collection</h3>
                                        <p className="text-xs text-white/50">Import a collection link for peers to natively subscribe.</p>
                                    </div>
                                </div>
                            </button>
                        </div>
                    )}

                    {mode === 'folder' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                            <p className="text-sm text-white/70">
                                This will generate a sync invite. When peers click it, Tailchat will use P2P DataChannels to securely transfer the contents of your selected folder to them.
                            </p>
                            <button 
                                onClick={handleFolderSelect}
                                className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] flex items-center justify-center gap-2"
                            >
                                <FolderSync size={18} />
                                Select Folder to Share
                            </button>
                            <button onClick={() => setMode('select')} className="w-full py-2 text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
                                Back
                            </button>
                        </div>
                    )}

                    {mode === 'workshop' && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-white/60 uppercase tracking-widest">Collection URL</label>
                                <div className="relative">
                                    <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                                    <input 
                                        type="text"
                                        placeholder="https://steamcommunity.com/sharedfiles/..."
                                        value={workshopUrl}
                                        onChange={e => setWorkshopUrl(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-[#66c0f4]/50 focus:bg-white/10 transition-colors"
                                    />
                                </div>
                            </div>
                            <button 
                                onClick={handleFetchWorkshop}
                                disabled={!workshopUrl || isFetching}
                                className="w-full py-3 bg-gradient-to-r from-[#171a21] to-[#2a475e] hover:from-[#2a475e] hover:to-[#66c0f4] text-white border border-[#66c0f4]/30 font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(102,192,244,0.1)] hover:shadow-[0_0_20px_rgba(102,192,244,0.2)]"
                            >
                                {isFetching ? <Loader2 size={18} className="animate-spin" /> : <Package size={18} />}
                                Import Collection
                            </button>
                            <button onClick={() => setMode('select')} className="w-full py-2 text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
                                Back
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
