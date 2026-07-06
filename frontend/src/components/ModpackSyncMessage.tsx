
import { Package, FolderSync, Download, ExternalLink } from 'lucide-react';

interface ModpackSyncMessageProps {
    content: string;
    isMe: boolean;
    onJoinP2P: (payload: any) => void;
}

export function ModpackSyncMessage({ content, isMe, onJoinP2P }: ModpackSyncMessageProps) {
    let data;
    try {
        data = JSON.parse(content);
    } catch (e) {
        return <div className="text-rose-400">Invalid Modpack Data</div>;
    }

    if (data.syncType === 'workshop') {
        const payload = data.payload;
        return (
            <div className="flex flex-col gap-3 mt-2 mb-1 w-full max-w-sm rounded-xl overflow-hidden border border-white/10 bg-[#1b2838]">
                {payload.previewUrl && (
                    <div className="w-full h-32 relative">
                        <img src={payload.previewUrl} alt={payload.title} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#1b2838] to-transparent"></div>
                    </div>
                )}
                <div className={`p-4 ${payload.previewUrl ? 'pt-0' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <Package size={16} className="text-[#66c0f4]" />
                        <span className="text-xs font-bold text-[#66c0f4] uppercase tracking-wider">Steam Workshop</span>
                    </div>
                    <h3 className="text-white font-bold mb-1 truncate" title={payload.title}>{payload.title}</h3>
                    
                    <a 
                        href={`steam://url/CommunityFilePage/${payload.id}`}
                        className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 bg-gradient-to-r from-[#2a475e] to-[#66c0f4] hover:from-[#66c0f4] hover:to-[#66c0f4] text-white font-bold rounded-lg transition-all text-sm shadow-[0_0_15px_rgba(102,192,244,0.2)]"
                    >
                        <ExternalLink size={16} />
                        Subscribe in Steam
                    </a>
                </div>
            </div>
        );
    }

    if (data.syncType === 'folder') {
        const payload = data.payload;
        return (
            <div className="flex flex-col gap-3 mt-2 mb-1 w-full max-w-sm rounded-xl overflow-hidden border border-white/10 bg-theme/10">
                <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <FolderSync size={16} className="text-theme-text" />
                        <span className="text-xs font-bold text-theme-text uppercase tracking-wider">Local Folder Mirror</span>
                    </div>
                    <h3 className="text-white font-bold mb-1 truncate" title={payload.name}>{payload.name}</h3>
                    <p className="text-white/60 text-xs mb-4">
                        {payload.fileCount} files • {(payload.totalSize / 1024 / 1024).toFixed(2)} MB
                    </p>
                    
                    {!isMe && (
                        <button 
                            onClick={() => onJoinP2P(payload)}
                            className="flex items-center justify-center gap-2 w-full py-2.5 bg-theme hover:bg-theme/80 text-white font-bold rounded-lg transition-all text-sm shadow-[0_0_15px_var(--color-theme-glow)]"
                        >
                            <Download size={16} />
                            Sync to Local Folder
                        </button>
                    )}
                    {isMe && (
                        <div className="text-center py-2 bg-black/20 rounded-lg border border-white/5">
                            <span className="text-xs text-white/50 font-medium">Hosting Sync Session</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return <div>{data.text || content}</div>;
}
