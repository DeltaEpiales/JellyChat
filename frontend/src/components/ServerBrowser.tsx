import { useState, useEffect, useCallback, useRef } from 'react';
import { Gamepad2, Users, Activity, Copy, Check, ExternalLink, Globe, RefreshCw, Wifi, ChevronDown, ChevronUp, MonitorUp, Zap, Radio, Search, X } from 'lucide-react';

interface GameServer {
    ip: string;
    port: number;
    game: string;
    gameType: string;
    displayName: string;
    name: string;
    map: string | null;
    players: {
        online: number;
        max: number;
        list?: string[];
    };
    ping: number;
    joinUrl?: string | null;
    steamAppId?: string | null;
    version?: string | null;
    modPack?: string | null;
    favicon?: string | null;
    hostName?: string;
}

interface SteamInfo {
    installed: boolean;
    personaName: string | null;
    steamId: string | null;
    installedGames: { steamAppId: string; name: string; canHostServer: boolean }[];
    totalInstalledApps: number;
    supportedGamesScanning: number;
    lastScanTime: number;
}

interface SupportedGame {
    type: string;
    name: string;
    defaultPort: number;
    steamAppId: string | null;
    hasJoinUrl: boolean;
    installed: boolean | null;
}

// Game type emoji/icon mapping for visual flair
const GAME_ICONS: Record<string, string> = {
    minecraft: '⛏️',
    garrysmod: '🔧',
    counterstrike2: '🔫',
    teamfortress2: '🎩',
    csgo: '🔫',
    rust: '🏚️',
    valheim: '⚔️',
    palworld: '🐾',
    terrariatshock: '🌍',
    ase: '🦖',
    asa: '🦖',
    projectzomboid: '🧟',
    dst: '🔥',
    theforest: '🌲',
    unturned: '🚗',
    dayz: '🧟‍♂️',
    arma3: '🪖',
    satisfactory: '🏭',
    factorio: '⚙️',
    vrising: '🧛',
    barotrauma: '🌊',
    mordhau: '⚔️',
    hll: '💣',
    squad: '🪖',
    insurgencysandstorm: '🔫',
    conanexiles: '🗡️',
    enshrouded: '🌫️',
    corekeeper: '💎',
    starbound: '🌟',
    sdtd: '🧟',
    l4d2: '🧟',
    assettocorsa: '🏎️',
    beammp: '🚗',
    css: '🔫',
    counterstrike16: '🔫',
    insurgency: '🔫',
    svencoop: '🔬',
    spaceengineers: '🚀',
    eco: '🌱',
    theisle: '🦕',
    soulmask: '👹',
    icarus: '🪐',
};

// Game color theming
const GAME_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    minecraft:      { bg: 'from-emerald-500/15', border: 'hover:border-emerald-500/40', text: 'text-emerald-400', glow: 'rgba(52,211,153,0.15)' },
    garrysmod:      { bg: 'from-blue-500/15',    border: 'hover:border-blue-500/40',    text: 'text-blue-400',    glow: 'rgba(59,130,246,0.15)' },
    counterstrike2: { bg: 'from-amber-500/15',   border: 'hover:border-amber-500/40',   text: 'text-amber-400',   glow: 'rgba(245,158,11,0.15)' },
    teamfortress2:  { bg: 'from-orange-500/15',  border: 'hover:border-orange-500/40',  text: 'text-orange-400',  glow: 'rgba(249,115,22,0.15)' },
    rust:           { bg: 'from-red-500/15',     border: 'hover:border-red-500/40',     text: 'text-red-400',     glow: 'rgba(248,113,113,0.15)' },
    valheim:        { bg: 'from-cyan-500/15',    border: 'hover:border-cyan-500/40',    text: 'text-cyan-400',    glow: 'rgba(34,211,238,0.15)' },
    palworld:       { bg: 'from-sky-500/15',     border: 'hover:border-sky-500/40',     text: 'text-sky-400',     glow: 'rgba(56,189,248,0.15)' },
    terrariatshock: { bg: 'from-lime-500/15',    border: 'hover:border-lime-500/40',    text: 'text-lime-400',    glow: 'rgba(163,230,53,0.15)' },
    projectzomboid: { bg: 'from-rose-500/15',    border: 'hover:border-rose-500/40',    text: 'text-rose-400',    glow: 'rgba(244,63,94,0.15)' },
    dayz:           { bg: 'from-stone-500/15',   border: 'hover:border-stone-500/40',   text: 'text-stone-400',   glow: 'rgba(168,162,158,0.15)' },
    satisfactory:   { bg: 'from-violet-500/15',  border: 'hover:border-violet-500/40',  text: 'text-violet-400',  glow: 'rgba(167,139,250,0.15)' },
    factorio:       { bg: 'from-yellow-500/15',  border: 'hover:border-yellow-500/40',  text: 'text-yellow-400',  glow: 'rgba(250,204,21,0.15)' },
    spaceengineers: { bg: 'from-theme/15',  border: 'hover:border-theme/40',  text: 'text-theme-text',  glow: 'rgba(129,140,248,0.15)' },
    dst:            { bg: 'from-amber-600/15',   border: 'hover:border-amber-600/40',   text: 'text-amber-500',   glow: 'rgba(217,119,6,0.15)' },
    l4d2:           { bg: 'from-red-600/15',     border: 'hover:border-red-600/40',     text: 'text-red-500',     glow: 'rgba(220,38,38,0.15)' },
    sdtd:           { bg: 'from-zinc-500/15',    border: 'hover:border-zinc-500/40',    text: 'text-zinc-400',    glow: 'rgba(161,161,170,0.15)' },
};

