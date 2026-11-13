<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/p/tasks">{{ t('childTasks') }}</router-link></p>
      <h1>{{ task?.title }}</h1>
      <p class="hint">{{ formatDue(task?.dueAt, locale) }} · {{ progress?.displayStatus }}</p>
      <p>{{ task?.description }}</p>
      <article v-if="grade" class="card">
        <h2>{{ t('grades') }}</h2>
        <p v-if="grade.myp">A {{ grade.myp.A?.level ?? '–' }} · B {{ grade.myp.B?.level ?? '–' }} · C {{ grade.myp.C?.level ?? '–' }} · D {{ grade.myp.D?.level ?? '–' }}</p>
        <p v-if="grade.dp">{{ grade.dp.score }}</p>
        <p>{{ grade.overallComment }}</p>
      </article>
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
const task = ref<{ title: string; description: string; dueAt: number } | null>(null);
const progress = ref<{ displayStatus: string } | null>(null);
const grade = ref<{ overallComment?: string; myp?: Record<string, { level?: number }>; dp?: { score?: number } } | null>(null);
const error = ref('');

onMounted(async () => {
  const result = await callFunction<{ task: typeof task.value; progress?: { displayStatus: string }; assessment?: typeof grade.value }>(FUNCTIONS.apiAcademic, 'task.get', {
    taskId: String(route.params.taskId),
    studentId: String(route.query.student ?? ''),
  });
  if (!result.ok) error.value = result.error.message;
  else {
    task.value = result.data.task;
    progress.value = result.data.progress ?? null;
    grade.value = result.data.assessment ?? null;
  }
});
</script>
