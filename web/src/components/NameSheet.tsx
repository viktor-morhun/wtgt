import { useEffect, useState } from 'react';
import { NAME_MAX } from '@wtgt/shared';

/** Шторка смены ника: новый ник сразу виден всем в комнате. */
export function NameSheet({
  current,
  onSave,
  onClose,
}: {
  current: string;
  onSave(name: string): void;
  onClose(): void;
}) {
  const [name, setName] = useState(current);
  const valid = name.trim().length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="sheet release-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSave(name.trim());
          onClose();
        }}
      >
        <div className="search-field">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ник"
            maxLength={NAME_MAX}
            aria-label="Ник"
          />
        </div>
        <button className="btn btn-wide rp" disabled={!valid}>
          Сохранить
        </button>
      </form>
    </div>
  );
}
