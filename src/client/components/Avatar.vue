<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ name: string; seed?: string; size?: number; square?: boolean }>(), {
  size: 32,
  square: false,
});

const PALETTES = [
  ['#7C5CFF', '#B59CFF'],
  ['#0D99FF', '#6CC8FF'],
  ['#15D7C4', '#7CF0E3'],
  ['#FF5C7C', '#FF9DB1'],
  ['#FFB020', '#FFD66B'],
  ['#2BD968', '#8BF0AE'],
  ['#9B51E0', '#D19BFF'],
];

const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join(''),
);

const gradient = computed(() => {
  const s = props.seed ?? props.name;
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[h % PALETTES.length]!;
  return `linear-gradient(135deg, ${a}, ${b})`;
});
</script>

<template>
  <span
    class="avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.38)}px`,
      borderRadius: square ? `${Math.round(size * 0.3)}px` : '50%',
      background: gradient,
    }"
    :title="name"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>

<style scoped>
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 2px 6px -2px rgba(27, 27, 47, 0.3);
  user-select: none;
}
</style>
