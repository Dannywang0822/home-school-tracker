<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/s/tasks">{{ t('myTasks') }}</router-link></p>
      <h1>{{ task?.title }}</h1>
      <p class="hint">{{ formatDue(task?.dueAt, locale) }} · {{ progress?.displayStatus }}</p>
      <p>{{ task?.description }}</p>
      <article v-if="grade" class="card">
        <h2>{{ t('grades') }}</h2>
        <p v-if="grade.myp">A {{ grade.myp.A?.level ?? '–' }} · B {{ grade.myp.B?.level ?? '–' }} · C {{ grade.myp.C?.level ?? '–' }} · D {{ grade.myp.D?.level ?? '–' }}</p>
        <p v-if="grade.dp">{{ grade.dp.score }}</p>
        <p>{{ grade.overallComment }}</p>
      </article>
      <div v-if="task" class="row">
        <van-button v-if="canStart(gate)" size="small" @click="start">{{ t('startWork') }}</van-button>
        <van-button v-if="canMarkDone(gate)" size="small" type="primary" @click="done">{{ t('markDone') }}</van-button>
      </div>
      <van-form v-if="task && canSubmit(gate)" @submit="submit">
        <van-field v-model="text" :label="t('taskText')" type="textarea" rows="3" />
        <label class="attachment">
          {{ t('attachment') }}
          <input data-attachment type="file" @change="onAttachment" />
        </label>
        <p v-if="attachmentName" class="hint">{{ attachmentName }}</p>
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('submitWork') }}</van-button></div>
      </van-form>
      <ThreadBox v-if="progress?.status" :task-id="taskId" :student-id="ownStudentId" />
      <p v-if="message" class="hint">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { canMarkDone, canStart, canSubmit, type ProgressGate } from '@hst/core';
import { callFunction, uploadDevFile } from '../../api';
import ThreadBox from '../messages/ThreadBox.vue';
import { formatDue } from './format';

const { t, locale } = useI18n();
const route = useRoute();
const task = ref<{ title: string; description: string; dueAt: number; requiresSubmission?: boolean } | null>(null);
const progress = ref<{ status: string; displayStatus: string } | null>(null);
const grade = ref<{ overallComment?: string; myp?: Record<string, { level?: number }>; dp?: { score?: number } } | null>(null);
const text = ref('');
const fileIds = ref<string[]>([]);
const attachmentName = ref('');
const error = ref('');
const message = ref('');
const taskId = String(route.params.taskId);
const ownStudentId = ref('');
const gate = computed<ProgressGate>(() => ({
  status: progress.value?.status ?? 'not_started',
  requiresSubmission: task.value?.requiresSubmission !== false,
}));

async function load() {
  const result = await callFunction<{ task: typeof task.value; progress?: { status: string; displayStatus: string }; assessment?: typeof grade.value; studentId?: string }>(FUNCTIONS.apiAcademic, 'task.get', { taskId });
  if (!result.ok) error.value = result.error.message;
  else {
    task.value = result.data.task;
    progress.value = result.data.progress ?? null;
    grade.value = result.data.assessment ?? null;
    ownStudentId.value = result.data.studentId ?? ownStudentId.value;
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
async function onAttachment(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  if (!file) return;
  error.value = '';
  const dataBase64 = await fileToBase64(file);
  const uploaded = await uploadDevFile(file.name, mimeOf(file), dataBase64);
  if (!uploaded.ok) {
    error.value = uploaded.error.message;
    return;
  }
  const committed = await callFunction<{ fileId: string }>(FUNCTIONS.apiCore, 'file.commit', {
    tmpCloudFileId: uploaded.data.tmpCloudFileId,
    name: file.name,
    mime: mimeOf(file),
    size: uploaded.data.size,
    refType: 'submission',
    refId: taskId,
  });
  if (!committed.ok) {
    error.value = committed.error.message;
    return;
  }
  fileIds.value = [committed.data.fileId];
  attachmentName.value = file.name;
}
async function submit() {
  const result = await callFunction(FUNCTIONS.apiAcademic, 'submission.create', {
    taskId,
    text: text.value,
    ...(fileIds.value.length ? { fileIds: fileIds.value } : {}),
  });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
  await load();
}
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/pdf';
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
onMounted(load);
</script>

<style scoped>
.row, .pad-btn, .attachment { margin: 12px 0; display: block; }
</style>
