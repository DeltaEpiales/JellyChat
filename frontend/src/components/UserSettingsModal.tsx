import React, { useState } from 'react';
import { X, UserPlus, Users } from 'lucide-react';
import type { Peer } from '../App';

interface UserSettingsModalProps {
    onClose: () => void;
    peers: Peer[];
    profiles: any[];
    assignments: any[];
    onProfilesUpdated: () => void;
}

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ onClose, peers, profiles, assignments, onProfilesUpdated }) => {
    const [localProfiles, setLocalProfiles] = useState<any[]>(profiles);
    const [localAssignments, setLocalAssignments] = useState<any[]>(assignments);
    
    const handleCreateProfile = async (ip: string, peerName: string) => {
        const name = window.prompt(`Enter display name for ${peerName} (${ip}):`, peerName);
        if (!name) return;
        
        const avatarUrl = window.prompt(`Enter avatar URL (optional):`);
        const isAdmin = window.confirm(`Grant ${name} Administrator privileges? (Admins can manage channels and users)`);
        
        const profileId = 'prof_' + Date.now();
        await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: profileId, name, avatar: avatarUrl || null, isAdmin })
        });
        
        await fetch('/api/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, profileId })
        });
        
        onProfilesUpdated();
        // Refresh local
        fetch('/api/profiles').then(r => r.json()).then(setLocalProfiles);
        fetch('/api/assignments').then(r => r.json()).then(setLocalAssignments);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/5">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                        <Users size={18} className="text-indigo-400" />
                        User Management
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg text-white/50">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-4 md:p-6 overflow-y-auto space-y-6">
                    <div>
                        <h4 className="text-sm font-bold text-white/50 uppercase tracking-widest mb-4">Connected Devices</h4>
                        <div className="space-y-2">
                            {peers.map(peer => {
                                const assignment = localAssignments.find(a => a.ip === peer.ip);
                                const profile = assignment ? localProfiles.find(p => p.id === assignment.profileId) : null;
                                
                                return (
                                    <div key={peer.ip} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center overflow-hidden border border-indigo-500/30">
                                                {profile?.avatar ? (
                                                    <img src={profile.avatar} alt="avatar" className="w-full h-full object-cover" />
                                                ) : (
                                                    <Users size={20} className="text-indigo-400" />
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-white flex items-center gap-2">
                                                    {profile ? profile.name : peer.name}
                                                    {profile?.isAdmin === 1 && (
                                                        <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest">Admin</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-white/50 font-mono">
                                                    {peer.ip} • {peer.os}
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleCreateProfile(peer.ip, peer.name)}
                                            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                                        >
                                            <UserPlus size={14} />
                                            {profile ? 'Edit Profile' : 'Assign Profile'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
