<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('settings') }}</h1>
      <van-form @submit="save">
        <van-field name="enabled" :label="t('emailEnabled')">
          <template #input><input v-model="enabled" type="checkbox" /></template>
        </van-field>
        <div class="lang">
          <button v-for="mode in modes" :key="mode" type="button" :aria-pressed="emailMode === mode" @click="emailMode = mode">{{ t(`mode.${mode}`) }}</button>
        </div>
        <van-field v-model="quietStart" :label="t('quietStart')" placeholder="22:00" />
        <van-field v-model="quietEnd" :label="t('quietEnd')" placeholder="07:00" />
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('save') }}</van-button></div>
      </van-form>
      <p v-if="message" class="hint">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../api';

const { t } = useI18n();
const modes = ['immediate', 'daily', 'weekly', 'off'] as const;
const enabled = ref(true);
const emailMode = ref<(typeof modes)[number]>('immediate');
const quietStart = ref('22:00');
const quietEnd = ref('07:00');
const error = ref('');
const message = ref('');

async function load() {
  const result = await callFunction<{
    prefs: { channels: { email: { enabled: boolean; mode: (typeof modes)[number] } }; quietHours?: { start: string; end: string } };
  }>(FUNCTIONS.apiCore, 'prefs.get', {});
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  enabled.value = result.data.prefs.channels.email.enabled;
  emailMode.value = result.data.prefs.channels.email.mode;
  quietStart.value = result.data.prefs.quietHours?.start ?? '22:00';
  quietEnd.value = result.data.prefs.quietHours?.end ?? '07:00';
}

async function save() {
  const result = await callFunction(FUNCTIONS.apiCore, 'prefs.update', {
    channels: { email: { enabled: enabled.value, mode: emailMode.value } },
    quietHours: { start: quietStart.value, end: quietEnd.value },
  });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
}

onMounted(load);
</script>

<style scoped>
.pad-btn { margin: 12px 0; }
</style>
