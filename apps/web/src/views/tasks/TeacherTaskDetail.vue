<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/t/tasks">{{ t('classTasks') }}</router-link></p>
      <h1>{{ task?.title }}</h1>
      <p class="hint">{{ formatDue(task?.dueAt, locale) }}</p>
      <p>{{ task?.description }}</p>
      <h2>{{ t('completion') }}</h2>
      <van-cell-group inset>
        <van-cell
          v-for="item in items"
          :key="String(item.studentId)"
          :title="textOf(item.displayName, locale)"
          :label="`${item.displayStatus} · ${item.assessmentStatus ?? ''}`"
          is-link
          :to="`/t/tasks/${taskId}/grade/${item.studentId}`"
        />
      </van-cell-group>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, textOf, type I18nText } from '../../api';
import { formatDue } from './format';

const { t, locale } = useI18n();
const route = useRoute();
const taskId = String(route.params.taskId);
const task = ref<{ title: string; description: string; dueAt: number } | null>(null);
const items = ref<Array<{ studentId: string; displayName: I18nText; displayStatus: string; assessmentStatus?: string }>>([]);
const error = ref('');

onMounted(async () => {
  const detail = await callFunction<{ task: { title: string; description: string; dueAt: number } }>(FUNCTIONS.apiAcademic, 'task.get', { taskId });
  if (!detail.ok) error.value = detail.error.message;
  else task.value = detail.data.task;
  const roster = await callFunction<{ items: typeof items.value }>(FUNCTIONS.apiAcademic, 'progress.listForTask', { taskId });
  if (roster.ok) items.value = roster.data.items;
});
</script>
