<template>
  <main class="frame">
    <div class="pad">
      <h1>{{ t('firstLogin') }}</h1>
      <p class="hint">{{ t('passwordHint') }}</p>
      <van-form @submit="onSubmit">
        <van-field v-model="password" type="password" :label="t('newPassword')" required />
        <div class="pad-btn">
          <van-button block type="primary" native-type="submit" :loading="busy">{{ t('savePassword') }}</van-button>
        </div>
      </van-form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="saved" class="hint">{{ t('passwordSaved') }}</p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { markPasswordChanged, setDevPassword } from '../api';
import { useSession } from '../stores/session';

const { t } = useI18n();
const router = useRouter();
const session = useSession();
const password = ref('');
const error = ref('');
const saved = ref(false);
const busy = ref(false);

function strong(value: string): boolean {
  if (value.length < 8 || value.length > 32) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  return classes >= 3;
}

async function onSubmit() {
  error.value = '';
  saved.value = false;
  if (!strong(password.value)) {
    error.value = t('passwordInvalid');
    return;
  }
  busy.value = true;
  const savedPassword = await setDevPassword(password.value);
  if (!savedPassword.ok) {
    busy.value = false;
    error.value = savedPassword.error.message;
    return;
  }
  const result = await markPasswordChanged();
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  saved.value = true;
  await session.refresh();
  await router.push('/home');
}
</script>

<style scoped>
.pad-btn { margin-top: 16px; }
</style>
