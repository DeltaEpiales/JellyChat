import { useState, useEffect, useCallback } from 'react';
import { Gamepad2, Users, Activity, Copy, Check, ExternalLink, Globe, RefreshCw, Wifi, ChevronDown, ChevronUp, MonitorUp, Zap } from 'lucide-react';

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
};

// Game color theming
const GAME_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    minecraft:      { bg: 'from-emerald-500/15', border: 'hover:border-emerald-500/40', text: 'text-emerald-400', glow: 'rgba(52,211,153,0.15)' },
    garrysmod:      { bg: 'from-blue-500/15',    border: 'hover:border-blue-500/40',    text: 'text-blue-400',    glow: 'rgba(59,130,246,0.15)' },
    counterstrike2: { bg: 'from-amber-500/15',   border: 'hover:border-amber-500/40',   text: 'text-amber-400',   glow: 'rgba(245,158,11,0.15)' },
    teamfortress2:  { bg: 'from-orange-500/15',  border: 'hover:border-orange-500/40',  text: 'text-orange-400',  glow: 'rgba(249,115,22,0.15)' },
    rust:           { bg: 'from-red-500/15',     border: 'hover:border-red-500/40',     text: 'text-red-400',     glow: 'rgba(248,113,113,0.15)' },
    valheim:        { bg: 'from-cyan-500/15',    border: 'hover:border-cyan-500/40',    text: 'text-cyan-400',    glow: 'rgba(34,211,238,0.15)' },
};

const DEFAULT_COLOR = { bg: 'from-indigo-500/15', border: 'hover:border-indigo-500/40', text: 'text-indigo-400', glow: 'rgba(99,102,241,0.15)' };

