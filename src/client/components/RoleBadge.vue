<script setup lang="ts">
import type { Role } from '../../shared/permissions.ts';
defineProps<{ role: Role }>();
</script>

<template>
  <span class="badge" :class="`role-${role}`"><span class="dot" />{{ role }}</span>
</template>
