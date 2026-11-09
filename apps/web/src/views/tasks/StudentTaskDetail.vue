<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/s/tasks">{{ t('myTasks') }}</router-link></p>
      <h1>{{ task?.title }}</h1>
      <p class="hint">{{ formatDue(task?.dueAt, locale) }} · {{ progress?.displayStatus }}</p>
      <p>{{ task?.description }}</p>
      <div class="row">
        <van-button size="small" @click="start">{{ t('startWork') }}</van-button>
        <van-button v-if="task && task.requiresSubmission === false" size="small" type="primary" @click="done">{{ t('markDone') }}</van-button>
      </div>
      <van-form v-if="task?.requiresSubmission !== false" @submit="submit">
        <van-field v-model="text" :label="t('taskText')" type="textarea" rows="3" />
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('submitWork') }}</van-button></div>
      </van-form>
      <p v-if="message" class="hint">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';
import { formatDue } from './format';

const { t, locale } = useI18n();
const route = useRoute();
const task = ref<{ title: string; description: string; dueAt: number; requiresSubmission?: boolean } | null>(null);
const progress = ref<{ displayStatus: string } | null>(null);
const text = ref('');
const error = ref('');
const message = ref('');
const taskId = String(route.params.taskId);

async function load() {
  const result = await callFunction<{ task: typeof task.value; progress?: { displayStatus: string } }>(FUNCTIONS.apiAcademic, 'task.get', { taskId });
  if (!result.ok) error.value = result.error.message;
  else {
    task.value = result.data.task;
    progress.value = result.data.progress ?? null;
  }
}
async function start() {
  const result = await callFunction(FUNCTIONS.apiAcademic, 'progress.start', { taskId });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
  await load();
}
async function done() {
  const result = await callFunction(FUNCTIONS.apiAcademic, 'progress.markDone', { taskId });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
  await load();
}
async function submit() {
  const result = await callFunction(FUNCTIONS.apiAcademic, 'submission.create', { taskId, text: text.value });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
  await load();
}
onMounted(load);
</script>

<style scoped>
.row, .pad-btn { margin: 12px 0; }
</style>
