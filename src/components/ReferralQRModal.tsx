import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import QRScanner from "./QRScanner";

export default function ReferralQRModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [scanning, setScanning] = useState(false);

  const referralUrl = profile ? `https://repps.pro/r/${profile.referral_code}` : "";

  const handleScanResult = useCallback((value: string) => {
    setScanning(false);
    onClose();
    const compMatch = value.match(/\/compete\/([A-Za-z0-9]+)(\?.*)?/);
    if (compMatch) {
      navigate(`/compete/${compMatch[1]}${compMatch[2] || ""}`);
      return;
    }
    const teamMatch = value.match(/\/team\/join\/([A-Za-z0-9]+)/);
    if (teamMatch) {
      navigate(`/team/join/${teamMatch[1]}`);
      return;
    }
    const refMatch = value.match(/\/r\/([A-Za-z0-9]+)/);
    if (refMatch) {
      navigate(`/r/${refMatch[1]}`);
      return;
    }
    if (value.startsWith(window.location.origin)) {
      navigate(value.replace(window.location.origin, ""));
      return;
    }
    try {
      const url = new URL(value);
      navigate(url.pathname);
    } catch { /* not a valid URL */ }
  }, [navigate, onClose]);

  if (scanning) {
    return <QRScanner onScan={handleScanResult} onClose={() => setScanning(false)} />;
  }

  if (!open || !profile) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const handleShare = async () => {
    const text = `Join me on REPPs — we're on a mission to inspire 1,000,000 people to move more and live better. It starts with one repp. ${referralUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
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

        <button
          onClick={() => setScanning(true)}
          className="w-full bg-bg-surface text-ink-primary font-semibold text-body rounded-pill py-3 flex items-center justify-center gap-2 transition-all duration-200 ease-apple active:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan QR
        </button>

        <p className="text-micro text-ink-muted tabular-nums">{profile.referral_code}</p>
      </div>
    </div>
  );
}
