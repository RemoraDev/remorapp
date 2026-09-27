import { useEffect, useRef, useState } from "react";

// Selección clásica de emojis (reacciones, caras y símbolos de juego),
// nada exótico -- lo que mejora acá es la presentación (grilla en
// tarjeta con resplandor de acento), no los glifos en sí mismos, que
// siguen siendo los emoji Unicode de siempre, renderizados con la
// fuente nativa del sistema.
const EMOJIS = [
  "😀", "😂", "😅", "😉", "😍", "😎", "🤔", "😮", "😢", "😡",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🔥", "⭐", "💯", "✅",
  "❌", "❤️", "💔", "🎉", "🏆", "⚡", "😴", "🤝", "👀", "🤯",
];

export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    const handleClickFuera = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [abierto]);

  return (
    <div className="emoji-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="emoji-picker-toggle"
        onClick={() => setAbierto((a) => !a)}
        aria-label="Insertar emoji"
        title="Insertar emoji"
      >
        🙂
      </button>
      {abierto && (
        <div className="emoji-picker-panel">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="emoji-picker-item"
              onClick={() => {
                onSelect(emoji);
                setAbierto(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
