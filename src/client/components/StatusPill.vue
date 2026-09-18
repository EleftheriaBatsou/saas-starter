<script setup lang="ts">
defineProps<{ status: string; label?: string }>();
</script>

<template>
  <span class="badge" :class="`status-${status}`"><span class="dot" />{{ label ?? status }}</span>
</template>
