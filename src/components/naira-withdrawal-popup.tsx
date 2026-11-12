"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { minWithdrawal, withdrawalActivationFee } from "@/lib/limits";

type OpayAccount = { bank: string; accountNumber: string; accountName: string };

/**
 * Manual Naira withdrawal: shows the OPay account for the per-withdrawal
 * activation fee, then takes a screenshot upload that an admin reviews
 * before reserving the withdrawal amount from the wallet.
 */
export default function NairaWithdrawalPopup({ withdrawalAmount, onClose, onSubmitted }: { withdrawalAmount: number; onClose: () => void; onSubmitted: () => void }) {
  const [opay, setOpay] = useState<OpayAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [reference, setReference] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const fee = withdrawalActivationFee("NGN");
  const minimum = minWithdrawal("NGN");

  useEffect(() => {
    fetch("/api/naira-withdrawals", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ opay?: OpayAccount | null }> : null)
      .then((data) => setOpay(data?.opay || null))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pickScreenshot(file: File | null) {
    setError("");
    if (!file) { setScreenshot(null); setPreview(null); return; }
    if (!file.type.startsWith("image/")) { setError("Please choose an image file for the screenshot."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("The screenshot is too large. Keep it under 2 MB."); return; }
    setScreenshot(file);
    setPreview(URL.createObjectURL(file));
  }

  async function copy(value: string) {
    try {
      await copyText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy — select the number and copy it manually.");
    }
  }

  async function submit() {
    if (!Number.isFinite(withdrawalAmount) || withdrawalAmount < minimum) {
      setError(`The minimum withdrawal is ₦${minimum.toLocaleString()}.`);
      return;
    }
    if (!screenshot) { setError("Upload a screenshot of your activation fee payment."); return; }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("amount", String(withdrawalAmount));
      form.set("reference", reference.trim());
      form.set("screenshot", screenshot);
      const response = await fetch("/api/naira-withdrawals", { method: "POST", body: form });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not submit your withdrawal.");
      onSubmitted();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not submit your withdrawal.");
      setBusy(false);
    }
  }

  return (
    <div className="naira-overlay" role="dialog" aria-modal="true" aria-label="Naira withdrawal activation fee" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="naira-card">
        <button type="button" className="naira-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <span className="modal-eyebrow">NAIRA WITHDRAWAL</span>
        <h2>Pay the activation fee to our OPay account</h2>
        <p>To process your withdrawal, pay the activation fee to this OPay account, then upload a screenshot of your payment below. The system will automatically verify it and reserve the withdrawal amount from your wallet. The payout is then processed manually.</p>

        {loading && <p className="naira-note">Loading account details…</p>}
        {!loading && !opay && <p className="admin-inline-error" role="alert">Naira withdrawals are not available yet. Please try again later.</p>}
        {opay && (
          <div className="naira-opay-box">
            <div><span>Bank</span><strong>{opay.bank}</strong></div>
            <div>
              <span>Account number</span>
              <strong>{opay.accountNumber}</strong>
              <button type="button" onClick={() => copy(opay.accountNumber)}>{copied === opay.accountNumber ? <Check size={13} /> : <Copy size={13} />} {copied === opay.accountNumber ? "Copied" : "Copy"}</button>
            </div>
            {opay.accountName && <div><span>Account name</span><strong>{opay.accountName}</strong></div>}
          </div>
        )}

        {opay && (
          <>
            <div className="naira-opay-box">
              <div><span>Withdrawal amount</span><strong>₦{Number(withdrawalAmount).toLocaleString()}</strong></div>
              <div><span>Activation fee (separate)</span><strong>₦{fee.toLocaleString()}</strong></div>
            </div>
            <label className="naira-field">
              <span>Activation fee payment reference (optional)</span>
              <input placeholder="OPay transaction reference" value={reference} onChange={(event) => setReference(event.target.value)} disabled={busy} />
            </label>
            <div className="naira-field">
              <span>Upload screenshot of payment</span>
              <label className="naira-upload">
                <input type="file" accept="image/*" onChange={(event) => pickScreenshot(event.target.files?.[0] || null)} disabled={busy} hidden />
                <span className="naira-upload-btn">{screenshot ? screenshot.name : "Upload screenshot of payment"}</span>
              </label>
              <small>PNG or JPG screenshot of your OPay payment, max 2 MB.</small>
            </div>
            {preview && <img className="naira-preview" src={preview} alt="Activation fee payment screenshot preview" />}
            {error && <p className="admin-inline-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button ref={cancelRef} type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>{busy ? "Submitting…" : "Submit for review"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
