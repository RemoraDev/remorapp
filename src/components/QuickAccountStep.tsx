import { useState } from "react";
import type { FormEvent } from "react";

export interface QuickAccountData {
  nombre: string;
  email: string;
}

interface QuickAccountStepProps {
  title?: string;
  description?: string;
  onSubmit: (data: QuickAccountData) => void;
}

/**
 * Patrón de "cuenta express": recolecta solo nombre y correo para dejar
 * avanzar a un usuario sin sesión iniciada. Pensado para reutilizarse en
 * cualquier flujo corto (sugerencias, contacto, etc.) que no requiera
 * registro completo.
 */
export default function QuickAccountStep({
  title = "Antes de continuar",
  description = "Déjanos tu nombre y correo para poder responderte.",
  onSubmit,
}: QuickAccountStepProps) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ nombre: nombre.trim(), email: email.trim() });
  };

  return (
    <form className="modal-form" onSubmit={handleSubmit}>
      <div>
        <h2 className="modal-title">{title}</h2>
        <p className="modal-sub">{description}</p>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="quick-nombre">
          Nombre
        </label>
        <input
          id="quick-nombre"
          className="form-input"
          type="text"
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="quick-email">
          Correo
        </label>
        <input
          id="quick-email"
          className="form-input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button type="submit" className="btn btn-primary btn-block">
        Continuar
      </button>
    </form>
  );
}
