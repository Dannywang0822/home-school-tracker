<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('messages') }}</h1>
      <p v-if="!items.length" class="note">{{ t('noMessages') }}</p>
      <button v-for="item in items" :key="item.threadId" type="button" class="thread" @click="open(item.threadId)">
        <strong>{{ item.contextTitle || item.threadId }}</strong>
        <span v-if="item.unreadCount"> · {{ t('unread') }} {{ item.unreadCount }}</span>
        <p>{{ item.lastMessagePreview }}</p>
      </button>
      <ThreadBox v-if="openThread" :task-id="openTask" :student-id="openStudent" />
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';
import ThreadBox from './ThreadBox.vue';

interface ThreadItem {
  threadId: string;
  contextTitle: string;
  contextId: string;
  studentId: string;
  contextType: string;
  unreadCount: number;
  lastMessagePreview: string;
}

const { t } = useI18n();
const items = ref<ThreadItem[]>([]);
const error = ref('');
const openThread = ref(false);
const openTask = ref('');
const openStudent = ref('');

async function load() {
  const result = await callFunction<{ items: ThreadItem[] }>(FUNCTIONS.apiAcademic, 'thread.listMine', {});
  if (!result.ok) error.value = result.error.message;
  else items.value = result.data.items;
}

function open(threadId: string) {
  const item = items.value.find((row) => row.threadId === threadId);
  if (!item || item.contextType !== 'task') return;
  openTask.value = item.contextId;
  openStudent.value = item.studentId;
  openThread.value = true;
}

onMounted(load);
</script>

<style scoped>
.thread { display: block; width: 100%; text-align: left; border: 0; border-top: 1px solid var(--hst-line); background: transparent; padding: 10px 0; }
</style>
