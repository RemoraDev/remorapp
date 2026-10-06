// Corrección: el <input type="datetime-local"> de siempre es muy
// incómodo en escritorio (Tauri/WebView2) -- hay que navegar segmento
// por segmento (día/mes/año/hora/minuto) a mano, sin calendario visual
// cómodo. Se reemplaza por dos inputs nativos simples, lado a lado:
// uno de fecha (type="date", con su propio calendario desplegable) y
// uno de hora (type="time"). Mantiene el mismo string combinado
// "YYYY-MM-DDTHH:mm" que datetime-local producía, así que
// datetimeLocalAIso() y el resto del código que ya esperaba ese
// formato no necesitan cambiar -- esto solo reemplaza el control
// visual.
interface FechaHoraInputProps {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  required?: boolean;
  max?: string;
  min?: string;
}

export default function FechaHoraInput({ id, value, onChange, required, max, min }: FechaHoraInputProps) {
  const [fecha, hora] = value.split("T");

  const actualizar = (nuevaFecha: string, nuevaHora: string) => {
    if (!nuevaFecha && !nuevaHora) {
      onChange("");
      return;
    }
    onChange(`${nuevaFecha || fecha || ""}T${nuevaHora || hora || "00:00"}`);
  };

  return (
    <div className="fecha-hora-input">
      <input
        id={id}
        className="form-input"
        type="date"
        required={required}
        max={max?.split("T")[0]}
        min={min?.split("T")[0]}
        value={fecha ?? ""}
        onChange={(e) => actualizar(e.target.value, hora)}
      />
      <input
        className="form-input"
        type="time"
        required={required}
        value={hora ?? ""}
        onChange={(e) => actualizar(fecha, e.target.value)}
      />
    </div>
  );
}