const DEFAULT_COLOR = { bg: 'from-theme/15', border: 'hover:border-theme/40', text: 'text-theme-text', glow: 'rgba(99,102,241,0.15)' };

/* ───── Scanning Wave Animation Component ───── */
function ScanningOverlay({ progress, scanningText }: { progress: number; scanningText: string }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative flex flex-col items-center gap-6 p-10 rounded-3xl bg-[#13131f]/90 border border-theme/20 shadow-[0_0_80px_rgba(99,102,241,0.15)] max-w-sm w-full">
                {/* Radar sweep */}
                <div className="relative w-36 h-36">
                    {/* Concentric rings */}
                    {[1, 2, 3].map(i => (
                        <div
                            key={i}
                            className="absolute inset-0 rounded-full border border-theme/10"
                            style={{
                                transform: `scale(${i * 0.33})`,
                            }}
                        />
                    ))}
                    {/* Rotating sweep line */}
                    <div
                        className="absolute top-1/2 left-1/2 w-[50%] h-[2px] origin-left"
                        style={{
                            background: 'linear-gradient(90deg, rgba(99,102,241,0.8) 0%, transparent 100%)',
                            animation: 'radarSweepLine 2s linear infinite',
                        }}
                    />
                    {/* Sweep trail (conic gradient) */}
                    <div
                        className="absolute inset-0 rounded-full"
                        style={{
                            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(99,102,241,0.08) 30deg, transparent 60deg)',
                            animation: 'radarSweepTrail 2s linear infinite',
                        }}
                    />
                    {/* Center dot */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-theme-text rounded-full shadow-[0_0_12px_rgba(99,102,241,0.6)]" />
                    {/* Blip dots appearing */}
                    {[0, 1, 2, 3, 4].map(i => (
                        <div
                            key={i}
                            className="absolute w-1.5 h-1.5 bg-theme-text rounded-full"
                            style={{
                                top: `${25 + Math.sin(i * 1.3) * 30}%`,
                                left: `${25 + Math.cos(i * 1.7) * 35}%`,
                                opacity: progress > i * 20 ? 1 : 0,
                                transition: 'opacity 0.4s ease-out',
                                boxShadow: '0 0 8px rgba(99,102,241,0.8)',
                                animation: progress > i * 20 ? `blipPulse 1.5s ease-in-out ${i * 0.3}s infinite` : 'none',
                            }}
                        />
                    ))}
                </div>

                {/* Progress text */}
                <div className="text-center space-y-2">
                    <h3 className="text-white font-bold text-lg tracking-tight">{scanningText}</h3>
                    <div className="w-56 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{
                                width: `${progress}%`,
                                background: 'linear-gradient(90deg, #6366f1, #818cf8, #6366f1)',
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 1.5s ease-in-out infinite',
                            }}
                        />
                    </div>
                    <span className="text-white/30 text-xs block">Querying game server ports across your network</span>
                </div>
            </div>

            {/* Injected keyframes */}
            <style>{`
                @keyframes radarSweepLine {
                    from { transform: translateY(-50%) rotate(0deg); }
                    to { transform: translateY(-50%) rotate(360deg); }
                }
                @keyframes radarSweepTrail {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes blipPulse {
                    0%, 100% { transform: scale(1); opacity: 0.8; }
                    50% { transform: scale(1.8); opacity: 1; }
                }
                @keyframes shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
            `}</style>
        </div>
    );
}

