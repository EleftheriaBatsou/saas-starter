<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import TopBar from './components/TopBar.vue';
import Toasts from './components/Toasts.vue';
import VerifyBanner from './components/VerifyBanner.vue';
import { useSession } from './stores/session.ts';

const route = useRoute();
const session = useSession();
const chrome = computed(() => Boolean(session.user) && !route.meta.public);
</script>

<template>
  <TopBar v-if="chrome" />
  <VerifyBanner v-if="chrome && session.user && !session.user.emailVerifiedAt" />
  <RouterView v-slot="{ Component }">
    <Transition name="fade" mode="out-in">
      <component :is="Component" :key="`${route.matched[0]?.path}:${session.orgEpoch}`" />
    </Transition>
  </RouterView>
  <Toasts />
</template>
