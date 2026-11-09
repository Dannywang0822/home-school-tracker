<template>
  <main class="frame">
    <section class="pad">
      <AdminNav />
      <h1>{{ t('importData') }}</h1>
      <label class="hint">
        <select v-model="type">
          <option value="users">users</option>
          <option value="guardianships">guardianships</option>
          <option value="courses">courses</option>
          <option value="teaching">teaching</option>
          <option value="enrollments">enrollments</option>
          <option value="mentorships">mentorships</option>
        </select>
      </label>
      <input class="file" type="file" accept=".csv,text/csv" @change="onFile" />
      <textarea v-model="csv" rows="8" />
      <div class="row">
        <van-button type="primary" :loading="busy" @click="onValidate">{{ t('validate') }}</van-button>
        <van-button plain type="primary" :disabled="!jobId" @click="onRun">{{ t('runImport') }}</van-button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <h2 v-if="errors.length">{{ t('errors') }}</h2>
      <ul>
        <li v-for="item in errors" :key="`${item.row}-${item.code}`">{{ item.row }} · {{ item.code }} · {{ item.message }}</li>
      </ul>
      <h2 v-if="preview.length">{{ t('preview') }}</h2>
      <pre v-if="preview.length">{{ JSON.stringify(preview, null, 2) }}</pre>
      <p v-if="credentials.length" class="banner">{{ t('credentialsOnce') }}</p>
      <ul>
        <li v-for="item in credentials" :key="item.email">{{ item.email }} · {{ item.tempPassword }}</li>
      </ul>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';
import AdminNav from './AdminNav.vue';

const { t } = useI18n();
const type = ref('users');
const csv = ref('');
const jobId = ref('');
const error = ref('');
const busy = ref(false);
const errors = ref<Array<{ row: number; code: string; message: string }>>([]);
const preview = ref<unknown[]>([]);
const credentials = ref<Array<{ email: string; tempPassword: string }>>([]);

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    csv.value = String(reader.result ?? '');
  };
  reader.readAsText(file);
}

async function onValidate() {
  error.value = '';
  errors.value = [];
  preview.value = [];
  credentials.value = [];
  jobId.value = '';
  busy.value = true;
  const result = await callFunction<{ jobId: string; preview: unknown[] }>(FUNCTIONS.apiAdmin, 'admin.import.validate', {
    type: type.value,
    csv: csv.value,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    const details = result.error.details;
    if (details && Array.isArray(details.errors)) errors.value = details.errors as typeof errors.value;
    return;
  }
  jobId.value = result.data.jobId;
  preview.value = result.data.preview;
}

async function onRun() {
  error.value = '';
  const ran = await callFunction(FUNCTIONS.apiAdmin, 'admin.import.run', { jobId: jobId.value });
  if (!ran.ok) {
    error.value = ran.error.message;
    return;
  }
  const status = await callFunction<{ credentials: Array<{ email: string; tempPassword: string }> }>(
    FUNCTIONS.apiAdmin,
    'admin.import.status',
    { jobId: jobId.value },
  );
  if (!status.ok) {
    error.value = status.error.message;
    return;
  }
  credentials.value = status.data.credentials;
}
</script>

<style scoped>
textarea, select, .file { width: 100%; margin: 8px 0; font: inherit; }
.row { display: flex; gap: 8px; }
pre { white-space: pre-wrap; font-size: 12px; }
</style>
