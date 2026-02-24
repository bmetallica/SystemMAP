// ─── API Client ──────────────────────────────────────────────────────────
// Robuster Axios-Client mit Retry-Logik für instabile Verbindungen

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth';

// ─── Verbindungs-Status (global sichtbar für UI-Komponenten) ──────────
let _online = navigator.onLine;
const _listeners = new Set<(online: boolean) => void>();

export function isOnline() { return _online; }
export function onConnectionChange(fn: (online: boolean) => void) {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
function setOnline(v: boolean) {
  if (v === _online) return;
  _online = v;
  _listeners.forEach(fn => fn(v));
}

window.addEventListener('online',  () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

// ─── Retry-Konfiguration ─────────────────────────────────────────────
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;  // Basis-Delay (verdoppelt sich pro Retry)
const TIMEOUT_MS     = 30_000; // 30s Request-Timeout

// Status-Codes die NICHT wiederholt werden sollen
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
}

function shouldRetry(error: AxiosError): boolean {
  const config = error.config as RetryConfig | undefined;
  if (!config) return false;

  const count = config._retryCount ?? 0;
  if (count >= MAX_RETRIES) return false;

  // Kein Retry bei bestimmten HTTP-Codes
  if (error.response && NO_RETRY_STATUSES.has(error.response.status)) return false;

  // Retry bei: Netzwerk-Fehler, Timeout, 5xx Server-Fehler
  if (!error.response) return true;  // Netzwerk-Fehler / Timeout
  if (error.response.status >= 500) return true;
  if (error.code === 'ECONNABORTED') return true;

  return false;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Axios-Instanz ───────────────────────────────────────────────────
const api = axios.create({
  baseURL: '/api',
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// Request-Interceptor: JWT-Token automatisch anhängen
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response-Interceptor: Retry-Logik + Auto-Logout bei 401
api.interceptors.response.use(
  (response) => {
    // Erfolgreiche Antwort → Verbindung ist ok
    setOnline(true);
    return response;
  },
  async (error: AxiosError) => {
    // Bei 401 → Ausloggen
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Retry-Logik
    if (shouldRetry(error)) {
      const config = error.config as RetryConfig;
      config._retryCount = (config._retryCount ?? 0) + 1;
      const waitMs = RETRY_DELAY_MS * Math.pow(2, config._retryCount - 1);
      console.warn(
        `🔄 Retry ${config._retryCount}/${MAX_RETRIES} nach ${waitMs}ms: ${config.method?.toUpperCase()} ${config.url}`
      );

      // Wenn kein Response → Netzwerk-Problem melden
      if (!error.response) setOnline(false);

      await delay(waitMs);
      return api.request(config);
    }

    // Endgültig gescheitert → Offline-Status setzen bei Netzwerk-Fehler
    if (!error.response) setOnline(false);

    return Promise.reject(error);
  }
);

export default api;
