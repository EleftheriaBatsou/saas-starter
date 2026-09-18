<script setup lang="ts">
import { toasts } from '../toast.ts';
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="pop">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        <span class="icon">{{ t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i' }}</span>
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  align-items: center;
  pointer-events: none;
}
.toast {
  display: flex;
  gap: 10px;
  align-items: center;
  background: var(--ink);
  color: #fff;
  padding: 10px 16px 10px 10px;
  border-radius: 14px;
  font-weight: 600;
  font-size: 14px;
  box-shadow: var(--shadow-3);
  max-width: min(520px, 90vw);
}
.icon {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 13px;
  flex-shrink: 0;
}
.success .icon { background: var(--active); }
.error .icon { background: var(--danger); }
.info .icon { background: var(--admin); }
</style>
