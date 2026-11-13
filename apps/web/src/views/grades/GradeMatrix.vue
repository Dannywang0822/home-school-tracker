<template>
  <main class="frame wide">
    <section class="pad">
      <p><router-link to="/t/tasks">{{ t('classTasks') }}</router-link></p>
      <h1>{{ t('gradeMatrix') }}</h1>
      <div class="matrix-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t('children') }}</th>
              <th v-for="task in tasks" :key="task.taskId">
                {{ task.title }}
                <button type="button" @click="releaseAll(task.taskId)">{{ t('releaseGrade') }}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="student in students" :key="student.studentId">
              <td>{{ textOf(student.displayName, locale) }}</td>
              <td v-for="task in tasks" :key="task.taskId">
                <router-link :to="`/t/tasks/${task.taskId}/grade/${student.studentId}`">{{ cell(student.studentId, task.taskId) }}</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>{{ t('distribution') }}</h2>
      <div v-for="(bucket, key) in bars" :key="key" class="dist">
        <p>{{ key }}</p>
        <div class="bars">
          <span v-for="(count, level) in bucket" :key="level" class="bar" :style="{ height: `${4 + count * 14}px` }" :title="`${level}: ${count}`">{{ level }}</span>
        </div>
      </div>
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

interface GradeItem {
  taskId: string;
  status?: string;
  myp?: Record<string, { level?: number }>;
  dp?: { score?: number };
}

const { t, locale } = useI18n();
const route = useRoute();
const courseId = String(route.params.courseId);
const tasks = ref<Array<{ taskId: string; title: string }>>([]);
const students = ref<Array<{ studentId: string; displayName: I18nText }>>([]);
const grades = ref<Record<string, GradeItem[]>>({});
const bars = ref<Record<string, Record<string, number>>>({});
const error = ref('');

function cell(studentId: string, taskId: string): string {
  const item = grades.value[studentId]?.find((grade) => grade.taskId === taskId);
  if (!item) return '–';
  if (item.dp?.score != null) return String(item.dp.score);
  const parts = ['A', 'B', 'C', 'D']
    .map((key) => (item.myp?.[key]?.level != null ? `${key}${item.myp[key]?.level}` : ''))
    .filter(Boolean);
  return parts.join(' ') || item.status || '–';
}

async function releaseAll(taskId: string) {
  const result = await callFunction(FUNCTIONS.apiAcademic, 'assessment.release', { taskId, all: true });
  if (!result.ok) error.value = result.error.message;
  else await load();
}

async function load() {
  const taskResult = await callFunction<{ items: Array<{ taskId: string; title: string }> }>(FUNCTIONS.apiAcademic, 'task.listForCourse', { courseId });
  if (!taskResult.ok) {
    error.value = taskResult.error.message;
    return;
  }
  tasks.value = taskResult.data.items;
  const roster = await callFunction<{ items: typeof students.value }>(FUNCTIONS.apiAcademic, 'course.roster', { courseId });
  if (!roster.ok) {
    error.value = roster.error.message;
    return;
  }
  students.value = roster.data.items;
  const next: Record<string, GradeItem[]> = {};
  for (const student of students.value) {
    const listed = await callFunction<{ items: GradeItem[] }>(FUNCTIONS.apiAcademic, 'assessment.listByStudent', {
      studentId: student.studentId,
      includeDraft: true,
    });
    if (listed.ok) next[student.studentId] = listed.data.items;
  }
  grades.value = next;
  const distribution = await callFunction<Record<string, Record<string, number> | number>>(FUNCTIONS.apiAcademic, 'criteria.distribution', { courseId });
  if (distribution.ok) {
    const data = distribution.data;
    if (data.A && typeof data.A === 'object') bars.value = data as Record<string, Record<string, number>>;
    else bars.value = { DP: data as Record<string, number> };
  }
}

onMounted(load);
</script>

<style scoped>
.matrix-scroll { overflow-x: auto; }
table { border-collapse: collapse; min-width: 640px; }
th, td { border-bottom: 1px solid var(--hst-line); padding: 8px; text-align: left; vertical-align: top; }
.bars { display: flex; align-items: flex-end; gap: 4px; min-height: 72px; }
.bar { display: inline-flex; align-items: flex-end; justify-content: center; width: 18px; background: #d7e3da; font-size: 10px; }
button { display: block; margin-top: 4px; }
</style>
