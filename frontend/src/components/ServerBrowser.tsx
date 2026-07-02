import { useState, useEffect } from 'react';
import { Server, Users, Activity, Copy, Check } from 'lucide-react';

interface McServer {
    ip: string;
    hostName: string;
    motd: string;
    players: {
        online: number;
        max: number;
    };
    version: string;
    favicon?: string;
    modPack?: string;
}

export function ServerBrowser() {
    const [servers, setServers] = useState<McServer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [copiedIp, setCopiedIp] = useState<string | null>(null);

    useEffect(() => {
        fetchServers();
        const interval = setInterval(fetchServers, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchServers = async () => {
        try {
            const res = await fetch('/api/minecraft/servers');
            if (res.ok) {
                const data = await res.json();
                setServers(data);
            }
        } catch (e) {
            console.error('Failed to fetch minecraft servers', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = (ip: string) => {
        navigator.clipboard.writeText(ip);
        setCopiedIp(ip);
        setTimeout(() => setCopiedIp(null), 2000);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-6 text-white/50 space-y-4">
                <Activity className="animate-spin text-indigo-400" size={24} />
                <span className="text-sm font-medium animate-pulse">Scanning Tailscale Network...</span>
            </div>
        );
    }

    if (servers.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center border-t border-white/5 bg-black/20">
                <Server className="text-white/20 mb-3" size={32} />
                <h3 className="text-white/80 font-medium mb-1">No Active Game Servers</h3>
                <p className="text-white/40 text-xs max-w-[200px] leading-relaxed">
                    Auto-detection is running on your Tailscale network.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col border-t border-white/5 bg-black/20">
            <div className="px-4 py-3 flex items-center justify-between border-b border-white/5 bg-white/5 backdrop-blur-md sticky top-0 z-10">
                <h3 className="text-white/90 font-semibold text-sm flex items-center gap-2 tracking-wide uppercase">
                    <Server size={14} className="text-emerald-400" />
                    Network Servers
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                    {servers.length} LIVE
                </span>
            </div>
            
            <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar max-h-[300px]">
                {servers.map((server, idx) => (
                    <div 
                        key={idx} 
                        className="group relative bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/30 rounded-xl p-3 transition-all duration-300 overflow-hidden"
                    >
                        {/* Glow effect */}
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                        
                        <div className="flex items-start gap-3 relative z-10">
                            {/* Server Icon */}
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/10 flex-shrink-0 flex items-center justify-center">
                                {server.favicon ? (
                                    <img src={server.favicon} alt="Server Icon" className="w-full h-full object-cover" />
                                ) : (
                                    <Server size={20} className="text-white/30" />
                                )}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                {/* Title and Copy IP */}
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-white/90 text-sm font-bold truncate pr-2">
                                        {server.hostName}
                                    </div>
                                    <button 
                                        onClick={() => handleCopy(server.ip)}
                                        className="text-white/40 hover:text-white bg-white/5 hover:bg-white/10 p-1 rounded-md transition-colors flex-shrink-0"
                                        title="Copy IP"
                                    >
                                        {copiedIp === server.ip ? (
                                            <Check size={12} className="text-emerald-400" />
                                        ) : (
                                            <Copy size={12} />
                                        )}
                                    </button>
                                </div>
                                
                                {/* MOTD */}
                                <div 
                                    className="text-white/60 text-xs line-clamp-2 mb-2 min-h-[32px]"
                                    dangerouslySetInnerHTML={{ __html: server.motd }}
                                />
                                
                                {/* Stats Row */}
                                <div className="flex items-center gap-3 text-[10px] font-medium text-white/50">
                                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-0.5 rounded text-emerald-300/80">
                                        <Users size={10} />
                                        <span>{server.players.online}/{server.players.max}</span>
                                    </div>
                                    
                                    <div className="truncate text-white/40">
                                        v{server.version}
                                    </div>
                                    
                                    {server.modPack && (
                                        <div className="ml-auto truncate px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                            {server.modPack}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
