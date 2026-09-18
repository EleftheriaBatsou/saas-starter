import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.ts';
import { onApiEvents } from './api.ts';
import { useSession } from './stores/session.ts';
import { toast } from './toast.ts';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

const session = useSession();
onApiEvents({
  authLost: async () => {
    await session.refresh();
    if (!router.currentRoute.value.meta.public) router.push({ path: '/login', query: { expired: '1' } });
  },
  orgChanged: async (err) => {
    toast(err.message, 'info');
    await session.refresh();
    router.push(session.activeOrg ? '/projects' : '/welcome');
  },
});

app.mount('#app');
