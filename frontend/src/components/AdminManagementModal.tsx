import React, { useState, useEffect } from 'react';
import { X, Shield, Plus, Users, Bot } from 'lucide-react';

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
}

export function AdminManagementModal({ onClose }: Props) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [assignments, setAssignments] = useState<DeviceAssignment[]>([]);
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileAvatar, setNewProfileAvatar] = useState('');
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
                    isAdmin: false
                })
            });
            if (res.ok) {
                setNewProfileName('');
                setNewProfileAvatar('');
                fetchData();
            }
        } catch (e) {
            console.error('Failed to create profile', e);
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
                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Shield className="text-indigo-400" />
                        Admin Dashboard
                    </h2>
                    <button onClick={onClose} className="p-2 text-white/50 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex border-b border-white/10 bg-black/20 px-4">
                    <button 
                        onClick={() => setActiveTab('users')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'users' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-white/50 hover:text-white/80'}`}
                    >
                        <Users size={16} /> User Management
                    </button>
                    <button 
                        onClick={() => setActiveTab('ai')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'ai' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-white/50 hover:text-white/80'}`}
                    >
                        <Bot size={16} /> AI Integrations
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 space-y-6">
                    {isLoading ? (
                        <div className="text-white/50 text-center py-8">Loading administration data...</div>
                    ) : activeTab === 'users' ? (
                        <>
                            {/* Device Assignments */}
                            <div>
                                <h3 className="text-white/80 font-medium mb-3">Known Devices</h3>
                                <div className="space-y-2">
                                    {assignments.map(a => (
                                        <div key={a.ip} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="font-mono text-sm text-indigo-300 bg-indigo-500/20 px-2 py-1 rounded">
                                                    {a.ip}
                                                </div>
                                            </div>
                                            <select 
                                                value={a.profileId}
                                                onChange={(e) => handleAssignDevice(a.ip, e.target.value)}
                                                className="bg-white/5 border border-white/10 text-white text-sm rounded-lg p-2 focus:outline-none focus:border-indigo-500"
                                            >
                                                {profiles.map(p => (
                                                    <option key={p.id} value={p.id} className="bg-slate-800">{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Profiles Management */}
                            <div className="border-t border-white/10 pt-6">
                                <h3 className="text-white/80 font-medium mb-3">Profiles Database</h3>
                                
                                <form onSubmit={handleCreateProfile} className="flex gap-2 mb-4">
                                    <input 
                                        type="text"
                                        placeholder="Display Name"
                                        value={newProfileName}
                                        onChange={e => setNewProfileName(e.target.value)}
                                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30"
                                        required
                                    />
                                    <input 
                                        type="url"
                                        placeholder="Avatar URL (optional)"
                                        value={newProfileAvatar}
                                        onChange={e => setNewProfileAvatar(e.target.value)}
                                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30"
                                    />
                                    <button type="submit" className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2">
                                        <Plus size={18} /> Add
                                    </button>
                                </form>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {profiles.map(p => (
                                        <div key={p.id} className="flex items-center gap-3 p-3 bg-black/40 border border-white/5 rounded-xl">
                                            {p.avatar ? (
                                                <img src={p.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold">
                                                    {p.name.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-white text-sm font-medium truncate flex items-center gap-2">
                                                    {p.name}
                                                    {p.isAdmin === 1 && <Shield size={12} className="text-yellow-400" />}
                                                </div>
                                                <div className="text-white/40 text-xs truncate font-mono">{p.id}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-6">
                            <div className="p-4 rounded-xl border border-white/5 bg-black/40 space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-indigo-400" />
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
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500"
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
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500"
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
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 appearance-none"
                                    >
                                        <option value="">Auto-select first available</option>
                                        {availableModels.map(m => (
                                            <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            <div className="p-4 rounded-xl border border-white/5 bg-black/40 space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-indigo-400" />
                                    Multi-Agent Configuration
                                </h3>
                                
                                {/* Agent 1 */}
                                <div className="border border-white/10 p-3 rounded-lg bg-white/5">
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
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
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
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
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
                                <div className="border border-white/10 p-3 rounded-lg bg-white/5">
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
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
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
                                                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
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

                            <div className="p-4 rounded-xl border border-white/5 bg-black/40 space-y-4">
                                <h3 className="text-white/80 font-medium flex items-center gap-2">
                                    <Bot size={18} className="text-indigo-400" />
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
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500"
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
