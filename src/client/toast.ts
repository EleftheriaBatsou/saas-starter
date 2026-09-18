import { reactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

export function toast(message: string, kind: ToastKind = 'success', ms = 3600) {
  const id = ++seq;
  toasts.push({ id, message, kind });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}