function ServerDetailsModal({ server, onClose }: { server: GameServer; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[#13131f] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                {/* Header with Background */}
                <div className="relative h-48 bg-black/50 overflow-hidden shrink-0">
                    {server.steamAppId ? (
                        <>
                            <img src={`https://steamcdn-a.akamaihd.net/steam/apps/${server.steamAppId}/header.jpg`} alt="Game Background" className="absolute inset-0 w-full h-full object-cover opacity-30 blur-sm" />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#13131f] to-transparent"></div>
                        </>
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-theme/20 to-purple-500/20"></div>
                    )}
                    
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white/70 transition-colors backdrop-blur-md">
                        <X size={20} />
                    </button>

                    <div className="absolute bottom-0 left-0 right-0 p-6 flex items-end gap-6">
                        <div className="w-24 h-24 rounded-2xl bg-black/50 border-2 border-white/10 overflow-hidden shadow-xl shrink-0 flex items-center justify-center backdrop-blur-md">
                            {server.steamAppId ? (
                                <img src={`https://steamcdn-a.akamaihd.net/steam/apps/${server.steamAppId}/header.jpg`} alt={server.game} className="w-full h-full object-cover" />
                            ) : server.favicon ? (
                                <img src={server.favicon} alt={server.game} className="w-full h-full object-cover rendering-pixelated" />
                            ) : (
                                <Gamepad2 size={40} className="text-white/30" />
                            )}
                        </div>
                        <div className="flex-1 pb-2">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    LIVE
                                </span>
                                {server.modPack && (
                                    <span className="bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest">
                                        Modded
                                    </span>
                                )}
                            </div>
                            <h2 className="text-2xl font-bold text-white tracking-tight leading-tight line-clamp-1">{server.name}</h2>
                            <p className="text-white/60 text-sm font-medium">{server.game}</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 flex flex-col md:flex-row gap-6">
                    {/* Left Column: Details */}
                    <div className="w-full md:w-1/3 space-y-6">
                        <div className="space-y-4">
                            <div>
                                <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Status</div>
                                <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                                    <Wifi size={14} /> Online ({server.ping}ms)
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Address</div>
                                <div className="flex items-center gap-2">
                                    <code className="text-xs font-mono bg-white/5 text-white/80 px-2 py-1 rounded border border-white/10 select-all">
                                        {server.ip}:{server.port}
                                    </code>
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Map</div>
                                <div className="text-sm font-medium text-white/90">{server.map || 'Unknown Map'}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1">Host</div>
                                <div className="text-sm font-medium text-white/90 flex items-center gap-2">
                                    <MonitorUp size={14} className="text-theme-text" />
                                    {server.hostName}
                                </div>
                            </div>
                        </div>

                        {server.joinUrl && (
                            <a
                                href={server.joinUrl}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-theme hover:bg-theme/80 text-white font-bold transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)]"
                            >
                                <ExternalLink size={18} />
                                Join Server
                            </a>
                        )}
                    </div>

                    {/* Right Column: Players */}
                    <div className="w-full md:w-2/3 flex flex-col border border-white/5 bg-black/20 rounded-xl overflow-hidden">
                        <div className="p-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
                            <h3 className="text-xs font-bold text-white/60 uppercase tracking-widest flex items-center gap-2">
                                <Users size={14} />
                                Connected Players
                            </h3>
                            <span className="text-xs font-mono text-white/40">
                                {server.players.online} / {server.players.max > 0 ? server.players.max : '∞'}
                            </span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-64">
                            {server.players.list && server.players.list.length > 0 ? (
                                server.players.list.map((player, idx) => (
                                    <div key={idx} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium text-white/90 flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-theme/20 flex items-center justify-center text-theme-text text-xs shrink-0">
                                            {player.charAt(0).toUpperCase()}
                                        </div>
                                        {player}
                                    </div>
                                ))
                            ) : (
                                <div className="h-32 flex flex-col items-center justify-center text-white/30 gap-2">
                                    <Globe size={24} className="opacity-50" />
                                    <p className="text-sm">No players online (or hidden by server)</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ServerBrowser() {
    const [servers, setServers] = useState<GameServer[]>([]);
    const [steamInfo, setSteamInfo] = useState<SteamInfo | null>(null);
    const [supportedGames, setSupportedGames] = useState<SupportedGame[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [scanText, setScanText] = useState('Initializing scan...');
    const [copiedIp, setCopiedIp] = useState<string | null>(null);
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [showSupportedGames, setShowSupportedGames] = useState(false);
    const [filterGame, setFilterGame] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedServer, setSelectedServer] = useState<GameServer | null>(null);
    const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchServers = useCallback(async () => {
        try {
            const res = await fetch('/api/game/servers');
            if (res.ok) {
                const data = await res.json();
                setServers(data);
            }
        } catch (e) {
            console.error('Failed to fetch game servers', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchSteamInfo = useCallback(async () => {
        try {
            const res = await fetch('/api/steam/info');
            if (res.ok) setSteamInfo(await res.json());
        } catch (e) { /* ignore */ }
    }, []);

    const fetchSupportedGames = useCallback(async () => {
        try {
            const res = await fetch('/api/game/supported');
            if (res.ok) setSupportedGames(await res.json());
        } catch (e) { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchServers();
        fetchSteamInfo();
        fetchSupportedGames();
        const interval = setInterval(fetchServers, 15000);
        return () => clearInterval(interval);
    }, [fetchServers, fetchSteamInfo, fetchSupportedGames]);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await fetchServers();
        setIsRefreshing(false);
    };

    const handleDeepScan = async () => {
        setIsScanning(true);
        setScanProgress(0);
        setScanText('Initializing deep scan...');

        // Animate progress with realistic-feeling phase text
        const phases = [
            { at: 5,  text: 'Enumerating Tailscale peers...' },
            { at: 15, text: 'Probing Valve query protocol...' },
            { at: 30, text: 'Scanning Minecraft ports...' },
            { at: 45, text: 'Checking Source engine servers...' },
            { at: 60, text: 'Querying survival game ports...' },
            { at: 75, text: 'Scanning additional game types...' },
            { at: 88, text: 'Finalizing results...' },
        ];

        let currentProgress = 0;
        scanIntervalRef.current = setInterval(() => {
            currentProgress += Math.random() * 3 + 1;
            if (currentProgress > 95) currentProgress = 95;
            setScanProgress(currentProgress);
            const phase = [...phases].reverse().find(p => currentProgress >= p.at);
            if (phase) setScanText(phase.text);
        }, 120);

        try {
            const res = await fetch('/api/game/servers/scan', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setServers(data);
                } else {
                    await fetchServers();
                }
            }
        } catch (e) {
            console.error('Scan failed', e);
        } finally {
            if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
            setScanProgress(100);
            setScanText('Scan complete!');
            setTimeout(() => {
                setIsScanning(false);
                setScanProgress(0);
            }, 600);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedIp(text);
        setTimeout(() => setCopiedIp(null), 2000);
    };

    const getGameColor = (gameType: string) => GAME_COLORS[gameType] || DEFAULT_COLOR;
    const getGameIcon = (gameType: string) => GAME_ICONS[gameType] || '🎮';

    // Filter + search
    let filteredServers = filterGame === 'all' ? servers : servers.filter(s => s.gameType === filterGame);
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredServers = filteredServers.filter(s =>
            s.name?.toLowerCase().includes(q) ||
            s.hostName?.toLowerCase().includes(q) ||
            s.displayName?.toLowerCase().includes(q) ||
            s.map?.toLowerCase().includes(q)
        );
    }
    const uniqueGameTypes = [...new Set(servers.map(s => s.gameType))];

    // Get Steam header image URL
    const getSteamHeaderUrl = (appId: string | null | undefined) => {
        if (!appId) return null;
        return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
    };

    const totalPlayers = servers.reduce((a, s) => a + (s.players?.online || 0), 0);

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-white/50 space-y-4 min-h-[400px]">
                <div className="relative">
                    <Wifi className="text-theme-text animate-pulse" size={48} />
                    <div className="absolute inset-0 animate-ping">
                        <Wifi className="text-theme-text/30" size={48} />
                    </div>
                </div>
                <span className="text-lg font-medium animate-pulse">Scanning Tailscale Network...</span>
                <span className="text-xs text-white/30">Checking game server ports across all peers</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-300">
            {isScanning && <ScanningOverlay progress={scanProgress} scanningText={scanText} />}
            {selectedServer && <ServerDetailsModal server={selectedServer} onClose={() => setSelectedServer(null)} />}

            <div className="mb-4 mt-2 pl-2 flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight mb-1 flex items-center gap-3">
                        <Gamepad2 className="text-theme-text" size={32} />
                        Network Game Servers
                    </h1>
                    <p className="text-white/50 text-sm flex items-center gap-2 flex-wrap">
                        Auto-detected on your Tailscale network
                        {steamInfo?.installed && (
                            <span className="inline-flex items-center gap-1.5 bg-[#1b2838]/60 text-[#66c0f4] text-[10px] font-bold px-2 py-0.5 rounded-md border border-[#66c0f4]/20 uppercase tracking-wider">
                                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658a3.387 3.387 0 0 1 1.912-.593c.064 0 .127.003.19.008l2.861-4.142V8.91a4.528 4.528 0 0 1 4.524-4.524 4.528 4.528 0 0 1 4.524 4.524 4.528 4.528 0 0 1-4.524 4.524h-.105l-4.076 2.91c0 .052.004.105.004.159a3.392 3.392 0 0 1-3.39 3.39 3.406 3.406 0 0 1-3.323-2.727L.436 15.27A12.013 12.013 0 0 0 11.98 24c6.627 0 12-5.373 12-12S18.607 0 11.979 0z"/></svg>
                                Steam Connected
                                {steamInfo.personaName && <span className="text-white/60 normal-case">· {steamInfo.personaName}</span>}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2 mt-1 mr-2">
                    <button
                        onClick={handleDeepScan}
                        disabled={isScanning}
                        className="flex items-center gap-1.5 px-3 py-2 bg-theme/15 hover:bg-theme/25 text-theme-text border border-theme/20 rounded-xl transition-all text-xs font-medium disabled:opacity-50 hover:shadow-[0_0_20px_rgba(99,102,241,0.2)]"
                        title="Force a full network rescan"
                    >
                        <Zap size={14} />
                        Deep Scan
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="p-2.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl transition-all border border-white/5 disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="mx-2 mb-3 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-4 text-xs text-white/40 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2">
                    <span className="flex items-center gap-1.5">
                        <Radio size={12} className="text-emerald-400" />
                        <span className="text-white/70 font-bold">{servers.length}</span> server{servers.length !== 1 ? 's' : ''} found
                    </span>
                    <span className="w-px h-4 bg-white/10" />
                    <span className="flex items-center gap-1.5">
                        <Users size={12} className="text-theme-text" />
                        <span className="text-white/70 font-bold">{totalPlayers}</span> player{totalPlayers !== 1 ? 's' : ''} online
                    </span>
                    {steamInfo?.installed && (
                        <>
                            <span className="w-px h-4 bg-white/10" />
                            <span className="flex items-center gap-1.5">
                                <MonitorUp size={12} className="text-[#66c0f4]" />
                                Scanning <span className="text-white/70 font-bold">{steamInfo.supportedGamesScanning}</span> game types
                            </span>
                        </>
                    )}
                </div>
                {steamInfo?.installed && steamInfo.installedGames.length > 0 && (
                    <button
                        onClick={() => setShowSupportedGames(!showSupportedGames)}
                        className="text-white/40 hover:text-white/70 transition-colors text-xs flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 hover:bg-white/[0.06]"
                    >
                        {showSupportedGames ? 'Hide Games' : 'View Supported Games'}
                        {showSupportedGames ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                )}
            </div>

            {showSupportedGames && (
                <div className="mx-2 mb-4 bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 max-h-[300px] overflow-y-auto animate-in slide-in-from-top-2 duration-200">
                    <h3 className="text-white/70 text-xs font-bold uppercase tracking-wider mb-3">Supported Games Being Scanned</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {supportedGames.map(game => (
                            <div key={game.type} className="flex items-center gap-2 bg-black/30 rounded-lg p-2 hover:bg-black/50 transition-colors">
                                <span className="text-base">{getGameIcon(game.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-white/80 text-xs font-medium truncate block">{game.name}</span>
                                    <span className="text-white/30 text-[10px]">Port {game.defaultPort}</span>
                                </div>
                                {game.installed === true && (
                                    <span className="text-emerald-400 text-[9px] font-bold bg-emerald-400/10 px-1.5 py-0.5 rounded shrink-0">INSTALLED</span>
                                )}
                                {game.hasJoinUrl && (
                                    <ExternalLink size={10} className="text-theme-text/50 shrink-0" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {servers.length > 0 && (
                <div className="mx-2 mb-4 flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search servers..."
                            className="bg-white/5 border border-white/10 rounded-lg text-white/80 text-xs pl-8 pr-3 py-1.5 w-44 placeholder:text-white/25 focus:outline-none focus:border-theme/30 transition-colors"
                        />
                    </div>
                    {uniqueGameTypes.length > 1 && (
                        <>
                            <span className="w-px h-5 bg-white/10" />
                            <button
                                onClick={() => setFilterGame('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterGame === 'all' ? 'bg-theme/20 text-theme-text border border-theme/20' : 'bg-white/5 text-white/50 border border-white/5 hover:bg-white/10'}`}
                            >
                                All ({servers.length})
                            </button>
                            {uniqueGameTypes.map(gt => {
                                const count = servers.filter(s => s.gameType === gt).length;
                                const color = getGameColor(gt);
                                const displayName = servers.find(s => s.gameType === gt)?.displayName || gt;
                                return (
                                    <button
                                        key={gt}
                                        onClick={() => setFilterGame(gt)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${filterGame === gt ? `${color.bg.replace('from-', 'bg-')} ${color.text} border border-current/20` : 'bg-white/5 text-white/50 border border-white/5 hover:bg-white/10'}`}
                                    >
                                        <span>{getGameIcon(gt)}</span>
                                        {displayName} ({count})
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            {filteredServers.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center min-h-[300px]">
                    <div className="bg-white/5 p-6 rounded-full mb-6 border border-white/10">
                        <Gamepad2 className="text-white/20" size={64} />
                    </div>
                    <h3 className="text-white/80 font-bold text-2xl mb-2">
                        {servers.length > 0 ? 'No Servers Match Filter' : 'No Game Servers Found'}
                    </h3>
                    <p className="text-white/40 text-sm max-w-md leading-relaxed mb-6">
                        {servers.length > 0
                            ? 'Try selecting a different filter, adjusting your search, or scanning again.'
                            : 'Auto-detection is running on your Tailscale network. Start a game server on any peer, or open a Minecraft LAN world to see it here.'}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDeepScan}
                            disabled={isScanning}
                            className="flex items-center gap-2 bg-theme/20 hover:bg-theme/30 text-theme-text border border-theme/20 px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50"
                        >
                            <Zap size={16} />
                            Deep Scan Network
                        </button>
                        <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/60 border border-white/5 px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                            Quick Refresh
                        </button>
                    </div>
                </div>
            )}

            {filteredServers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-12 px-1 overflow-y-auto">
                    {filteredServers.map((server, idx) => {
                        const connectString = `${server.ip}:${server.port}`;
                        const color = getGameColor(server.gameType);
                        const icon = getGameIcon(server.gameType);
                        const isExpanded = expandedServer === connectString;
                        const headerImg = getSteamHeaderUrl(server.steamAppId);
                        const playerPercent = server.players.max > 0 ? (server.players.online / server.players.max) * 100 : 0;

                        return (
                            <div
                                key={`${connectString}-${idx}`}
                                onClick={() => setSelectedServer(server)}
                                className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] ${color.border} rounded-2xl overflow-hidden transition-all duration-300 flex flex-col hover:scale-[1.01] cursor-pointer`}
                                style={{ boxShadow: `0 0 30px ${color.glow}` }}
                            >
                                {headerImg && (
                                    <div className="relative h-20 overflow-hidden">
                                        <img
                                            src={headerImg}
                                            alt=""
                                            className="w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity duration-300"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0f0f17]" />
                                        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md">
                                            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                                            <span className="text-emerald-400 text-[9px] font-bold uppercase tracking-wider">Live</span>
                                        </div>
                                    </div>
                                )}

                                <div className="p-4 flex-1 flex flex-col">
                                    <div className="flex items-start justify-between mb-2.5 gap-3">
                                        <div className={`flex items-center gap-1.5 ${color.text} text-[10px] font-bold uppercase tracking-widest bg-black/40 px-2.5 py-1 rounded-lg border border-current/10`}>
                                            <span className="text-sm">{icon}</span>
                                            {server.displayName || server.game}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {server.version && (
                                                <span className="text-white/30 text-[9px] font-mono bg-black/30 px-1.5 py-0.5 rounded">{server.version}</span>
                                            )}
                                            {server.ping !== undefined && (
                                                <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md tracking-wider ${
                                                    server.ping < 50 ? 'text-emerald-400 bg-emerald-400/10' :
                                                    server.ping < 100 ? 'text-amber-400 bg-amber-400/10' :
                                                    'text-red-400 bg-red-400/10'
                                                }`}>
                                                    <Activity size={10} />
                                                    {server.ping}ms
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <h3 className="text-white font-bold text-base leading-snug mb-1 line-clamp-2">
                                        {server.name || 'Unnamed Server'}
                                    </h3>

                                    {server.hostName && (
                                        <span className="text-white/30 text-[11px] mb-2 flex items-center gap-1">
                                            <Wifi size={10} />
                                            Hosted by {server.hostName}
                                        </span>
                                    )}

                                    {server.modPack && (
                                        <span className="text-purple-400 text-[10px] font-medium bg-purple-400/10 px-2 py-0.5 rounded-md w-fit mb-2">
                                            {server.modPack}
                                        </span>
                                    )}

                                    <div className="flex items-center justify-between mb-3 mt-auto pt-2">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 text-white/70 text-xs">
                                                <Users size={14} />
                                                <span className="font-bold text-white/90">{server.players.online}</span>
                                                <span className="text-white/40">/ {server.players.max}</span>
                                            </div>
                                            {server.players.max > 0 && (
                                                <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            playerPercent > 80 ? 'bg-red-400' :
                                                            playerPercent > 50 ? 'bg-amber-400' :
                                                            'bg-emerald-400'
                                                        }`}
                                                        style={{ width: `${Math.min(playerPercent, 100)}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        {server.map && (
                                            <div className="flex items-center gap-1.5 text-white/40 text-[10px] uppercase font-bold tracking-wider bg-black/30 px-2 py-1 rounded text-right truncate max-w-[140px]">
                                                <Globe size={10} className="shrink-0" />
                                                <span className="truncate">{server.map}</span>
                                            </div>
                                        )}
                                    </div>

                                    {server.players.list && server.players.list.length > 0 && (
                                        <div className="mb-3">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setExpandedServer(isExpanded ? null : connectString); }}
                                                className="text-white/40 hover:text-white/60 text-[10px] font-medium flex items-center gap-1 transition-colors"
                                            >
                                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                {server.players.list.length} player{server.players.list.length !== 1 ? 's' : ''} online
                                            </button>
                                            {isExpanded && (
                                                <div className="mt-1.5 bg-black/30 rounded-lg p-2 flex flex-wrap gap-1.5 animate-in slide-in-from-top-1 duration-150">
                                                    {server.players.list.map((name, i) => (
                                                        <span key={i} className="text-white/60 text-[11px] bg-white/5 px-2 py-0.5 rounded-md">
                                                            {name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                                        <div className="flex-1 flex items-center justify-between bg-black/40 rounded-lg p-1.5 pl-3 overflow-hidden">
                                            <span className="text-xs text-white/50 font-mono truncate mr-2 select-all">
                                                {connectString}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleCopy(connectString); }}
                                                className="text-white/40 hover:text-white hover:bg-white/10 p-1.5 rounded-md transition-colors shrink-0"
                                                title="Copy IP:Port"
                                            >
                                                {copiedIp === connectString ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                            </button>
                                        </div>

                                        {server.joinUrl && (
                                            <a
                                                href={server.joinUrl}
                                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all text-xs font-bold shrink-0 ${
                                                    server.joinUrl.startsWith('steam://')
                                                        ? 'bg-[#1b2838] hover:bg-[#2a475e] text-[#66c0f4] border border-[#66c0f4]/20 shadow-[0_0_15px_rgba(102,192,244,0.1)] hover:shadow-[0_0_20px_rgba(102,192,244,0.2)]'
                                                        : 'bg-theme hover:bg-theme/80 text-white shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]'
                                                }`}
                                                title="Join Game"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <ExternalLink size={14} />
                                                Join
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
