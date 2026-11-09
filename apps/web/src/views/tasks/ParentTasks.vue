<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('childTasks') }}</h1>
      <div class="lang">
        <button v-for="child in children" :key="child.studentId" type="button" :aria-pressed="child.studentId === studentId" @click="studentId = child.studentId">
          {{ textOf(child.displayName, locale) }}
        </button>
      </div>
      <p v-if="!items.length" class="note">{{ t('noTasks') }}</p>
      <van-cell-group v-else inset>
        <van-cell
          v-for="item in items"
          :key="item.task.taskId"
          :title="item.task.title"
          :label="`${formatDue(item.task.dueAt, locale)} · ${item.progress.displayStatus}`"
          is-link
          :to="`/p/tasks/${item.task.taskId}?student=${studentId}`"
        />
      </van-cell-group>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, textOf, type I18nText } from '../../api';
import { useSession } from '../../stores/session';
import { formatDue } from './format';

interface Row { task: { taskId: string; title: string; dueAt: number }; progress: { displayStatus: string } }
const { t, locale } = useI18n();
const session = useSession();
const children = ref<Array<{ studentId: string; displayName: I18nText }>>([]);
const studentId = ref('');
const items = ref<Row[]>([]);
const error = ref('');

async function load() {
  if (!studentId.value) return;
  const result = await callFunction<{ items: Row[] }>(FUNCTIONS.apiAcademic, 'task.listForChild', { studentId: studentId.value, range: 'all' });
  if (!result.ok) error.value = result.error.message;
  else items.value = result.data.items;
}
onMounted(() => {
  children.value = session.me?.children ?? [];
  studentId.value = children.value[0]?.studentId ?? '';
});
watch(studentId, load);
</script>
