"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updatedAt: number | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}: нечитаемый ответ сервера`);
  }
  const body = json as { success?: boolean; error?: string; message?: string } & T;
  if (!res.ok || body.success === false) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return body;
}

export function useApi<T>(url: string | null, pollMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      const body = await fetchJson<T>(url);
      if (!mounted.current) return;
      setData(body);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    refresh();
    let id: ReturnType<typeof setInterval> | null = null;
    if (pollMs > 0) id = setInterval(refresh, pollMs);
    return () => {
      mounted.current = false;
      if (id) clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { data, error, loading, refresh, updatedAt };
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/* ================= Tiny toast bus ================= */

export type ToastTone = "ok" | "err" | "info";
export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let toastId = 0;

export function toast(tone: ToastTone, title: string, text?: string) {
  const item: ToastItem = { id: ++toastId, tone, title, text };
  listeners.forEach((l) => l(item));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
