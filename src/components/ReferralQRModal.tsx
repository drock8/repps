import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export default function ReferralQRModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);

  const referralUrl = profile ? `https://repps.pro/r/${profile.referral_code}` : "";

  if (!open || !profile) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join REPPs",
          text: `Join me on REPPs — the global movement challenge! Use my link:`,
          url: referralUrl,
        });
      } catch { /* cancelled */ }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-bg-elevated rounded-xl p-6 mx-4 max-w-sm w-full flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-ink-muted"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <p className="text-micro text-ink-muted uppercase tracking-wide">Your Referral QR</p>

        <div className="rounded-lg overflow-hidden">
          {profile.referral_qr_url ? (
            <img src={profile.referral_qr_url} width={240} height={240} alt="Referral QR code" />
          ) : (
            <div className="w-[240px] h-[240px] bg-bg-surface flex items-center justify-center text-ink-muted text-caption">
              QR unavailable
            </div>
          )}
        </div>

        <p className="text-caption text-ink-secondary text-center">
          Scan to join REPPs via your referral link
        </p>

        <div className="flex gap-3 w-full">
          <button
            onClick={handleCopy}
            className="flex-1 bg-bg-surface text-ink-primary font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
          >
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            onClick={handleShare}
            className="flex-1 bg-accent text-ink-inverse font-semibold text-body rounded-pill py-3 transition-all duration-200 ease-apple active:scale-95"
          >
            Share
          </button>
        </div>

        <p className="text-micro text-ink-muted tabular-nums">{profile.referral_code}</p>
      </div>
    </div>
  );
}