export function ServerBrowser() {
    const [servers, setServers] = useState<GameServer[]>([]);
    const [steamInfo, setSteamInfo] = useState<SteamInfo | null>(null);
    const [supportedGames, setSupportedGames] = useState<SupportedGame[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [copiedIp, setCopiedIp] = useState<string | null>(null);
    const [expandedServer, setExpandedServer] = useState<string | null>(null);
    const [showSupportedGames, setShowSupportedGames] = useState(false);
    const [filterGame, setFilterGame] = useState<string>('all');

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
        try {
            const res = await fetch('/api/game/servers/scan', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setServers(data);
                } else {
                    // Throttled response, just refresh normally
                    await fetchServers();
                }
            }
        } catch (e) {
            console.error('Scan failed', e);
        } finally {
            setIsScanning(false);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedIp(text);
        setTimeout(() => setCopiedIp(null), 2000);
    };

    const getGameColor = (gameType: string) => GAME_COLORS[gameType] || DEFAULT_COLOR;
    const getGameIcon = (gameType: string) => GAME_ICONS[gameType] || '🎮';

    const filteredServers = filterGame === 'all' ? servers : servers.filter(s => s.gameType === filterGame);
    const uniqueGameTypes = [...new Set(servers.map(s => s.gameType))];

    // Get Steam header image URL
    const getSteamHeaderUrl = (appId: string | null | undefined) => {
        if (!appId) return null;
        return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
    };

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-white/50 space-y-4 min-h-[400px]">
                <div className="relative">
                    <Wifi className="text-indigo-400 animate-pulse" size={48} />
                    <div className="absolute inset-0 animate-ping">
                        <Wifi className="text-indigo-400/30" size={48} />
                    </div>
                </div>
                <span className="text-lg font-medium animate-pulse">Scanning Tailscale Network...</span>
                <span className="text-xs text-white/30">Checking game server ports across all peers</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-300">
            {/* Header */}
            <div className="mb-6 mt-2 pl-2 flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight mb-1 flex items-center gap-3">
                        <Gamepad2 className="text-indigo-400" size={32} />
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
                        className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/20 rounded-xl transition-all text-xs font-medium disabled:opacity-50"
                        title="Force a full network rescan"
                    >
                        <Zap size={14} className={isScanning ? 'animate-pulse' : ''} />
                        {isScanning ? 'Scanning...' : 'Deep Scan'}
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

            {/* Steam Info Banner */}
            {steamInfo?.installed && steamInfo.installedGames.length > 0 && (
                <div className="mx-2 mb-4 bg-gradient-to-r from-[#1b2838]/40 to-[#2a475e]/30 border border-[#66c0f4]/10 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#66c0f4]/10 p-2 rounded-lg">
                            <MonitorUp className="text-[#66c0f4]" size={18} />
                        </div>
                        <div>
                            <span className="text-white/80 text-sm font-medium">
                                Scanning <span className="text-[#66c0f4] font-bold">{steamInfo.supportedGamesScanning}</span> game types
                            </span>
                            <span className="text-white/40 text-xs block">
                                {steamInfo.installedGames.filter(g => g.canHostServer).length} of your Steam games support server hosting
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowSupportedGames(!showSupportedGames)}
                        className="text-white/40 hover:text-white/70 transition-colors text-xs flex items-center gap-1"
                    >
                        {showSupportedGames ? 'Hide' : 'View Games'}
                        {showSupportedGames ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            )}

            {/* Supported Games Dropdown */}
            {showSupportedGames && (
                <div className="mx-2 mb-4 bg-white/5 border border-white/10 rounded-xl p-4 max-h-[300px] overflow-y-auto">
                    <h3 className="text-white/70 text-xs font-bold uppercase tracking-wider mb-3">Supported Games Being Scanned</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {supportedGames.map(game => (
                            <div key={game.type} className="flex items-center gap-2 bg-black/30 rounded-lg p-2">
                                <span className="text-base">{getGameIcon(game.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <span className="text-white/80 text-xs font-medium truncate block">{game.name}</span>
                                    <span className="text-white/30 text-[10px]">Port {game.defaultPort}</span>
                                </div>
                                {game.installed === true && (
                                    <span className="text-emerald-400 text-[9px] font-bold bg-emerald-400/10 px-1.5 py-0.5 rounded shrink-0">INSTALLED</span>
                                )}
                                {game.hasJoinUrl && (
                                    <ExternalLink size={10} className="text-indigo-400/50 shrink-0" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Filter bar (only show if servers exist) */}
            {servers.length > 0 && uniqueGameTypes.length > 1 && (
                <div className="mx-2 mb-4 flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setFilterGame('all')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterGame === 'all' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/20' : 'bg-white/5 text-white/50 border border-white/5 hover:bg-white/10'}`}
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
                </div>
            )}

            {/* Empty state */}
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
                            ? 'Try selecting a different filter or scanning again.'
                            : 'Auto-detection is running on your Tailscale network. Start a game server on any peer, or open a Minecraft LAN world to see it here.'}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleDeepScan}
                            disabled={isScanning}
                            className="flex items-center gap-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 border border-indigo-500/20 px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50"
                        >
                            <Zap size={16} className={isScanning ? 'animate-pulse' : ''} />
                            {isScanning ? 'Scanning Network...' : 'Deep Scan Network'}
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

            {/* Server Grid */}
            {filteredServers.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-12 px-1">
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
                                className={`group relative bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] ${color.border} rounded-2xl overflow-hidden transition-all duration-300 flex flex-col`}
                                style={{ boxShadow: `0 0 30px ${color.glow}` }}
                            >
                                {/* Steam header image banner */}
                                {headerImg && (
                                    <div className="relative h-20 overflow-hidden">
                                        <img
                                            src={headerImg}
                                            alt=""
                                            className="w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity duration-300"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0f0f17]" />
                                    </div>
                                )}

                                <div className="p-4 flex-1 flex flex-col">
                                    {/* Game badge + ping */}
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

                                    {/* Server name */}
                                    <h3 className="text-white font-bold text-base leading-snug mb-1 line-clamp-2">
                                        {server.name || 'Unnamed Server'}
                                    </h3>

                                    {/* Host info */}
                                    {server.hostName && (
                                        <span className="text-white/30 text-[11px] mb-2 flex items-center gap-1">
                                            <Wifi size={10} />
                                            Hosted by {server.hostName}
                                        </span>
                                    )}

                                    {/* Players + Map row */}
                                    <div className="flex items-center justify-between mb-3 mt-auto pt-2">
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center gap-1.5 text-white/70 text-xs">
                                                <Users size={14} />
                                                <span className="font-bold text-white/90">{server.players.online}</span>
                                                <span className="text-white/40">/ {server.players.max}</span>
                                            </div>
                                            {/* Player bar */}
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

                                    {/* Player list (expandable) */}
                                    {server.players.list && server.players.list.length > 0 && (
                                        <div className="mb-3">
                                            <button
                                                onClick={() => setExpandedServer(isExpanded ? null : connectString)}
                                                className="text-white/40 hover:text-white/60 text-[10px] font-medium flex items-center gap-1 transition-colors"
                                            >
                                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                {server.players.list.length} player{server.players.list.length !== 1 ? 's' : ''} online
                                            </button>
                                            {isExpanded && (
                                                <div className="mt-1.5 bg-black/30 rounded-lg p-2 flex flex-wrap gap-1.5">
                                                    {server.players.list.map((name, i) => (
                                                        <span key={i} className="text-white/60 text-[11px] bg-white/5 px-2 py-0.5 rounded-md">
                                                            {name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Connect bar */}
                                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                                        <div className="flex-1 flex items-center justify-between bg-black/40 rounded-lg p-1.5 pl-3 overflow-hidden">
                                            <span className="text-xs text-white/50 font-mono truncate mr-2 select-all">
                                                {connectString}
                                            </span>
                                            <button
                                                onClick={() => handleCopy(connectString)}
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
                                                        : 'bg-indigo-500 hover:bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]'
                                                }`}
                                                title="Join Game"
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
