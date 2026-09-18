<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="shell">
    <aside class="brand">
      <div class="blob b1" />
      <div class="blob b2" />
      <div class="blob b3" />
      <div class="brand-inner">
        <div class="logo">
          <span class="mark"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 17 12 5l7 12z" fill="#fff" /></svg></span>
          Orbit
        </div>
        <h2 class="tag">Your team's workspace —<br />private by default.</h2>
        <ul class="points">
          <li><span class="chip owner">Owner</span> runs the show</li>
          <li><span class="chip admin">Admin</span> manages people</li>
          <li><span class="chip member">Member</span> gets work done</li>
        </ul>
      </div>
    </aside>
    <main class="panel">
      <div class="card form-card">
        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="muted sub">{{ subtitle }}</p>
        <slot />
      </div>
      <div class="below"><slot name="below" /></div>
    </main>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: grid; grid-template-columns: minmax(360px, 44%) 1fr; }
.brand {
  position: relative; overflow: hidden; background: #1b1b2f; color: #fff; padding: 48px;
  display: flex; align-items: flex-end;
}
.blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: 0.85; animation: float 12s ease-in-out infinite; }
.b1 { width: 380px; height: 380px; background: #7c5cff; top: -80px; left: -60px; }
.b2 { width: 300px; height: 300px; background: #0d99ff; top: 30%; right: -80px; animation-delay: -4s; }
.b3 { width: 260px; height: 260px; background: #15d7c4; bottom: -60px; left: 30%; animation-delay: -8s; opacity: 0.6; }
@keyframes float { 50% { transform: translate(24px, -18px) scale(1.06); } }
.brand-inner { position: relative; }
.logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; margin-bottom: 40px; }
.mark {
  width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.16); backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.25);
}
.tag { font-size: 34px; font-weight: 800; line-height: 1.15; letter-spacing: -0.03em; margin-bottom: 28px; }
.points { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; font-weight: 600; color: rgba(255, 255, 255, 0.85); }
.chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; margin-right: 8px; color: #fff; }
.chip.owner { background: #7c5cff; }
.chip.admin { background: #0d99ff; }
.chip.member { background: #15d7c4; color: #073b36; }
.panel { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; }
.form-card { width: 100%; max-width: 420px; padding: 32px; animation: rise 0.6s var(--spring); }
@keyframes rise { from { opacity: 0; transform: translateY(16px) scale(0.98); } }
.sub { margin: 6px 0 24px; }
h1 { font-size: 26px; }
.below { margin-top: 18px; font-size: 14px; color: var(--ink-2); text-align: center; max-width: 420px; }
@media (max-width: 860px) {
  .shell { grid-template-columns: 1fr; }
  .brand { display: none; }
}
</style>
