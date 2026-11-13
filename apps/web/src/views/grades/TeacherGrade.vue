<template>
  <main class="frame">
    <section class="pad">
      <p><router-link :to="`/t/tasks/${taskId}`">{{ t('classTasks') }}</router-link></p>
      <h1>{{ taskTitle }}</h1>
      <h2>{{ t('submissions') }}</h2>
      <p v-if="!submissions.length" class="note">{{ t('noTasks') }}</p>
      <article v-for="item in submissions" :key="item.version" class="card">
        <p>v{{ item.version }} · {{ item.isLate ? t('late') : t('submitWork') }}</p>
        <p>{{ item.text }}</p>
      </article>
      <h2>{{ t('grade') }}</h2>
      <van-form @submit="onSave">
        <template v-if="scheme === 'DP'">
          <van-field v-model="dpScore" type="digit" :label="t('score')" :placeholder="'1-7'" />
        </template>
        <template v-else>
          <van-field v-for="key in criteria" :key="key" v-model="levels[key]" type="digit" :label="`${t('criterion')} ${key}`" placeholder="0-8" />
        </template>
        <van-field v-model="overall" :label="t('overallComment')" type="textarea" rows="3" />
        <div class="row">
          <van-button block native-type="submit">{{ released ? t('updateGrade') : t('saveDraft') }}</van-button>
          <van-button v-if="!released" block type="primary" native-type="button" @click="onRelease">{{ t('releaseGrade') }}</van-button>
        </div>
      </van-form>
      <p v-if="message" class="hint">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';

const { t } = useI18n();
const route = useRoute();
const taskId = String(route.params.taskId);
const studentId = String(route.params.studentId);
const taskTitle = ref('');
const scheme = ref<'MYP' | 'DP'>('MYP');
const criteria = ref<string[]>([]);
const levels = reactive<Record<string, string>>({ A: '', B: '', C: '', D: '' });
const dpScore = ref('');
const overall = ref('');
const version = ref<number | undefined>();
const released = ref(false);
const submissions = ref<Array<{ version: number; text: string; isLate: boolean }>>([]);
const error = ref('');
const message = ref('');

function payload() {
  const body: Record<string, unknown> = { taskId, studentId, overallComment: overall.value, version: version.value };
  if (scheme.value === 'DP') body.dp = { score: Number(dpScore.value) };
  else {
    const myp: Record<string, { level: number }> = {};
    for (const key of criteria.value) {
      if (levels[key] !== '') myp[key] = { level: Number(levels[key]) };
    }
    body.myp = myp;
  }
  return body;
}

async function load() {
  const detail = await callFunction<{
    task: { title: string; assessment?: { scheme?: string; criteria?: string[] } | null };
    assessment?: { status?: string; version?: number; overallComment?: string; myp?: Record<string, { level?: number }>; dp?: { score?: number } };
  }>(FUNCTIONS.apiAcademic, 'task.get', { taskId, studentId });
  if (!detail.ok) {
    error.value = detail.error.message;
    return;
  }
  taskTitle.value = detail.data.task.title;
  const config = detail.data.task.assessment;
  scheme.value = config?.scheme === 'DP' ? 'DP' : 'MYP';
  criteria.value = config?.criteria ?? [];
  const grade = detail.data.assessment;
  if (grade) {
    released.value = grade.status === 'released';
    version.value = grade.version;
    overall.value = grade.overallComment ?? '';
    dpScore.value = grade.dp?.score != null ? String(grade.dp.score) : '';
    for (const key of ['A', 'B', 'C', 'D']) {
      const level = grade.myp?.[key]?.level;
      if (level != null) levels[key] = String(level);
    }
  }
  const work = await callFunction<{ items: typeof submissions.value }>(FUNCTIONS.apiAcademic, 'submission.list', { taskId, studentId });
  if (work.ok) submissions.value = work.data.items;
}

async function onSave() {
  error.value = '';
  const action = released.value ? 'assessment.update' : 'assessment.save';
  const result = await callFunction<{ version?: number }>(FUNCTIONS.apiAcademic, action, payload());
  if (!result.ok) error.value = result.error.message;
  else {
    message.value = t('saved');
    if (result.data.version != null) version.value = result.data.version;
  }
}

async function onRelease() {
  error.value = '';
  const saved = await callFunction<{ version?: number }>(FUNCTIONS.apiAcademic, 'assessment.save', payload());
  if (!saved.ok) {
    error.value = saved.error.message;
    return;
  }
  if (saved.data.version != null) version.value = saved.data.version;
  const result = await callFunction(FUNCTIONS.apiAcademic, 'assessment.release', { taskId, studentIds: [studentId] });
  if (!result.ok) error.value = result.error.message;
  else {
    released.value = true;
    message.value = t('releaseGrade');
  }
}

onMounted(load);
</script>

<style scoped>
.card { border-top: 1px solid var(--hst-line); padding: 8px 0; }
.row { display: flex; gap: 8px; margin: 12px 0; }
</style>
