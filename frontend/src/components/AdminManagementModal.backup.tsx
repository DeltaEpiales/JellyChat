import React, { useState, useEffect } from 'react';
import { X, Shield, Plus, Users, Bot, Trash2 } from 'lucide-react';

interface Profile {
    id: string;
    name: string;
    avatar: string;
    isAdmin: number;
}

interface DeviceAssignment {
    ip: string;
    profileId: string;
}

interface Props {
    onClose: () => void;
    peers: any[];
}

export function AdminManagementModal({ onClose, peers }: Props) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [assignments, setAssignments] = useState<DeviceAssignment[]>([]);
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileAvatar, setNewProfileAvatar] = useState('');
    const [newProfileIsAdmin, setNewProfileIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users'|'ai'>('users');
    
    // AI Settings State
    const [aiSettings, setAiSettings] = useState({
        openwebui_url: '',
        openwebui_api_key: '',
        openwebui_model: '',
        agent1_name: '',
        agent1_model: '',
        agent2_name: '',
        agent2_model: '',
        comfyui_url: ''
    });

    const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>([]);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [profRes, assignRes, settingsRes] = await Promise.all([
                fetch('/api/profiles'),
                fetch('/api/assignments'),
                fetch('/api/settings')
            ]);
            setProfiles(await profRes.json());
            setAssignments(await assignRes.json());
            const settingsData = await settingsRes.json();
            setAiSettings({
                openwebui_url: settingsData.openwebui_url || '',
                openwebui_api_key: settingsData.openwebui_api_key || '',
                openwebui_model: settingsData.openwebui_model || '',
                agent1_name: settingsData.agent1_name || 'Mimir',
                agent1_model: settingsData.agent1_model || '',
                agent2_name: settingsData.agent2_name || 'Jarvis',
                agent2_model: settingsData.agent2_model || '',
                comfyui_url: settingsData.comfyui_url || ''
            });

            // Fetch models from our backend proxy
            try {
                const modelsRes = await fetch('/api/models');
                if (modelsRes.ok) {
                    const modelsData = await modelsRes.json();
                    if (modelsData.data) {
                        setAvailableModels(modelsData.data);
                    }
                }
            } catch(e) {
                console.warn('Failed to fetch models', e);
            }
        } catch (e) {
            console.error('Failed to fetch admin data', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProfileName) return;
        
        const id = 'user_' + Date.now();
        try {
            const res = await fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id,
                    name: newProfileName,
                    avatar: newProfileAvatar,
                    isAdmin: newProfileIsAdmin ? 1 : 0
                })
            });
            if (res.ok) {
                setNewProfileName('');
                setNewProfileAvatar('');
                setNewProfileIsAdmin(false);
                fetchData();
            }
        } catch (e) {
            console.error('Failed to create profile', e);
        }
    };

    const handleToggleAdmin = async (id: string, currentAdmin: number) => {
        try {
            await fetch(`/api/profiles/${id}/admin`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isAdmin: currentAdmin ? 0 : 1 })
            });
            fetchData();
        } catch (e) {
            console.error('Failed to toggle admin status', e);
        }
    };

    const handleAssignDevice = async (ip: string, profileId: string) => {
        try {
            await fetch('/api/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, profileId })
            });
            fetchData();
        } catch (e) {
            console.error('Failed to assign device', e);
        }
    };

    const handleDeleteProfile = async (id: string) => {
        if (!confirm('Delete this profile and unassign its devices?')) return;
        try {
            await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
            fetchData();
        } catch(e) { console.error(e); }
    };

    const handleDeleteAssignment = async (ip: string) => {
        if (!confirm('Delete this device assignment?')) return;
        try {
            await fetch(`/api/assignments/${ip}`, { method: 'DELETE' });
            fetchData();
        } catch(e) { console.error(e); }
    };

    const handleSaveAiSetting = async (key: string, value: string) => {
        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
        } catch (e) {
            console.error('Failed to save AI setting', e);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
            <div className="bg-slate-900/90 border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-white/10 flex justify-between items-center glass-card">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Shield className="text-theme-text" />
                        Admin Dashboard
                    </h2>
                    <button onClick={onClose} className="p-2 text-white/50 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex border-b border-white/10 glass-card px-4">
                    <button 
                        onClick={() => setActiveTab('users')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'users' ? 'border-theme text-theme-text' : 'border-transparent text-white/50 hover:text-white/80'}`}
                    >
                        <Users size={16} /> User Management
                    </button>
                    <button 
                        onClick={() => setActiveTab('ai')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'ai' ? 'border-theme text-theme-text' : 'border-transparent text-white/50 hover:text-white/80'}`}
                    >
                        <Bot size={16} /> AI Integrations
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-6">
                    {isLoading ? (
                        <div className="text-white/50 text-center py-8">Loading administration data...</div>
                    ) : activeTab === 'users' ? (
                        <>
                            {/* Profiles Management */}
                            <div className="space-y-6">
                                <form onSubmit={handleCreateProfile} className="flex flex-col gap-2 glass-card p-4 rounded-xl border border-white/10">
                                    <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            placeholder="New Profile Name"
                                            value={newProfileName}
                                            onChange={e => setNewProfileName(e.target.value)}
                                            className="flex-1 glass-card border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30"
                                            required
                                        />
                                        <input 
                                            type="url"
                                            placeholder="Avatar URL (optional)"
                                            value={newProfileAvatar}
                                            onChange={e => setNewProfileAvatar(e.target.value)}
                                            className="flex-1 glass-card border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30"
                                        />
                                        <button type="submit" className="bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_15px_var(--color-theme-glow)] border-none hover:bg-theme-alt/80 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2">
                                            <Plus size={18} /> Add
                                        </button>
                                    </div>
                                    <label className="flex items-center gap-2 text-white/70 text-sm mt-1 w-fit cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={newProfileIsAdmin} 
                                            onChange={(e) => setNewProfileIsAdmin(e.target.checked)} 
                                            className="rounded bg-white/10 border-white/20 text-theme"
                                        />
                                        Grant Administrator privileges
                                    </label>
                                </form>

                                <div className="space-y-4">
                                    {profiles.map(p => {
                                        const devices = assignments.filter(a => a.profileId === p.id);
                                        return (
                                            <div key={p.id} className="glass-card border border-white/5 rounded-xl overflow-hidden">
                                                <div className="p-3 glass-card border-b border-white/5 flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        {p.avatar ? (
                                                            <img src={p.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                                                        ) : (
                                                            <div className="w-8 h-8 rounded-full bg-theme/20 text-theme-text/80 flex items-center justify-center font-bold">
                                                                {p.name.charAt(0).toUpperCase()}
                                                            </div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-white text-sm font-medium truncate flex items-center gap-2">
                                                                {p.name}
                                                                {p.isAdmin === 1 && <Shield size={12} className="text-yellow-400" />}
                                                            </div>
                                                            <div className="text-white/40 text-[10px] truncate font-mono">{p.id}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer hover:text-white transition-colors">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={p.isAdmin === 1}
                                                                onChange={() => handleToggleAdmin(p.id, p.isAdmin)}
                                                                className="rounded glass-card border-white/10 text-theme"
                                                            />
                                                            Admin
                                                        </label>
                                                        <button onClick={() => handleDeleteProfile(p.id)} className="text-rose-400 hover:bg-white/10 p-2 rounded-lg transition-colors">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="p-2 space-y-1">
                                                    {devices.length === 0 ? (
                                                        <div className="text-white/30 text-xs px-2 py-1">No devices assigned</div>
                                                    ) : devices.map(d => (
                                                        <div key={d.ip} className="flex items-center justify-between glass-card p-2 rounded-lg border border-white/5 pl-8 relative">
                                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-[1px] bg-white/10"></div>
                                                            <div className="absolute left-3 top-0 h-1/2 w-[1px] bg-white/10"></div>
                                                            <div className="font-mono text-xs text-theme-text/80 bg-theme/10 px-2 py-0.5 rounded">
                                                                {d.ip}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <select 
                                                                    value={d.profileId}
                                                                    onChange={(e) => handleAssignDevice(d.ip, e.target.value)}
                                                                    className="glass-card border border-white/10 text-white text-[11px] rounded p-1 focus:outline-none focus:border-theme"
                                                                >
                                                                    {profiles.map(opt => (
                                                                        <option key={opt.id} value={opt.id} className="bg-slate-800">{opt.name}</option>
                                                                    ))}
                                                                </select>
                                                                <button onClick={() => handleDeleteAssignment(d.ip)} className="text-rose-400/70 hover:text-rose-400 hover:bg-white/10 p-1 rounded transition-colors">
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            
                            {/* Unassigned Devices */}
                            <div className="space-y-4 pt-6 border-t border-white/10">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Users size={18} className="text-rose-400" />
                                    Unassigned Devices (Online)
                                </h3>
                                <div className="space-y-2">
                                    {peers.filter(p => !assignments.some(a => a.ip === p.ip)).length === 0 ? (
                                        <div className="text-white/30 text-sm py-4 text-center glass-card rounded-xl border border-white/5">
                                            No unassigned devices currently online.
                                        </div>
                                    ) : (
                                        peers.filter(p => !assignments.some(a => a.ip === p.ip)).map(p => (
                                            <div key={p.ip} className="flex items-center justify-between glass-card p-3 rounded-xl border border-white/5">
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-sm font-medium text-white truncate">{p.name}</span>
                                                    <span className="font-mono text-[10px] text-rose-300/70">{p.ip}</span>
                                                </div>
                                                <div className="flex items-center gap-2 ml-4">
                                                    <select 
                                                        value=""
                                                        onChange={(e) => {
                                                            if (e.target.value) handleAssignDevice(p.ip, e.target.value);
                                                        }}
                                                        className="glass-card border border-white/10 text-white text-xs rounded-lg p-2 focus:outline-none focus:border-theme"
                                                    >
                                                        <option value="" disabled className="bg-slate-800">Assign to Profile...</option>
                                                        {profiles.map(opt => (
                                                            <option key={opt.id} value={opt.id} className="bg-slate-800">{opt.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-6">
                            <div className="p-4 rounded-xl border border-white/5 glass-card space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-theme-text" />
                                    Open WebUI (Chat AI)
                                </h3>
                                <div>
                                    <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">API URL</label>
                                    <input 
                                        type="url"
                                        value={aiSettings.openwebui_url}
                                        onChange={e => {
                                            setAiSettings({...aiSettings, openwebui_url: e.target.value});
                                            handleSaveAiSetting('openwebui_url', e.target.value);
                                        }}
                                        placeholder="http://localhost:3000"
                                        className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">API Key</label>
                                    <input 
                                        type="password"
                                        value={aiSettings.openwebui_api_key}
                                        onChange={e => {
                                            setAiSettings({...aiSettings, openwebui_api_key: e.target.value});
                                            handleSaveAiSetting('openwebui_api_key', e.target.value);
                                        }}
                                        placeholder="sk-..."
                                        className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme"
                                    />
                                    <p className="text-[10px] text-white/40 mt-1">Leave blank if authentication is not required.</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">Default Model (Fallback)</label>
                                    <select 
                                        value={aiSettings.openwebui_model}
                                        onChange={e => {
                                            setAiSettings({...aiSettings, openwebui_model: e.target.value});
                                            handleSaveAiSetting('openwebui_model', e.target.value);
                                        }}
                                        className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-theme appearance-none"
                                    >
                                        <option value="">Auto-select first available</option>
                                        {availableModels.map(m => (
                                            <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            <div className="p-4 rounded-xl border border-white/5 glass-card space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-theme-text" />
                                    Multi-Agent Configuration
                                </h3>
                                
                                {/* Agent 1 */}
                                <div className="border border-white/10 p-3 rounded-lg glass-card">
                                    <h4 className="text-sm font-bold text-white/70 mb-2">Agent 1 (Primary)</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Trigger Name (e.g. Mimir)</label>
                                            <input 
                                                type="text"
                                                value={aiSettings.agent1_name}
                                                onChange={e => {
                                                    setAiSettings({...aiSettings, agent1_name: e.target.value});
                                                    handleSaveAiSetting('agent1_name', e.target.value);
                                                }}
                                                placeholder="Mimir"
                                                className="w-full glass-card border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-theme"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Specific Model</label>
                                            <select 
                                                value={aiSettings.agent1_model}
                                                onChange={e => {
                                                    setAiSettings({...aiSettings, agent1_model: e.target.value});
                                                    handleSaveAiSetting('agent1_model', e.target.value);
                                                }}
                                                className="w-full glass-card border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-theme appearance-none"
                                            >
                                                <option value="">Use Default Model</option>
                                                {availableModels.map(m => (
                                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Agent 2 */}
                                <div className="border border-white/10 p-3 rounded-lg glass-card">
                                    <h4 className="text-sm font-bold text-white/70 mb-2">Agent 2 (Secondary)</h4>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Trigger Name (e.g. Jarvis)</label>
                                            <input 
                                                type="text"
                                                value={aiSettings.agent2_name}
                                                onChange={e => {
                                                    setAiSettings({...aiSettings, agent2_name: e.target.value});
                                                    handleSaveAiSetting('agent2_name', e.target.value);
                                                }}
                                                placeholder="Jarvis"
                                                className="w-full glass-card border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-theme"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Specific Model</label>
                                            <select 
                                                value={aiSettings.agent2_model}
                                                onChange={e => {
                                                    setAiSettings({...aiSettings, agent2_model: e.target.value});
                                                    handleSaveAiSetting('agent2_model', e.target.value);
                                                }}
                                                className="w-full glass-card border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-theme appearance-none"
                                            >
                                                <option value="">Use Default Model</option>
                                                {availableModels.map(m => (
                                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 rounded-xl border border-white/5 glass-card space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-theme-text" />
                                    ComfyUI (Image AI)
                                </h3>
                                <div>
                                    <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-1.5">API URL</label>
                                    <input 
                                        type="url"
                                        value={aiSettings.comfyui_url}
                                        onChange={e => {
                                            setAiSettings({...aiSettings, comfyui_url: e.target.value});
                                            handleSaveAiSetting('comfyui_url', e.target.value);
                                        }}
                                        placeholder="http://localhost:8188"
                                        className="w-full glass-card border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme"
                                    />
                                    <p className="text-[10px] text-white/40 mt-1">Used for processing @image prompts.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
