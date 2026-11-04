"use client";

/**
 * PayPal Braintree Drop-in UI. Card data goes straight from the browser to Braintree;
 * our server only ever receives a single-use payment method nonce.
 */
import { useEffect, useRef, useState } from "react";
import { ErrorNote, Spinner } from "./ui";

interface DropinInstance {
  requestPaymentMethod(): Promise<{ nonce: string; details?: { lastFour?: string; cardType?: string } }>;
  teardown(): Promise<void>;
  isPaymentMethodRequestable(): boolean;
  on(event: string, cb: () => void): void;
}

export function DropIn({ amountLabel, onNonce, disabled }: { amountLabel: string; onNonce: (nonce: string) => Promise<void>; disabled?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<DropinInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [requestable, setRequestable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/braintree/token");
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Payment service unavailable");
        const dropin = (await import("braintree-web-drop-in")).default as unknown as {
          create(o: Record<string, unknown>): Promise<DropinInstance>;
        };
        if (cancelled || !container.current) return;
        const inst = await dropin.create({
          authorization: j.clientToken,
          container: container.current,
          card: { cardholderName: { required: false }, overrides: { fields: { number: { placeholder: "4111 1111 1111 1111" } } } },
        });
        instance.current = inst;
        inst.on("paymentMethodRequestable", () => setRequestable(true));
        inst.on("noPaymentMethodRequestable", () => setRequestable(false));
        setRequestable(inst.isPaymentMethodRequestable());
        setReady(true);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      instance.current?.teardown().catch(() => {});
      instance.current = null;
    };
  }, []);

  async function pay() {
    if (!instance.current) return;
    setBusy(true);
    setError(null);
    try {
      const { nonce } = await instance.current.requestPaymentMethod();
      await onNonce(nonce);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!ready && !error && (
        <div className="text-sm text-ink-3 py-6"><Spinner label="Loading secure PayPal Braintree checkout…" /></div>
      )}
      <div ref={container} />
      {error && <div className="mt-3"><ErrorNote message={error} onDismiss={() => setError(null)} /></div>}
      {ready && (
        <>
          <button onClick={pay} disabled={busy || disabled || !requestable} className="btn btn-primary w-full mt-2">
            {busy ? <Spinner label="Authorizing hold…" /> : `Authorize ${amountLabel} hold`}
          </button>
          <p className="text-xs text-ink-3 mt-2 leading-relaxed">
            Sandbox: use test card <span className="num">4111 1111 1111 1111</span>, any future expiry, any CVV. This places an authorization hold only.
            You are charged just the amount the firewall approves, and the remainder is released.
          </p>
        </>
      )}
    </div>
  );
}
