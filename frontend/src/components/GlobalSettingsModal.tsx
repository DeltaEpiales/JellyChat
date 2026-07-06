import React, { useRef, useState, useEffect } from 'react';
import { X, Settings, Bell, Database, User, Upload } from 'lucide-react';

interface GlobalSettingsModalProps {
    onClose: () => void;
    notificationsEnabled: boolean;
    setNotificationsEnabled: (enabled: boolean) => void;
    themeAccent: 'jelly' | 'ocean' | 'forest' | 'sunset';
    setThemeAccent: (theme: 'jelly' | 'ocean' | 'forest' | 'sunset') => void;
    myProfile: any;
    onProfileUpdated: (newProfile: any) => void;
    showGameServers: boolean;
    setShowGameServers: (show: boolean) => void;
    shareSteamPresence: boolean;
    setShareSteamPresence: (share: boolean) => void;
    privacySettings: { readReceipts: boolean, showOnlineStatus: boolean };
    setPrivacySettings: React.Dispatch<React.SetStateAction<{ readReceipts: boolean, showOnlineStatus: boolean }>>;
    appearanceSettings: { fontSize: string, fontFamily: string, customCSS: string };
    setAppearanceSettings: React.Dispatch<React.SetStateAction<{ fontSize: string, fontFamily: string, customCSS: string }>>;
}

