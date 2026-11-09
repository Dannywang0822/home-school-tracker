<template>
  <main class="frame">
    <section class="pad">
      <AdminNav />
      <h1>{{ t('consentReport') }}</h1>
      <p v-if="error" class="error">{{ error }}</p>
      <ul>
        <li v-for="item in items" :key="item.studentId">
          {{ textOf(item.displayName, locale) }} · {{ item.status === 'granted' ? (item.grantedVersion || t('granted')) : t('noConsentYet') }}
        </li>
      </ul>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, textOf, type I18nText } from '../../api';
import AdminNav from './AdminNav.vue';

const { t, locale } = useI18n();
const error = ref('');
const items = ref<Array<{ studentId: string; displayName: I18nText; status: string; grantedVersion?: string }>>([]);

onMounted(async () => {
  const result = await callFunction<{ items: typeof items.value }>(FUNCTIONS.apiAdmin, 'admin.consent.report');
  if (!result.ok) error.value = result.error.message;
  else items.value = result.data.items;
});
</script>

<style scoped>
h1 { font-size: 22px; }
</style>
