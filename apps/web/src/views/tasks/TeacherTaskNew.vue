<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/t/tasks">{{ t('classTasks') }}</router-link></p>
      <h1>{{ t('newTask') }}</h1>
      <van-form @submit="onSubmit">
        <van-field v-model="title" :label="t('title')" required />
        <van-field v-model="description" :label="t('workDescription')" type="textarea" rows="3" />
        <label class="hint">{{ t('due') }}<input v-model="due" type="datetime-local" required /></label>
        <label class="check"><input v-model="requiresSubmission" type="checkbox" /> {{ t('needsFile') }}</label>
        <div class="pad-btn"><van-button block type="primary" native-type="submit" :loading="busy">{{ t('publishNow') }}</van-button></div>
      </van-form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const title = ref('');
const description = ref('');
const due = ref('');
const requiresSubmission = ref(true);
const busy = ref(false);
const error = ref('');

async function onSubmit() {
  error.value = '';
  const dueAt = new Date(due.value).getTime();
  if (!Number.isFinite(dueAt)) {
    error.value = t('passwordInvalid');
    return;
  }
  busy.value = true;
  const result = await callFunction<{ taskId: string }>(FUNCTIONS.apiAcademic, 'task.create', {
    courseId: String(route.query.course ?? ''),
    type: 'homework',
    title: title.value,
    description: description.value,
    dueAt,
    requiresSubmission: requiresSubmission.value,
    allowLate: true,
    publish: true,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  await router.push(`/t/tasks/${result.data.taskId}`);
}
</script>

<style scoped>
input { display: block; width: 100%; margin: 8px 0 12px; font: inherit; }
.check { display: flex; gap: 8px; margin: 8px 0; }
.pad-btn { margin-top: 12px; }
</style>
