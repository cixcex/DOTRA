// ---------------------------------------------------------------------------
// DOTRA — minimal UI primitives (buttons, cards, sliders, toggles, modal)
// ---------------------------------------------------------------------------

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export function Button({
  children, onClick, variant = 'primary', size = 'md', disabled, loading, className = '', title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  title?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-full transition-all duration-150 select-none';
  const sizes = size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2';
  const variants = {
    primary: 'bg-ink text-paper hover:bg-neutral-800 active:scale-[0.98] disabled:bg-neutral-300 disabled:text-neutral-500',
    secondary: 'bg-white text-ink border border-line hover:border-neutral-300 hover:shadow-card active:scale-[0.98] disabled:text-neutral-400 disabled:border-line disabled:hover:shadow-none',
    ghost: 'text-mute hover:text-ink hover:bg-neutral-100 disabled:text-neutral-300',
    danger: 'bg-bad text-white hover:bg-red-700 disabled:bg-neutral-300 disabled:text-neutral-500',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`${base} ${sizes} ${variants[variant]} ${disabled || loading ? 'cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

export function Card({
  title, subtitle, actions, children, className = '', id,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`bg-white rounded-2xl border border-line shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line/70">
          <div>
            {title && <h2 className="font-display font-semibold text-[15px] tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="text-xs text-mute mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, disabled,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`grid gap-1 ${disabled ? 'opacity-50 pointer-events-none' : ''}`} style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.hint}
            className={`rounded-xl border px-3 py-2 text-left transition-all duration-150 ${
              active ? 'border-ink bg-ink text-paper shadow-card' : 'border-line bg-white text-ink hover:border-neutral-300'
            }`}
          >
            <div className="text-[13px] font-medium leading-tight">{o.label}</div>
            {o.hint && <div className={`text-[11px] mt-0.5 leading-tight ${active ? 'text-paper/60' : 'text-mute'}`}>{o.hint}</div>}
          </button>
        );
      })}
    </div>
  );
}

export function SliderRow({
  label, value, min, max, step, onChange, format, disabled, hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
      <div className="flex items-baseline justify-between mb-1.5">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">{label}</label>
        <span className="text-xs text-mute tabular-nums">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
      {hint && <p className="text-[11px] text-mute mt-1">{hint}</p>}
    </div>
  );
}

export function SelectRow({
  label, value, options, onChange, hint,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink mb-1.5">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-white border border-line rounded-xl px-3 py-2 text-sm text-ink hover:border-neutral-300 focus:border-ink transition-colors cursor-pointer pr-8"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6b6b' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {hint && <p className="text-[11px] text-mute mt-1">{hint}</p>}
      {options.find((o) => o.id === value)?.hint && (
        <p className="text-[11px] text-mute mt-1">{options.find((o) => o.id === value)?.hint}</p>
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <label htmlFor={id} className="text-[13px] font-medium text-ink cursor-pointer">{label}</label>
        {hint && <p className="text-[11px] text-mute mt-0.5">{hint}</p>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 ${checked ? 'bg-ink' : 'bg-neutral-200'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export function StatusBadge({ status, children }: { status: 'idle' | 'working' | 'optimizing' | 'verified' | 'failed'; children: React.ReactNode }) {
  const styles = {
    idle: 'bg-neutral-100 text-neutral-500 border-line',
    working: 'bg-neutral-100 text-neutral-600 border-line',
    optimizing: 'bg-amber-50 text-warn border-amber-200',
    verified: 'bg-green-50 text-ok border-green-200',
    failed: 'bg-red-50 text-bad border-red-200',
  } as const;
  const dot = {
    idle: 'bg-neutral-400',
    working: 'bg-neutral-500 anim-pulse-dot',
    optimizing: 'bg-warn anim-pulse-dot',
    verified: 'bg-ok',
    failed: 'bg-bad',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot[status]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Modal({
  open, onClose, title, children, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`relative bg-white rounded-2xl border border-line shadow-lift w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[88vh] overflow-hidden flex flex-col`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-line/70">
              <h3 className="font-display font-semibold text-base tracking-tight">{title}</h3>
              <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-mute hover:text-ink hover:bg-neutral-100 transition-colors">
                <X size={18} />
              </button>
            </header>
            <div className="overflow-y-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute mb-2.5">{children}</div>;
}

export function TextInput({
  label, value, onChange, placeholder, valid, error, hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  valid?: boolean | null;
  error?: string | null;
  hint?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div>
      {label && <label htmlFor={id} className="block text-[13px] font-medium text-ink mb-1.5">{label}</label>}
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-ink placeholder:text-neutral-400 outline-none transition-colors focus:border-ink ${
          valid === true ? 'border-green-300' : valid === false ? 'border-red-300' : 'border-line'
        }`}
      />
      {error && <p className="text-[11px] text-bad mt-1.5">{error}</p>}
      {!error && valid && hint}
    </div>
  );
}
