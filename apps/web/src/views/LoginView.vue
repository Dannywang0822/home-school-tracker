<template>
  <main class="frame">
    <div class="pad">
      <div class="brand-mark">
        <div class="monogram">家</div>
        <div>
          <h1>{{ t('brand') }}</h1>
          <p>{{ t('programme') }}</p>
        </div>
      </div>
      <div class="lang">
        <button type="button" :aria-pressed="locale === 'zh'" @click="setLocale('zh')">中文</button>
        <button type="button" :aria-pressed="locale === 'en'" @click="setLocale('en')">EN</button>
      </div>
      <h2>{{ t('loginTitle') }}</h2>
      <van-tabs v-model:active="tab">
        <van-tab :title="t('passwordTab')" name="password">
          <van-form @submit="onPassword">
            <van-field v-model="email" type="email" autocomplete="username" :label="t('email')" :placeholder="t('email')" required />
            <van-field v-model="password" type="password" autocomplete="current-password" :label="t('password')" :placeholder="t('password')" required />
            <div class="pad-btn">
              <van-button block type="primary" native-type="submit" :loading="busy">{{ t('signIn') }}</van-button>
            </div>
          </van-form>
        </van-tab>
        <van-tab :title="t('codeTab')" name="code">
          <van-form @submit="onCode">
            <van-field v-model="email" type="email" autocomplete="username" :label="t('email')" required />
            <van-field v-model="code" maxlength="6" :label="t('code')" required />
            <div class="pad-btn row">
              <van-button plain type="primary" native-type="button" :loading="sending" @click="onSend">{{ t('sendCode') }}</van-button>
              <van-button type="primary" native-type="submit" :loading="busy">{{ t('signIn') }}</van-button>
            </div>
            <p v-if="demoCode" class="banner">{{ t('demoCode') }} {{ demoCode }}</p>
            <p v-else-if="sent" class="hint">{{ t('codeSent') }}</p>
          </van-form>
        </van-tab>
      </van-tabs>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="hint"><router-link to="/privacy">{{ t('privacy') }}</router-link></p>
      <p class="hint"><router-link to="/plan">{{ t('plan') }}</router-link></p>
      <div v-if="showAccounts" class="demo">
        <p>{{ t('demoHint') }} DemoOnly-2026!</p>
        <ul>
          <li>p1@demo.school.local · {{ t('role.parent') }}</li>
          <li>t1@demo.school.local · {{ t('role.teacher') }}</li>
          <li>s1@demo.school.local · {{ t('role.student') }}</li>
          <li>a1@demo.school.local · {{ t('role.admin') }}</li>
          <li>p5@demo.school.local · {{ t('role.parent') }}</li>
          <li>minor@demo.school.local · {{ t('role.student') }}</li>
        </ul>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { setLocale } from '../i18n';
import { useSession } from '../stores/session';

const { t, locale } = useI18n();
const router = useRouter();
const session = useSession();
const tab = ref('password');
const email = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);
const sending = ref(false);
const sent = ref(false);
const demoCode = ref('');
const showAccounts = import.meta.env.DEV || import.meta.env.VITE_STATIC_DEMO === 'true';

async function onPassword() {
  error.value = '';
  busy.value = true;
  const result = await session.loginWithPassword(email.value, password.value);
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  await router.push(session.me?.user.mustChangePassword ? '/first-login' : '/home');
}

async function onSend() {
  error.value = '';
  sending.value = true;
  const result = await session.requestCode(email.value);
  sending.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  sent.value = true;
  demoCode.value = result.data.demoCode ?? '';
}

async function onCode() {
  error.value = '';
  busy.value = true;
  const result = await session.loginWithCode(email.value, code.value);
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  await router.push('/home');
}
</script>

<style scoped>
h2 { font-size: 18px; margin: 0 0 8px; }
.pad-btn { margin: 16px 0 8px; }
.row { display: flex; gap: 8px; }
.row .van-button { flex: 1; }
</style>
