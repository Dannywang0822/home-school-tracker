<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('myTasks') }}</h1>
      <div class="lang">
        <button v-for="item in ranges" :key="item" type="button" :aria-pressed="range === item" @click="range = item">{{ item }}</button>
      </div>
      <p v-if="!items.length" class="note">{{ t('noTasks') }}</p>
      <van-cell-group v-else inset>
        <van-cell
          v-for="item in items"
          :key="item.task.taskId"
          :title="item.task.title"
          :label="`${formatDue(item.task.dueAt, locale)} · ${item.progress.displayStatus}`"
          is-link
          :to="`/s/tasks/${item.task.taskId}`"
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
import { callFunction } from '../../api';
import { formatDue } from './format';

interface Row { task: { taskId: string; title: string; dueAt: number }; progress: { displayStatus: string } }
const { t, locale } = useI18n();
const ranges = ['week', 'all', 'overdue', 'graded'] as const;
const range = ref<(typeof ranges)[number]>('all');
const items = ref<Row[]>([]);
const error = ref('');

async function load() {
  const result = await callFunction<{ items: Row[] }>(FUNCTIONS.apiAcademic, 'task.listMine', { range: range.value });
  if (!result.ok) error.value = result.error.message;
  else items.value = result.data.items;
}
onMounted(load);
watch(range, load);
</script>
