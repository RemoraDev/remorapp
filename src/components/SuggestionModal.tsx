import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import QuickAccountStep, { type QuickAccountData } from "./QuickAccountStep";

interface SuggestionModalProps {
  onClose: () => void;
}

type Step = "account" | "message" | "done";

export default function SuggestionModal({ onClose }: SuggestionModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(user ? "message" : "account");
  const [account, setAccount] = useState<QuickAccountData | null>(null);
  const [message, setMessage] = useState("");

  const handleAccountSubmit = (data: QuickAccountData) => {
    setAccount(data);
    setStep("message");
  };

  const handleMessageSubmit = (event: FormEvent) => {
    event.preventDefault();
    const payload = user
      ? { userId: user.id, email: user.email, mensaje: message }
      : { nombre: account?.nombre, email: account?.email, mensaje: message };

    console.log("Sugerencia enviada:", payload);
    setStep("done");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>

        {step === "account" && (
          <QuickAccountStep
            title="Cuenta express"
            description="Solo para poder responder tu sugerencia."
            onSubmit={handleAccountSubmit}
          />
        )}

        {step === "message" && (
          <form className="modal-form" onSubmit={handleMessageSubmit}>
            <div>
              <h2 className="modal-title">Tu sugerencia</h2>
              <p className="modal-sub">
                {user ? "Quedará asociada a tu cuenta." : `Gracias, ${account?.nombre}.`}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sugerencia-texto">
                Cuéntanos qué mejorarías
              </label>
              <textarea
                id="sugerencia-texto"
                className="form-textarea"
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block">
              Enviar sugerencia
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="modal-form">
            <h2 className="modal-title">¡Gracias!</h2>
            <p className="form-success">Recibimos tu sugerencia.</p>
            <button className="btn btn-ghost btn-block" onClick={onClose}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
