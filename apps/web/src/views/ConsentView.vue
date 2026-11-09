<template>
  <main class="frame">
    <section class="pad">
      <h1>{{ t('consentTitle') }}</h1>
      <p>{{ t('consentBody') }}</p>
      <p v-if="minorBlocked" class="banner">{{ t('consentMinor') }}</p>
      <article v-if="policy">{{ textOf(policy, locale) }}</article>
      <van-form v-if="!minorBlocked" @submit="onGrant">
        <label class="check"><input v-model="accepted" type="checkbox" /> basic_processing</label>
        <div class="pad-btn">
          <van-button block type="primary" native-type="submit" :disabled="!accepted || !studentId" :loading="busy">{{ t('grant') }}</van-button>
        </div>
      </van-form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, textOf, type I18nText } from '../api';
import { useSession } from '../stores/session';

const { t, locale } = useI18n();
const router = useRouter();
const session = useSession();
const policy = ref<I18nText | null>(null);
const version = ref('');
const studentId = ref('');
const accepted = ref(false);
const error = ref('');
const busy = ref(false);
const minorBlocked = computed(() => session.me?.user.roles.includes('student') && !session.me.user.roles.includes('parent') && session.me.user.status === 'pending_consent');

onMounted(async () => {
  const status = await callFunction<{ items: Array<{ studentId: string; required: boolean }> }>(FUNCTIONS.apiCore, 'consent.status');
  if (status.ok) studentId.value = status.data.items.find((item) => item.required)?.studentId ?? status.data.items[0]?.studentId ?? '';
  const kind = 'guardian_minor';
  const text = await callFunction<{ version: string; content: I18nText }>(FUNCTIONS.authPublic, 'consent.policy', { kind, locale: locale.value });
  if (text.ok) {
    policy.value = text.data.content;
    version.value = text.data.version;
  }
});

async function onGrant() {
  error.value = '';
  busy.value = true;
  const result = await callFunction(FUNCTIONS.apiCore, 'consent.grant', {
    studentId: studentId.value,
    policyVersion: version.value,
    scopes: ['basic_processing'],
  });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  await session.refresh();
  await router.push('/home');
}
</script>

<style scoped>
article { background: #f7f4ec; border-radius: 8px; padding: 12px; }
.check { display: flex; gap: 8px; margin: 12px 0; }
.pad-btn { margin-top: 12px; }
</style>
