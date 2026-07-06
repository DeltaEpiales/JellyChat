import React, { useState, useEffect } from 'react';
import { X, Shield, Plus, Users, Bot, Trash2, MessageSquare } from 'lucide-react';

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
    channels: any[];
}

export function AdminManagementModal({ onClose, peers, channels }: Props) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [assignments, setAssignments] = useState<DeviceAssignment[]>([]);
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileAvatar, setNewProfileAvatar] = useState('');
    const [newProfileIsAdmin, setNewProfileIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users'|'channels'|'ai'>('users');
    
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
            <div className="glass-panel border-0 rounded-[2rem] w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[90vh]">
                
                {/* Sidebar Navigation */}
                <div className="w-full md:w-64 glass-panel border-b md:border-b-0 md:border-r border-white/5 flex flex-col shrink-0 rounded-none bg-black/10">
                    <div className="p-5 border-b border-white/5">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2 drop-shadow-md">
                            <Shield className="text-theme-text" />
                            Admin Console
                        </h2>
                    </div>
                    <div className="p-3 flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-y-auto mt-0 md:mt-2 custom-scrollbar">
                        <button 
                            onClick={() => setActiveTab('users')} 
                            className={`px-4 py-3 rounded-3xl text-sm font-medium flex items-center gap-3 bouncy-transition bouncy-hover ${activeTab === 'users' ? 'bg-gradient-to-r from-theme/20 to-theme-alt/20 text-white shadow-inner border border-white/5' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
                        >
                            <Users size={18} className={activeTab === 'users' ? 'text-theme-text' : ''} /> 
                            Users & Access
                        </button>
                        <button 
                            onClick={() => setActiveTab('channels')} 
                            className={`px-4 py-3 rounded-3xl text-sm font-medium flex items-center gap-3 bouncy-transition bouncy-hover ${activeTab === 'channels' ? 'bg-gradient-to-r from-theme/20 to-theme-alt/20 text-white shadow-inner border border-white/5' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
                        >
                            <MessageSquare size={18} className={activeTab === 'channels' ? 'text-theme-text' : ''} /> 
                            Message Moderation
                        </button>
                        <button 
                            onClick={() => setActiveTab('ai')} 
                            className={`px-4 py-3 rounded-3xl text-sm font-medium flex items-center gap-3 bouncy-transition bouncy-hover ${activeTab === 'ai' ? 'bg-gradient-to-r from-theme/20 to-theme-alt/20 text-white shadow-inner border border-white/5' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
                        >
                            <Bot size={18} className={activeTab === 'ai' ? 'text-theme-text' : ''} /> 
                            AI Integrations
                        </button>
                    </div>
                </div>
                
                {/* Main Content Area */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    <div className="p-5 border-b border-white/5 flex justify-between items-center glass-card rounded-none z-10">
                        <h3 className="font-bold text-white/90 text-lg">
                            {activeTab === 'users' ? 'User Management' : activeTab === 'channels' ? 'Message Moderation' : 'AI Integrations'}
                        </h3>
                        <button onClick={onClose} className="p-2 text-white/50 hover:text-white rounded-full hover:bg-white/10 bouncy-hover">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="p-6 overflow-y-auto flex-1 space-y-6 relative z-0">
                        {isLoading ? (
                            <div className="text-white/50 text-center py-8">Loading administration data...</div>
                        ) : activeTab === 'users' ? (
                            <div className="max-w-3xl mx-auto space-y-6">
                                {/* Profiles Management */}
                                <div className="space-y-6">
                                    <form onSubmit={handleCreateProfile} className="flex flex-col gap-2 glass-card p-4 rounded-3xl border border-white/10 shadow-lg">
                                        <div className="flex flex-col md:flex-row gap-2">
                                            <input 
                                                type="text"
                                                placeholder="New Profile Name"
                                                value={newProfileName}
                                                onChange={e => setNewProfileName(e.target.value)}
                                                className="flex-1 glass-card border border-white/10 rounded-full px-3 py-2 text-white placeholder-white/30"
                                                required
                                            />
                                            <input 
                                                type="url"
                                                placeholder="Avatar URL (optional)"
                                                value={newProfileAvatar}
                                                onChange={e => setNewProfileAvatar(e.target.value)}
                                                className="flex-1 glass-card border border-white/10 rounded-full px-3 py-2 text-white placeholder-white/30"
                                            />
                                            <button type="submit" className="glass-button bouncy-hover px-6 py-2 font-bold flex items-center gap-2">
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
                                                <div key={p.id} className="glass-card border border-white/5 rounded-3xl overflow-hidden shadow-md">
                                                    <div className="p-3 glass-card border-b border-white/5 flex items-center justify-between bg-white/5">
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
                                                            <label className="flex items-center gap-1.5 text-xs text-white/50 cursor-pointer hover:text-white bouncy-hover">
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={p.isAdmin === 1}
                                                                    onChange={() => handleToggleAdmin(p.id, p.isAdmin)}
                                                                    className="rounded glass-card border-white/10 text-theme"
                                                                />
                                                                Admin
                                                            </label>
                                                            <button onClick={() => handleDeleteProfile(p.id)} className="text-rose-400 hover:bg-white/10 p-2 rounded-full bouncy-hover">
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="p-2 space-y-1">
                                                        {devices.length === 0 ? (
                                                            <div className="text-white/30 text-xs px-2 py-1">No devices assigned</div>
                                                        ) : devices.map(d => (
                                                            <div className="flex items-center justify-between glass-card p-2 rounded-full border border-white/5 pl-8 relative" key={d.ip}>
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
                                                                    <button onClick={() => handleDeleteAssignment(d.ip)} className="text-rose-400/70 hover:text-rose-400 hover:bg-white/10 p-1 rounded bouncy-hover">
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
                                            <div className="text-white/30 text-sm py-4 text-center glass-card rounded-3xl border border-white/5 shadow-inner">
                                                No unassigned devices currently online.
                                            </div>
                                        ) : (
                                            peers.filter(p => !assignments.some(a => a.ip === p.ip)).map(p => (
                                                <div key={p.ip} className="flex items-center justify-between glass-card p-3 rounded-3xl border border-white/5 shadow-md">
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
                                                            className="glass-card border border-white/10 text-white text-xs rounded-full p-2 focus:outline-none focus:border-theme"
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
                            </div>
                        ) : activeTab === 'channels' ? (
                            <div className="max-w-2xl mx-auto mt-8">
                                <div className="glass-card border border-theme/30 rounded-[2rem] p-10 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-2xl">
                                    <div className="absolute inset-0 bg-gradient-to-br from-theme/10 to-transparent"></div>
                                    <div className="w-20 h-20 rounded-full bg-theme/20 flex items-center justify-center mb-6 relative z-10 shadow-[0_0_30px_var(--color-theme-glow)]">
                                        <Shield size={40} className="text-theme-text" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-3 relative z-10">Global Message Moderation is Active</h3>
                                    <p className="text-white/60 text-sm leading-relaxed mb-6 relative z-10">
                                          As an Administrator, you have full moderation rights over all server communications. You can instantly delete any message from any user globally by opening the message context menu in any chat channel.
                                      </p>
                                      <div className="glass-card px-4 py-2 rounded-full border border-white/10 text-xs text-white/50 flex items-center gap-2 relative z-10">
                                          <MessageSquare size={14} /> Right-click or long-press any message to moderate.
                                      </div>
                                  </div>
                                  <div className="mt-8 space-y-4 w-full">
                                      <h4 className="text-white font-medium pl-2 text-left">Channel Purge Tools</h4>
                                      {channels && channels.map(channel => (
                                          <div key={channel.id} className="glass-card border border-white/10 rounded-2xl p-4 flex items-center justify-between bouncy-hover">
                                              <div className="flex items-center gap-3">
                                                  <div className="w-10 h-10 rounded-full bg-theme/20 text-theme-text flex items-center justify-center font-bold">
                                                      #
                                                  </div>
                                                  <div className="text-left">
                                                      <div className="text-white font-medium">{channel.name}</div>
                                                      <div className="text-white/40 text-[10px] font-mono">{channel.id}</div>
                                                  </div>
                                              </div>
                                              <button 
                                                  onClick={async () => {
                                                      if(window.confirm(`Are you sure you want to completely purge ALL messages in "${channel.name}"? This cannot be undone.`)) {
                                                          try {
                                                              await fetch(`/api/channels/${channel.id}/purge`, { method: 'DELETE' });
                                                          } catch(e) {
                                                              console.error(e);
                                                          }
                                                      }
                                                  }}
                                                  className="glass-button bg-rose-500/10 text-rose-400 hover:bg-rose-500/30 hover:text-rose-200 border-rose-500/30 px-4 py-2 text-sm font-bold flex items-center gap-2"
                                              >
                                                  <Trash2 size={16} /> Purge
                                              </button>
                                          </div>
                                      ))}
                                  </div>
                              </div>
    
                        ) : (
                            <div className="max-w-3xl mx-auto space-y-6">
                                <div className="p-5 rounded-3xl border border-white/5 glass-card space-y-4 shadow-lg">
                                    <h3 className="text-white/90 font-bold flex items-center gap-2">
                                        <Bot size={20} className="text-theme-text" />
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
                                            className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme bouncy-hover"
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
                                            className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme bouncy-hover"
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
                                            className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-white focus:outline-none focus:border-theme appearance-none bouncy-hover"
                                        >
                                            <option value="" className="bg-slate-900 text-white">Auto-select first available</option>
                                            {availableModels.map(m => (
                                                <option key={m.id} value={m.id} className="bg-slate-900 text-white">{m.name || m.id}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                
                                <div className="p-5 rounded-3xl border border-white/5 glass-card space-y-4 shadow-lg">
                                    <h3 className="text-white/90 font-bold flex items-center gap-2">
                                        <Bot size={20} className="text-theme-text" />
                                        Multi-Agent Configuration
                                    </h3>
                                    
                                    {/* Agent 1 */}
                                    <div className="border border-white/10 p-4 rounded-3xl glass-card relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-theme"></div>
                                        <h4 className="text-sm font-bold text-white mb-3">Agent 1 (Primary)</h4>
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
                                                    className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-sm text-white focus:outline-none focus:border-theme bouncy-hover"
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
                                                    className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-sm text-white focus:outline-none focus:border-theme appearance-none bouncy-hover"
                                                >
                                                    <option value="" className="bg-slate-900 text-white">Use Default Model</option>
                                                    {availableModels.map(m => (
                                                        <option key={m.id} value={m.id} className="bg-slate-900 text-white">{m.name || m.id}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Agent 2 */}
                                    <div className="border border-white/10 p-4 rounded-3xl glass-card relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-theme-alt"></div>
                                        <h4 className="text-sm font-bold text-white mb-3">Agent 2 (Secondary)</h4>
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
                                                    className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-sm text-white focus:outline-none focus:border-theme bouncy-hover"
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
                                                    className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-sm text-white focus:outline-none focus:border-theme appearance-none bouncy-hover"
                                                >
                                                    <option value="" className="bg-slate-900 text-white">Use Default Model</option>
                                                    {availableModels.map(m => (
                                                        <option key={m.id} value={m.id} className="bg-slate-900 text-white">{m.name || m.id}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-5 rounded-3xl border border-white/5 glass-card space-y-4 shadow-lg">
                                    <h3 className="text-white/90 font-bold flex items-center gap-2">
                                        <Bot size={20} className="text-theme-text" />
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
                                            className="w-full glass-card border border-white/10 rounded-full px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-theme bouncy-hover"
                                        />
                                        <p className="text-[10px] text-white/40 mt-1">Used for processing @image prompts.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

