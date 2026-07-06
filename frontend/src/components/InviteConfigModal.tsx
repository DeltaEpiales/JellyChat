import React, { useState } from 'react';
import { X, Link, Clock, Shield, Globe, Zap, Users } from 'lucide-react';

interface InviteConfigModalProps {
    onClose: () => void;
    onGenerate: (expirySeconds: number, reusable: boolean) => void;
    onGenerateFunnel: (expiryHours: number) => void;
}

export const InviteConfigModal: React.FC<InviteConfigModalProps> = ({ onClose, onGenerateFunnel }) => {
    const [expiry, setExpiry] = useState<number>(24); // 24 hours default

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-zinc-900 border border-white/10 rounded-[2rem] p-8 w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-theme/20 blur-[80px] rounded-full mix-blend-screen pointer-events-none"></div>
                
                <button 
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
                >
                    <X size={20} />
                </button>
                
                <h2 className="text-2xl font-black text-white mb-2 flex items-center gap-2 relative z-10">
                    <Users className="text-theme-text" size={28} /> Invite Friends
                </h2>
                <p className="text-white/60 text-sm mb-6 relative z-10">Generate a Magic Link that allows guests to join temporarily via the web or securely install the full P2P client.</p>

                <div className="space-y-6 relative z-10">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
                        <div className="flex gap-4 mb-4">
                            <div className="bg-theme/20 p-3 rounded-xl flex items-center justify-center h-12 w-12">
                                <Globe className="text-theme-text" size={24} />
                            </div>
                            <div>
                                <h3 className="text-white font-bold text-sm">1. Web Access</h3>
                                <p className="text-white/50 text-xs">Guests can immediately join text chats through a secure web proxy.</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <div className="bg-amber-500/20 p-3 rounded-xl flex items-center justify-center h-12 w-12">
                                <Zap className="text-amber-400" size={24} />
                            </div>
                            <div>
                                <h3 className="text-white font-bold text-sm">2. Full Client (E2E)</h3>
                                <p className="text-white/50 text-xs">Guests will be offered a 1-click installer to upgrade to a full P2P Tailscale node.</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-white/70 mb-2 flex items-center gap-2">
                            <Clock size={16} /> Link Expiration
                        </label>
                        <select 
                            value={expiry}
                            onChange={e => setExpiry(Number(e.target.value))}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-theme/50 focus:ring-1 focus:ring-theme/50 transition-all appearance-none cursor-pointer font-medium"
                        >
                            <option value={1} className="bg-zinc-900 text-white">1 Hour</option>
                            <option value={6} className="bg-zinc-900 text-white">6 Hours</option>
                            <option value={24} className="bg-zinc-900 text-white">24 Hours</option>
                            <option value={168} className="bg-zinc-900 text-white">7 Days</option>
                        </select>
                    </div>

                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex gap-3 text-emerald-400 text-xs">
                        <Shield size={16} className="shrink-0 mt-0.5" />
                        <p>
                            This will create a temporary public port on your machine using Tailscale Funnel to serve the welcome page.
                        </p>
                    </div>

                    <button 
                        onClick={() => onGenerateFunnel(expiry)}
                        className="w-full py-4 bg-theme hover:bg-theme-text text-white font-bold rounded-2xl transition-all shadow-[0_0_20px_var(--color-theme-glow)] hover:shadow-[0_0_30px_var(--color-theme-glow)] flex items-center justify-center gap-2 hover:-translate-y-0.5 active:translate-y-0"
                    >
                        <Link size={18} /> Generate Magic Link
                    </button>
                </div>
            </div>
        </div>
    );
};