export function GlobalSettingsModal({ onClose, notificationsEnabled, setNotificationsEnabled, themeAccent, setThemeAccent, myProfile, onProfileUpdated, showGameServers, setShowGameServers, shareSteamPresence, setShareSteamPresence, privacySettings, setPrivacySettings, appearanceSettings, setAppearanceSettings }: GlobalSettingsModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(myProfile?.name || '');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (myProfile?.name) setName(myProfile.name);
    }, [myProfile]);

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        const formData = new FormData();
        formData.append('name', name);
        if (fileInputRef.current?.files?.[0]) {
            formData.append('avatar', fileInputRef.current.files[0]);
        }
        
        try {
            const res = await fetch('/api/profiles/self', {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                const updated = await res.json();
                onProfileUpdated(updated);
                alert('Profile updated successfully!');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to update profile');
        }
        setIsSaving(false);
    };

    const handleClearCache = () => {
        if (confirm('Are you sure you want to clear your local cache? This will log you out and clear your saved preferences.')) {
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleNotificationsToggle = async () => {
        if (!notificationsEnabled) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                setNotificationsEnabled(true);
            }
        } else {
            setNotificationsEnabled(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-center justify-center p-4" onClick={onClose}>
            <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                        <Settings size={18} className="text-white/50" />
                        App Settings
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg text-white/50 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-4 md:p-6 overflow-y-auto space-y-6 flex-1">
                    {/* User Profile */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">My Profile</label>
                        <form onSubmit={handleSaveProfile} className="p-4 rounded-xl border border-white/5 bg-white/5 space-y-4">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-full bg-theme/20 flex items-center justify-center overflow-hidden border border-theme/30 shrink-0">
                                    {myProfile?.avatar ? (
                                        <img src={myProfile.avatar} alt="avatar" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={24} className="text-theme-text" />
                                    )}
                                </div>
                                <div className="flex-1 space-y-2">
                                    <input 
                                        type="text" 
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Display Name"
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-theme/50"
                                        required
                                    />
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="file" 
                                            ref={fileInputRef}
                                            accept="image/*,.gif"
                                            className="hidden"
                                            onChange={(e) => { if(e.target.files?.length) handleSaveProfile(e as any) }}
                                        />
                                        <button 
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs transition-colors flex items-center gap-2"
                                        >
                                            <Upload size={14} /> Change Avatar
                                        </button>
                                        <button 
                                            type="submit"
                                            disabled={isSaving}
                                            className="px-4 py-1.5 bg-theme hover:bg-theme/80 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors ml-auto"
                                        >
                                            {isSaving ? 'Saving...' : 'Save Name'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>

                    <div className="h-px bg-white/5"></div>

                    {/* Theme Settings */}

                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Glow Accent</label>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { id: 'jelly', name: 'Jelly', colors: 'from-rose-500 to-violet-500' },
                                { id: 'ocean', name: 'Ocean', colors: 'from-sky-500 to-teal-500' },
                                { id: 'forest', name: 'Forest', colors: 'from-emerald-500 to-lime-500' },
                                { id: 'sunset', name: 'Sunset', colors: 'from-orange-500 to-rose-600' }
                            ].map(t => (
                                <button 
                                    key={t.id}
                                    onClick={() => setThemeAccent(t.id as any)}
                                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${themeAccent === t.id ? 'border-white/20 bg-white/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                                >
                                    <div className={`w-6 h-6 rounded-full bg-gradient-to-br ${t.colors} shadow-lg shadow-black/50`}></div>
                                    <span className="font-semibold text-sm text-white/90">{t.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    

<div className="h-px bg-white/5"></div>

{/* Appearance & Advanced CSS */}
<div className="space-y-3">
    <label className="text-xs font-bold text-white/50 uppercase tracking-widest flex items-center justify-between">
        Appearance
    </label>
    <div className="space-y-4">
        <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-white/80">Font Family</span>
            <select 
                value={appearanceSettings.fontFamily}
                onChange={(e) => setAppearanceSettings(prev => ({ ...prev, fontFamily: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white/90 outline-none focus:border-theme/50"
            >
                <option value="Inter">Inter (Default)</option>
                <option value="Roboto">Roboto</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Comic Sans MS">Comic Sans (Fun!)</option>
                <option value="monospace">Monospace (Hacker)</option>
            </select>
        </div>

        <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-white/80">Font Scale: {appearanceSettings.fontSize}</span>
            <input 
                type="range" min="80" max="150" step="5" 
                value={parseInt(appearanceSettings.fontSize)}
                onChange={(e) => setAppearanceSettings(prev => ({ ...prev, fontSize: e.target.value + '%' }))}
                className="w-full accent-theme"
            />
        </div>

        <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-white/80">Custom CSS Engine</span>
            <p className="text-xs text-white/40">Inject custom styles directly into Tailchat. E.g. <code>body { '{ background: url(...) }' }</code></p>
            <textarea 
                value={appearanceSettings.customCSS}
                onChange={(e) => setAppearanceSettings(prev => ({ ...prev, customCSS: e.target.value }))}
                className="w-full h-32 bg-black/50 border border-white/10 rounded-lg p-2 text-xs text-theme-text-alt font-mono outline-none focus:border-theme/50 custom-scrollbar resize-y"
                placeholder="/* Write custom CSS here */"
            />
        </div>
    </div>
</div>

<div className="h-px bg-white/5"></div>

{/* Notification Settings */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Notifications</label>
                        <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${notificationsEnabled ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]/20 text-theme-text-alt' : 'bg-white/10 text-white/50'}`}>
                                    <Bell size={20} />
                                </div>
                                <div>
                                    <div className="font-semibold text-white">Push Notifications</div>
                                    <div className="text-xs text-white/50">Get alerts for new messages</div>
                                </div>
                            </div>
                            <button 
                                onClick={handleNotificationsToggle}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationsEnabled ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]' : 'bg-white/20'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/5"></div>

                    {/* UI Preferences */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">UI Preferences</label>
                        <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${showGameServers ? 'bg-theme/20 text-theme-text' : 'bg-white/10 text-white/50'}`}>
                                    <Settings size={20} />
                                </div>
                                <div>
                                    <div className="font-semibold text-white">Show Game Servers Tab</div>
                                    <div className="text-xs text-white/50">Display the Game Servers browser in navigation</div>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowGameServers(!showGameServers)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showGameServers ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]' : 'bg-white/20'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showGameServers ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/5"></div>

                    {/* Privacy & Presence */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Privacy & Presence</label>
                        <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${shareSteamPresence ? 'bg-theme/20 text-theme-text' : 'bg-white/10 text-white/50'}`}>
                                    <User size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white">Share Steam Presence</div>
                                    <div className="text-xs text-white/50">Show your active Steam game in the sidebar</div>
                                </div>
                            </div>
                            <button 
                                onClick={() => {
                                    setShareSteamPresence(!shareSteamPresence);
                                    localStorage.setItem('shareSteamPresence', (!shareSteamPresence).toString());
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${shareSteamPresence ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]' : 'bg-white/20'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareSteamPresence ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        
                        <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5 mt-2">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${privacySettings.readReceipts ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]/20 text-theme-text-alt' : 'bg-white/10 text-white/50'}`}>
                                    <Bell size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white">Send Read Receipts</div>
                                    <div className="text-xs text-white/50">Let others know when you've read their messages</div>
                                </div>
                            </div>
                            <button 
                                onClick={() => {
                                    setPrivacySettings(prev => ({ ...prev, readReceipts: !prev.readReceipts }));
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${privacySettings.readReceipts ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]' : 'bg-white/20'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${privacySettings.readReceipts ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5 mt-2">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${privacySettings.showOnlineStatus ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]/20 text-theme-text-alt' : 'bg-white/10 text-white/50'}`}>
                                    <User size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white">Show Online Status</div>
                                    <div className="text-xs text-white/50">Allow others to see when you are online and typing</div>
                                </div>
                            </div>
                            <button 
                                onClick={() => {
                                    setPrivacySettings(prev => ({ ...prev, showOnlineStatus: !prev.showOnlineStatus }));
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${privacySettings.showOnlineStatus ? 'bg-gradient-to-r from-theme to-theme-alt shadow-[0_0_10px_var(--color-theme-glow)]' : 'bg-white/20'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${privacySettings.showOnlineStatus ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/5"></div>

                    {/* Data Settings */}
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-white/50 uppercase tracking-widest">Data & Storage</label>
                        <div className="flex items-center justify-between p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400">
                                    <Database size={20} />
                                </div>
                                <div>
                                    <div className="font-semibold text-rose-100">Clear Local Data</div>
                                    <div className="text-xs text-rose-400/70">Sign out and remove cached data</div>
                                </div>
                            </div>
                            <button 
                                onClick={handleClearCache}
                                className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded-lg text-sm font-bold transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
