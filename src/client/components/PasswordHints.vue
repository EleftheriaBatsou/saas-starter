<script setup lang="ts">
import { computed } from 'vue';
import { checkPasswordPolicy } from '../../shared/password-policy.ts';

const props = defineProps<{ password: string; email?: string; name?: string }>();

const problems = computed(() => (props.password ? checkPasswordPolicy(props.password, { email: props.email, name: props.name }) : []));
const strength = computed(() => {
  const p = props.password;
  if (!p) return 0;
  let s = Math.min(p.length / 16, 1) * 2;
  s += [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length * 0.5;
  if (problems.value.length) s = Math.min(s, 1.5);
  return Math.min(Math.round(s), 4);
});
const COLORS = ['#e4e0f5', '#FF5C7C', '#FFC93C', '#0D99FF', '#2BD968'];
const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
</script>

<template>
  <div v-if="password" class="hints">
    <div class="meter">
      <span v-for="i in 4" :key="i" :style="{ background: i <= strength ? COLORS[strength] : '#EEEAFB' }" />
    </div>
    <div class="row small">
      <span :style="{ color: COLORS[strength], fontWeight: 700 }">{{ LABELS[strength] }}</span>
      <span v-if="problems.length" class="muted">— {{ problems[0] }}</span>
      <span v-else class="muted">— looks good ✓</span>
    </div>
  </div>
</template>

<style scoped>
.hints { margin: -6px 0 16px; }
.meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px; }
.meter span { height: 5px; border-radius: 4px; transition: background 0.3s; }
.row { gap: 4px; }
</style>
