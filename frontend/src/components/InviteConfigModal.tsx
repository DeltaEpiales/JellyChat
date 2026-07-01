import React, { useState } from 'react';
import { X, Link, Clock, Infinity, Shield } from 'lucide-react';

interface InviteConfigModalProps {
    onClose: () => void;
    onGenerate: (expirySeconds: number, reusable: boolean) => void;
}

export const InviteConfigModal: React.FC<InviteConfigModalProps> = ({ onClose, onGenerate }) => {
    const [expiry, setExpiry] = useState<number>(86400); // 1 day default
    const [reusable, setReusable] = useState<boolean>(false);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                >
                    <X size={20} />
                </button>
                
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Link className="text-indigo-400" size={24} /> Generate Guest Invite
                </h2>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-white/70 mb-2 flex items-center gap-2">
                            <Clock size={16} /> Expiration
                        </label>
                        <select 
                            value={expiry}
                            onChange={e => setExpiry(Number(e.target.value))}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all appearance-none cursor-pointer"
                        >
                            <option value={3600} className="bg-zinc-900 text-white">1 Hour</option>
                            <option value={21600} className="bg-zinc-900 text-white">6 Hours</option>
                            <option value={86400} className="bg-zinc-900 text-white">24 Hours</option>
                            <option value={604800} className="bg-zinc-900 text-white">7 Days</option>
                            <option value={2592000} className="bg-zinc-900 text-white">30 Days</option>
                            {/* Note: Tailscale API might cap this depending on plan, usually 90 days max */}
                        </select>
                    </div>

                    <label className="flex items-start gap-3 p-4 bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 rounded-xl cursor-pointer transition-all group">
                        <div className="relative flex items-center justify-center mt-0.5">
                            <input 
                                type="checkbox" 
                                checked={reusable}
                                onChange={e => setReusable(e.target.checked)}
                                className="peer sr-only"
                            />
                            <div className="w-5 h-5 border-2 border-white/30 rounded-md peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors group-hover:border-white/50 flex items-center justify-center">
                                <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-white mb-1 flex items-center gap-2">
                                <Infinity size={16} className={reusable ? 'text-indigo-400' : 'text-white/40'} /> 
                                Reusable Key
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed">
                                If enabled, multiple devices can use this invite link. Otherwise, it is a one-time use key that expires as soon as a single device connects.
                            </p>
                        </div>
                    </label>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-3 text-amber-400 text-sm">
                        <Shield size={20} className="shrink-0 mt-0.5" />
                        <p>
                            Guest keys are automatically tagged with <code className="bg-amber-500/20 px-1 rounded">tag:guest</code>. Ensure your Tailscale ACLs restrict this tag appropriately.
                        </p>
                    </div>

                    <button 
                        onClick={() => onGenerate(expiry, reusable)}
                        className="w-full py-3.5 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] flex items-center justify-center gap-2"
                    >
                        <Link size={18} /> Generate Link
                    </button>
                </div>
            </div>
        </div>
    );
};
