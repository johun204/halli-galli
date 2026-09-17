import type { ReactNode } from 'react';
import { useState } from 'react';
import { loadLastName, saveLastName } from '../identity';

export function NameGate({
  title,
  buttonLabel,
  onSubmit,
  busy,
  children,
}: {
  title: string;
  buttonLabel: string;
  onSubmit: (name: string) => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [name, setName] = useState(loadLastName);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveLastName(trimmed);
    onSubmit(trimmed);
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>🔔 할리갈리</h1>
        <p className="gate-title">{title}</p>
        <input
          className="gate-input"
          placeholder="닉네임"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="gate-button" disabled={!name.trim() || busy} onClick={submit}>
          {busy ? '처리 중…' : buttonLabel}
        </button>
        {children}
      </div>
    </div>
  );
}
