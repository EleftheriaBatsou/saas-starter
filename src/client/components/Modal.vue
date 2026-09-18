<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{ title: string; width?: number }>();
const emit = defineEmits<{ close: [] }>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @mousedown.self="emit('close')">
      <div class="modal card" role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: `${width ?? 460}px` }">
        <header class="row">
          <h2>{{ title }}</h2>
          <span class="spacer" />
          <button class="btn btn-ghost btn-sm close" aria-label="Close" @click="emit('close')">✕</button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(27, 27, 47, 0.32);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 50;
  animation: fadein 0.2s ease;
}
.modal {
  width: 100%;
  padding: 24px;
  animation: popin 0.45s var(--spring);
  box-shadow: var(--shadow-3);
}
header {
  margin-bottom: 18px;
}
.close {
  width: 32px;
  padding: 0;
}
@keyframes fadein {
  from { opacity: 0; }
}
@keyframes popin {
  from { opacity: 0; transform: scale(0.92) translateY(12px); }
}
</style>
