<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('classTasks') }}</h1>
      <div class="lang">
        <button v-for="course in courses" :key="course.courseId" type="button" :aria-pressed="course.courseId === courseId" @click="courseId = course.courseId">
          {{ textOf(course.name, locale) }}
        </button>
      </div>
      <p><router-link :to="`/t/tasks/new?course=${courseId}`">{{ t('newTask') }}</router-link></p>
      <p v-if="!items.length" class="note">{{ t('noTasks') }}</p>
      <van-cell-group v-else inset>
        <van-cell v-for="item in items" :key="item.taskId" :title="item.title" :label="formatDue(item.dueAt, locale)" is-link :to="`/t/tasks/${item.taskId}`" />
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
import { formatDue } from './format';

const { t, locale } = useI18n();
const courses = ref<Array<{ courseId: string; name: I18nText }>>([]);
const courseId = ref('');
const items = ref<Array<{ taskId: string; title: string; dueAt: number }>>([]);
const error = ref('');

async function loadTasks() {
  if (!courseId.value) return;
  const result = await callFunction<{ items: Array<{ taskId: string; title: string; dueAt: number }> }>(FUNCTIONS.apiAcademic, 'task.listForCourse', { courseId: courseId.value });
  if (!result.ok) error.value = result.error.message;
  else items.value = result.data.items;
}

onMounted(async () => {
  const result = await callFunction<{ items: Array<{ courseId: string; name: I18nText }> }>(FUNCTIONS.apiAcademic, 'course.listMine');
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  courses.value = result.data.items;
  courseId.value = result.data.items[0]?.courseId ?? '';
});

watch(courseId, loadTasks);
</script>
