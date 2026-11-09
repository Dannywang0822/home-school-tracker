<template>
  <main class="frame">
    <div class="home-grid">
      <aside class="side">
        <div class="brand-mark">
          <div class="monogram">家</div>
          <div>
            <h1>{{ t('brand') }}</h1>
            <p>{{ schoolName }}</p>
          </div>
        </div>
        <div class="lang">
          <button type="button" :aria-pressed="locale === 'zh'" @click="changeLocale('zh')">中文</button>
          <button type="button" :aria-pressed="locale === 'en'" @click="changeLocale('en')">EN</button>
        </div>
        <button class="text-button" type="button" @click="onLogout">{{ t('logout') }}</button>
      </aside>
      <section class="pad">
        <p v-if="session.me?.pendingConsents.length" class="banner">{{ t('pendingConsent') }}</p>
        <h2>{{ name }}</h2>
        <p class="hint">{{ t('roles') }}</p>
        <p class="tags">
          <van-tag v-for="role in session.me?.user.roles ?? []" :key="role" type="primary" plain>{{ roleLabel(role) }}</van-tag>
        </p>
        <h3>{{ t('children') }}</h3>
        <van-cell-group v-if="session.me?.children.length" inset>
          <van-cell
            v-for="child in session.me.children"
            :key="child.studentId"
            :title="textOf(child.displayName, locale)"
            :label="`${child.programme} · ${textOf(child.className, locale)}`"
          />
        </van-cell-group>
        <p v-else class="note">{{ t('noChildren') }}</p>
        <p class="note">{{ t('weekNote') }}</p>
        <p v-if="session.me?.user.roles.includes('admin')" class="hint"><router-link to="/a">{{ t('admin') }}</router-link></p>
        <p class="hint"><router-link to="/privacy">{{ t('privacy') }}</router-link></p>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { textOf, updateLocale } from '../api';
import { setLocale } from '../i18n';
import { useSession } from '../stores/session';

const { t, locale, te } = useI18n();
const session = useSession();
const router = useRouter();

const name = computed(() => textOf(session.me?.user.displayName, locale.value));
const schoolName = computed(() => textOf(session.me?.school.name, locale.value) || t('school'));

function roleLabel(role: string): string {
  const key = `role.${role}`;
  return te(key) ? t(key) : role;
}

async function changeLocale(next: 'zh' | 'en') {
  setLocale(next);
  if (session.token) await updateLocale(next);
}

function onLogout() {
  session.logout();
  void router.push('/login');
}
</script>

<style scoped>
h2 { margin: 0 0 8px; font-size: 22px; }
h3 { margin: 18px 0 8px; font-size: 16px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.side .text-button { margin-top: 12px; }
</style>
