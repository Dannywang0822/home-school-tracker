<template>
  <section>
    <h2>{{ t('messages') }}</h2>
    <article v-for="item in items" :key="item.messageId" class="card">
      <p class="hint">{{ item.authorRole }} · {{ item.kind }}</p>
      <p>{{ item.body }}</p>
    </article>
    <van-form @submit="send">
      <van-field v-model="body" :label="t('comment')" type="textarea" rows="2" />
      <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('sendComment') }}</van-button></div>
    </van-form>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';

const props = defineProps<{ taskId: string; studentId: string }>();
const { t } = useI18n();
const items = ref<Array<{ messageId: string; authorRole: string; kind: string; body: string }>>([]);
const body = ref('');
const error = ref('');
const threadId = ref('');

async function load() {
  const thread = await callFunction<{ threadId: string }>(FUNCTIONS.apiAcademic, 'thread.getOrCreate', {
    contextType: 'task',
    contextId: props.taskId,
    studentId: props.studentId,
  });
  if (!thread.ok) {
    error.value = thread.error.message;
    return;
  }
  threadId.value = thread.data.threadId;
  const messages = await callFunction<{ items: typeof items.value }>(FUNCTIONS.apiAcademic, 'message.list', { threadId: threadId.value });
  if (messages.ok) items.value = messages.data.items;
  await callFunction(FUNCTIONS.apiAcademic, 'thread.markRead', { threadId: threadId.value });
}

async function send() {
  if (!threadId.value || !body.value.trim()) return;
  const result = await callFunction(FUNCTIONS.apiAcademic, 'message.post', { threadId: threadId.value, body: body.value.trim() });
  if (!result.ok) error.value = result.error.message;
  else {
    body.value = '';
    await load();
  }
}

onMounted(load);
</script>

<style scoped>
.card { border-top: 1px solid var(--hst-line); padding: 8px 0; }
.pad-btn { margin: 12px 0; }
</style>
