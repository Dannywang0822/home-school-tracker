<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('notifications') }}</h1>
      <div v-if="children.length" class="lang">
        <button type="button" :aria-pressed="childId === ''" @click="childId = ''">{{ t('allChildren') }}</button>
        <button v-for="child in children" :key="child.studentId" type="button" :aria-pressed="childId === child.studentId" @click="childId = child.studentId">
          {{ textOf(child.displayName, locale) }}
        </button>
      </div>
      <p><button type="button" @click="markAll">{{ t('markAllRead') }}</button></p>
      <p class="hint">{{ t('unread') }} {{ unreadCount }}</p>
      <article v-for="item in items" :key="item.id" class="card">
        <p><strong>{{ textOf(item.title, locale) }}</strong></p>
        <p>{{ textOf(item.body, locale) }}</p>
        <p v-if="item.readAt == null" class="hint">{{ t('unread') }}</p>
      </article>
      <p v-if="!items.length" class="note">{{ t('noNotifications') }}</p>
      <template v-if="demoMail.length">
        <h2>{{ t('mailPreview') }}</h2>
        <p class="hint">{{ t('mailPreviewHint') }}</p>
        <article v-for="mail in demoMail" :key="mail.outboxId" class="card">
          <p><strong>{{ mail.subject }}</strong></p>
          <p>{{ mail.text }}</p>
        </article>
      </template>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, previewDemoMail, textOf, type I18nText } from '../api';
import { isStaticDemo } from '../demo/engine';
import { useSession } from '../stores/session';

interface Note {
  id: string;
  title: I18nText | string;
  body: I18nText | string;
  studentId?: string;
  readAt?: number | null;
}

const { t, locale } = useI18n();
const children = useSession().me?.children ?? [];
const childId = ref('');
const items = ref<Note[]>([]);
const unreadCount = ref(0);
const demoMail = ref<Array<{ outboxId: string; subject: string; text: string }>>([]);
const error = ref('');

async function load() {
  const result = await callFunction<{ items: Note[]; unreadCount: number }>(FUNCTIONS.apiCore, 'notify.list', {
    ...(childId.value ? { studentId: childId.value } : {}),
  });
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  items.value = result.data.items;
  unreadCount.value = result.data.unreadCount;
  if (isStaticDemo()) {
    const mail = await previewDemoMail();
    if (mail.ok) demoMail.value = mail.data.items;
  }
}

async function markAll() {
  const result = await callFunction(FUNCTIONS.apiCore, 'notify.markRead', { all: true });
  if (!result.ok) error.value = result.error.message;
  else await load();
}

watch(childId, load);
onMounted(load);
</script>

<style scoped>
.card { border-top: 1px solid var(--hst-line); padding: 8px 0; }
</style>
